import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ActivationJournal } from "../src/agents/runtime/activation-journal.js"
import { LocalSessionActivationQueue } from "../src/agents/runtime/session-activation-queue.js"
import { SessionWakeQueue } from "../src/agents/runtime/session-wake-queue.js"
import { wakeSessionOnce } from "../src/agents/runtime/wake-session.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("wake session", () => {
  it("uses a single session snapshot and agent-scoped wake queue methods during wake execution", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-wake-direct",
      type: "user.message",
      createdAt: "2026-04-10T10:00:00.000Z",
      processedAt: null,
      message: "wake directly",
    })

    const getEvents = vi.spyOn(store, "getEvents")
    const listPending = vi.spyOn(queue, "listPending")
    const listPendingForAgentSession = vi.spyOn(queue, "listPendingForAgentSession")
    const consumeDue = vi.spyOn(queue, "consumeDue")
    const consumeDueForAgentSession = vi.spyOn(queue, "consumeDueForAgentSession")

    const result = await wakeSessionOnce({
      sessionId: session.id,
      sessionStore: store,
      wakeQueue: queue,
      runHarness: async () => ({
        session: {
          ...(await store.getAgentSession("alpha", session.id)).session,
          status: "idle",
          stopReason: "idle",
        },
        wakeId: "wake-direct",
        response: "Handled direct wake.",
        stopReason: "idle",
        queuedWakes: [],
        processedEventIds: ["event-wake-direct"],
      }),
    })

    expect(result.executed).toBe(true)
    expect(result.responsePreview).toContain("Handled direct wake.")
    expect(getEvents).not.toHaveBeenCalled()
    expect(listPending).not.toHaveBeenCalled()
    expect(consumeDue).not.toHaveBeenCalled()
    expect(listPendingForAgentSession).toHaveBeenCalledWith("alpha", session.id)
    expect(consumeDueForAgentSession).toHaveBeenCalledWith("alpha", session.id)
  })

  it("reuses prefetched due wakes from activation discovery instead of reopening the wake journal", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const session = await store.createSession({ agentId: "alpha" })

    const wake = await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-10T10:00:00.000Z",
      reason: "session.revisit",
      note: "prefetched due wake",
      dedupeKey: "prefetched-due-wake",
      priority: "high",
    })

    const listPendingForAgentSession = vi.spyOn(queue, "listPendingForAgentSession")
    const consumeDueForAgentSession = vi.spyOn(queue, "consumeDueForAgentSession")
    const consumeKnownForAgentSession = vi.spyOn(queue, "consumeKnownForAgentSession")

    const result = await wakeSessionOnce({
      sessionId: session.id,
      activation: {
        sessionId: session.id,
        agentId: "alpha",
        kind: "queued_wake",
        priority: "high",
        dueAt: wake.dueAt,
        reason: wake.reason,
        note: wake.note,
        dueWakes: [wake],
      },
      sessionStore: store,
      wakeQueue: queue,
      runHarness: async () => ({
        session: {
          ...(await store.getAgentSession("alpha", session.id)).session,
          status: "idle",
          stopReason: "idle",
        },
        wakeId: "wake-prefetched",
        response: "Handled prefetched wake.",
        stopReason: "idle",
        queuedWakes: [],
        processedEventIds: [],
      }),
    })

    expect(result.executed).toBe(true)
    expect(result.consumedInputs).toContain("queued_wake: session.revisit (prefetched due wake)")
    expect(listPendingForAgentSession).not.toHaveBeenCalled()
    expect(consumeDueForAgentSession).not.toHaveBeenCalled()
    expect(consumeKnownForAgentSession).toHaveBeenCalledWith("alpha", session.id, [wake])
  })

  it("leases wake execution so concurrent workers do not run the same session twice", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-concurrent-wake",
      type: "user.message",
      createdAt: "2026-04-10T10:00:00.000Z",
      processedAt: null,
      message: "wake once",
    })

    let harnessCalls = 0
    let releaseHarness: (() => void) | null = null
    const firstWakePromise = wakeSessionOnce({
      sessionId: session.id,
      sessionStore: store,
      wakeQueue: queue,
      runHarness: async () => {
        harnessCalls += 1
        await new Promise<void>((resolve) => {
          releaseHarness = resolve
        })
        return {
          session: {
            ...(await store.getAgentSession("alpha", session.id)).session,
            status: "idle",
            stopReason: "idle",
          },
          wakeId: "wake-concurrent-first",
          response: "Handled once.",
          stopReason: "idle",
          queuedWakes: [],
          processedEventIds: ["event-concurrent-wake"],
        }
      },
    })

    await vi.waitFor(() => {
      expect(harnessCalls).toBe(1)
    })

    const secondWakeResult = await wakeSessionOnce({
      sessionId: session.id,
      sessionStore: store,
      wakeQueue: queue,
      runHarness: async () => {
        harnessCalls += 1
        return {
          session: {
            ...(await store.getAgentSession("alpha", session.id)).session,
            status: "idle",
            stopReason: "idle",
          },
          wakeId: "wake-concurrent-second",
          response: "Should not run.",
          stopReason: "idle",
          queuedWakes: [],
          processedEventIds: [],
        }
      },
    })

    expect(secondWakeResult.executed).toBe(false)
    expect(secondWakeResult.skippedReason).toBe("lease_contended")
    expect(harnessCalls).toBe(1)

    releaseHarness?.()
    const firstWakeResult = await firstWakePromise
    expect(firstWakeResult.executed).toBe(true)
    expect(firstWakeResult.skippedReason).toBeNull()
    expect(harnessCalls).toBe(1)
  })

  it("recovers a stale wake lease instead of leaving the session deadlocked", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-stale-lease",
      type: "user.message",
      createdAt: "2026-04-10T10:00:00.000Z",
      processedAt: null,
      message: "recover stale lock",
    })

    const lockPath = join(store.sessionDir("alpha", session.id), "wake.lock")
    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          sessionId: session.id,
          owner: "stale-owner",
          acquiredAt: "2026-04-10T09:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const result = await wakeSessionOnce({
      sessionId: session.id,
      sessionStore: store,
      wakeQueue: queue,
      runHarness: async () => ({
        session: {
          ...(await store.getAgentSession("alpha", session.id)).session,
          status: "idle",
          stopReason: "idle",
        },
        wakeId: "wake-stale-lease",
        response: "Recovered stale lease.",
        stopReason: "idle",
        queuedWakes: [],
        processedEventIds: ["event-stale-lease"],
      }),
    })

    expect(result.executed).toBe(true)
    expect(result.skippedReason).toBeNull()
  })

  it("restores consumed due wakes when wake execution fails after consuming them", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-10T10:00:05.000Z"))
    try {
      const companyDir = await createCompanyFixture()
      await createOfflineCodexAgent(companyDir, "alpha")
      const store = new SessionStore(companyDir)
      const queue = new SessionWakeQueue(companyDir, store)
      const session = await store.createSession({ agentId: "alpha" })

      const originalWake = await queue.enqueue({
        sessionId: session.id,
        dueAt: "2026-04-10T10:00:00.000Z",
        reason: "session.revisit",
        note: "restore-me",
        dedupeKey: "restore-due-wake",
        priority: "normal",
      })

      await expect(
        wakeSessionOnce({
          sessionId: session.id,
          sessionStore: store,
          wakeQueue: queue,
          runHarness: async () => {
            throw new Error("synthetic wake failure")
          },
        }),
      ).rejects.toThrow("synthetic wake failure")

      const immediatelyDue = await queue.listPendingForAgentSession(
        "alpha",
        session.id,
        "2026-04-10T10:00:05.000Z",
      )
      expect(immediatelyDue).toHaveLength(0)

      const restored = await queue.listPendingForAgentSession(
        "alpha",
        session.id,
        "2026-04-10T10:00:07.000Z",
      )
      expect(restored).toHaveLength(1)
      expect(restored[0]).toMatchObject({
        sessionId: session.id,
        dueAt: "2026-04-10T10:00:07.000Z",
        reason: originalWake.reason,
        note: originalWake.note,
        dedupeKey: originalWake.dedupeKey,
        priority: originalWake.priority,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("renews active wake leases so long-running executions keep the lease fresh", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const lease = await store.acquireWakeLease(session.id, "renew-owner")
    expect(lease).not.toBeNull()

    const lockPath = join(store.sessionDir("alpha", session.id), "wake.lock")
    const before = JSON.parse(await readFile(lockPath, "utf8")) as { acquiredAt: string }
    await new Promise((resolve) => setTimeout(resolve, 5))
    await lease?.renew()
    const after = JSON.parse(await readFile(lockPath, "utf8")) as { acquiredAt: string }

    expect(Date.parse(after.acquiredAt)).toBeGreaterThan(Date.parse(before.acquiredAt))
    await lease?.release()
  })

  it("fails closed when wake lease renewal starts failing during a long-running activation", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-lease-renew-fail",
      type: "user.message",
      createdAt: "2026-04-10T10:00:00.000Z",
      processedAt: null,
      message: "long running wake",
    })

    const ack = vi.fn(async () => undefined)
    const abandon = vi.fn(async () => undefined)
    const renew = vi.fn(async () => {
      throw new Error("lease renew failed")
    })

    await expect(
      wakeSessionOnce({
        sessionId: session.id,
        activation: {
          sessionId: session.id,
          agentId: "alpha",
          kind: "pending_events",
          priority: "high",
          dueAt: null,
          reason: "user.message",
          note: null,
          dueWakes: [],
        },
        leasedActivation: {
          activation: {
            sessionId: session.id,
            agentId: "alpha",
            kind: "pending_events",
            priority: "high",
            dueAt: null,
            reason: "user.message",
            note: null,
            dueWakes: [],
          },
          renew,
          ack,
          abandon,
        },
        wakeLease: {
          staleAfterMs: 60_000,
          heartbeatMs: 5,
        },
        sessionStore: store,
        wakeQueue: queue,
        runHarness: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return {
            session: {
              ...(await store.getAgentSession("alpha", session.id)).session,
              status: "idle",
              stopReason: "idle",
            },
            wakeId: "wake-lease-renew-fail",
            response: "This should not commit as success.",
            stopReason: "idle",
            queuedWakes: [],
            processedEventIds: ["event-lease-renew-fail"],
          }
        },
      }),
    ).rejects.toThrow("lease renew failed")

    expect(renew).toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    expect(abandon).toHaveBeenCalledWith({
      reason: "wake_lease_renew_failed",
      errorMessage: "lease renew failed",
    })
  })

  it("records activation.requeued when a wake finishes in rescheduling with immediate retry and queued wakes", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const wakeQueue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, wakeQueue)
    const journal = new ActivationJournal(store)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-requeue-activation",
      type: "user.message",
      createdAt: "2026-04-10T10:00:00.000Z",
      processedAt: null,
      message: "retry later",
    })

    const leased = await activationQueue.leaseNextActivation("alpha", {
      leaseOwner: "worker-requeue",
    })
    expect(leased.status).toBe("leased")
    if (leased.status !== "leased") {
      return
    }
    expect(leased.leased.claimId).toMatch(/^[0-9a-f-]{36}$/iu)

    const result = await wakeSessionOnce({
      sessionId: session.id,
      leasedActivation: leased.leased,
      sessionStore: store,
      wakeQueue,
      runHarness: async () => {
        await store.updateSession(session.id, (current) => ({
          ...current,
          status: "rescheduling",
          stopReason: "rescheduling",
        }))
        await store.deferRunnableSession(session.id, "2026-04-10T10:05:00.000Z")
        return {
          session: {
            ...(await store.getAgentSession("alpha", session.id)).session,
            status: "rescheduling",
            stopReason: "rescheduling",
          },
          wakeId: "wake-requeue-activation",
          response: "Retry scheduled.",
          stopReason: "rescheduling",
          queuedWakes: [
            {
              dueAt: "2026-04-10T10:06:00.000Z",
              reason: "session.revisit",
              note: "retry after backoff",
              dedupeKey: "wake-requeue-activation",
              priority: "normal",
            },
          ],
          processedEventIds: ["event-requeue-activation"],
        }
      },
    })

    expect(result.executed).toBe(true)
    expect(result.stopReason).toBe("rescheduling")
    expect(result.queuedWakeIds).toHaveLength(1)

    await expect(journal.list("alpha")).resolves.toEqual([
      expect.objectContaining({
        kind: "activation.leased",
        claimId: leased.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-requeue",
      }),
      expect.objectContaining({
        kind: "activation.acked",
        claimId: leased.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-requeue",
        wakeId: "wake-requeue-activation",
        stopReason: "rescheduling",
        queuedWakeIds: result.queuedWakeIds,
        processedEventIds: ["event-requeue-activation"],
      }),
      expect.objectContaining({
        kind: "activation.requeued",
        claimId: leased.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-requeue",
        immediateRetryAt: "2026-04-10T10:05:00.000Z",
        nextQueuedWakeAt: "2026-04-10T10:06:00.000Z",
        queuedWakeIds: result.queuedWakeIds,
      }),
    ])
  })
})
