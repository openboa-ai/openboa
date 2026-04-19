import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ActivationJournal } from "../src/agents/runtime/activation-journal.js"
import { LocalSessionActivationQueue } from "../src/agents/runtime/session-activation-queue.js"
import { SessionWakeQueue } from "../src/agents/runtime/session-wake-queue.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("session wake queue", () => {
  it("dedupes pending wakes and consumes only due entries", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })
    const queue = new SessionWakeQueue(companyDir, store)

    const due = await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-09T11:00:00.000Z",
      reason: "session.revisit",
      note: "look again soon",
      dedupeKey: "same-revisit",
      priority: "normal",
    })
    const duplicate = await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-09T11:00:30.000Z",
      reason: "session.revisit",
      note: "look again soon",
      dedupeKey: "same-revisit",
      priority: "normal",
    })
    const later = await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-09T12:00:00.000Z",
      reason: "session.later",
      note: null,
      dedupeKey: "later",
      priority: "low",
    })

    expect(duplicate.id).toBe(due.id)

    const dueNow = await queue.listPending(session.id, "2026-04-09T11:01:00.000Z")
    expect(dueNow.map((wake) => wake.id)).toEqual([due.id])

    const consumed = await queue.consumeDue(session.id, "2026-04-09T11:01:00.000Z")
    expect(consumed.map((wake) => wake.id)).toEqual([due.id])

    const pendingLater = await queue.listPending(session.id, "2026-04-09T11:01:00.000Z")
    expect(pendingLater.map((wake) => wake.id)).toEqual([])

    const pendingAfter = await queue.listPending(session.id, "2026-04-09T12:01:00.000Z")
    expect(pendingAfter.map((wake) => wake.id)).toEqual([later.id])
  })

  it("maintains an agent-level pending wake session index and clears it when wakes are completed", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const first = await store.createSession({ agentId: "alpha" })
    const second = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)

    expect(await queue.listSessionIdsWithPendingWakes("alpha")).toEqual([])

    await queue.enqueue({
      sessionId: first.id,
      dueAt: "2026-04-09T11:00:00.000Z",
      reason: "session.revisit",
      note: null,
      dedupeKey: "first",
      priority: "normal",
    })
    await queue.enqueue({
      sessionId: second.id,
      dueAt: "2026-04-09T12:00:00.000Z",
      reason: "session.revisit",
      note: null,
      dedupeKey: "second",
      priority: "normal",
    })

    expect(await queue.listSessionIdsWithPendingWakes("alpha")).toEqual([first.id, second.id])

    await queue.consumeDue(first.id, "2026-04-09T11:01:00.000Z")
    expect(await queue.listSessionIdsWithPendingWakes("alpha")).toEqual([second.id])

    await queue.cancelPending(second.id, "2026-04-09T12:01:00.000Z")
    expect(await queue.listSessionIdsWithPendingWakes("alpha")).toEqual([])
  })

  it("preserves pending wake index entries when different sessions enqueue concurrently", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const [first, second, third] = await Promise.all([
      store.createSession({ agentId: "alpha" }),
      store.createSession({ agentId: "alpha" }),
      store.createSession({ agentId: "alpha" }),
    ])
    const queue = new SessionWakeQueue(companyDir, store)

    await Promise.all([
      queue.enqueue({
        sessionId: first.id,
        dueAt: "2026-04-09T11:00:00.000Z",
        reason: "session.revisit",
        note: null,
        dedupeKey: "first",
        priority: "normal",
      }),
      queue.enqueue({
        sessionId: second.id,
        dueAt: "2026-04-09T11:05:00.000Z",
        reason: "session.revisit",
        note: null,
        dedupeKey: "second",
        priority: "normal",
      }),
      queue.enqueue({
        sessionId: third.id,
        dueAt: "2026-04-09T11:10:00.000Z",
        reason: "session.revisit",
        note: null,
        dedupeKey: "third",
        priority: "normal",
      }),
    ])

    expect(await queue.listSessionIdsWithPendingWakes("alpha")).toEqual([
      first.id,
      second.id,
      third.id,
    ])
  })

  it("filters ready activations to allowed session ids when requested", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const [first, second] = await Promise.all([
      store.createSession({ agentId: "alpha" }),
      store.createSession({ agentId: "alpha" }),
    ])
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await Promise.all([
      store.emitEvent(first.id, {
        id: "event-allowed-filter-first",
        type: "user.message",
        createdAt: "2026-04-09T11:00:00.000Z",
        processedAt: null,
        message: "first ready activation",
      }),
      store.emitEvent(second.id, {
        id: "event-allowed-filter-second",
        type: "user.message",
        createdAt: "2026-04-09T11:00:00.000Z",
        processedAt: null,
        message: "second ready activation",
      }),
    ])

    const scoped = await activationQueue.listReadyActivations("alpha", undefined, {
      allowedSessionIds: [second.id],
    })

    expect(scoped.map((activation) => activation.sessionId)).toEqual([second.id])
  })

  it("tracks nextDueAt per session so due-session discovery excludes future wakes", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const dueSession = await store.createSession({ agentId: "alpha" })
    const futureSession = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)

    await queue.enqueue({
      sessionId: dueSession.id,
      dueAt: "2026-04-09T11:00:00.000Z",
      reason: "session.revisit",
      note: null,
      dedupeKey: "due",
      priority: "normal",
    })
    await queue.enqueue({
      sessionId: futureSession.id,
      dueAt: "2026-04-09T12:00:00.000Z",
      reason: "session.revisit",
      note: null,
      dedupeKey: "future",
      priority: "normal",
    })

    expect(await queue.listSessionIdsWithPendingWakes("alpha")).toEqual([
      dueSession.id,
      futureSession.id,
    ])
    expect(await queue.listSessionIdsWithDueWakes("alpha", "2026-04-09T11:30:00.000Z")).toEqual([
      dueSession.id,
    ])
    await expect(queue.listDueSessionWakes("alpha", "2026-04-09T11:30:00.000Z")).resolves.toEqual([
      {
        sessionId: dueSession.id,
        nextDueAt: "2026-04-09T11:00:00.000Z",
        dueWakes: [
          expect.objectContaining({
            sessionId: dueSession.id,
            dueAt: "2026-04-09T11:00:00.000Z",
            reason: "session.revisit",
          }),
        ],
      },
    ])
  })

  it("builds due-session batches from indexed nextDueAt without reopening future wake journals", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const dueSession = await store.createSession({ agentId: "alpha" })
    const futureSession = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)

    await queue.enqueue({
      sessionId: dueSession.id,
      dueAt: "2026-04-09T11:00:00.000Z",
      reason: "session.revisit",
      note: null,
      dedupeKey: "due-indexed",
      priority: "normal",
    })
    await queue.enqueue({
      sessionId: futureSession.id,
      dueAt: "2026-04-09T12:00:00.000Z",
      reason: "session.revisit",
      note: null,
      dedupeKey: "future-indexed",
      priority: "normal",
    })

    const readForAgentSession = vi.spyOn(
      queue as unknown as {
        readForAgentSession: (agentId: string, sessionId: string) => Promise<unknown>
      },
      "readForAgentSession",
    )
    const due = await queue.listDueSessionWakes("alpha", "2026-04-09T11:30:00.000Z")

    expect(due).toEqual([
      {
        sessionId: dueSession.id,
        nextDueAt: "2026-04-09T11:00:00.000Z",
        dueWakes: [
          expect.objectContaining({
            sessionId: dueSession.id,
            dueAt: "2026-04-09T11:00:00.000Z",
          }),
        ],
      },
    ])
    expect(readForAgentSession).toHaveBeenCalledTimes(1)
    expect(readForAgentSession).toHaveBeenCalledWith("alpha", dueSession.id)
  })

  it("repairs stale due entries in the pending-wake index when the due wake journal is empty", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const runtimeDir = join(companyDir, ".openboa", "agents", "alpha", "runtime")

    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      join(runtimeDir, "pending-wake-sessions.json"),
      `${JSON.stringify([{ sessionId: session.id, nextDueAt: "2026-04-09T11:00:00.000Z" }], null, 2)}\n`,
      "utf8",
    )

    await expect(
      queue.listSessionIdsWithDueWakes("alpha", "2026-04-09T11:30:00.000Z"),
    ).resolves.toEqual([])
    await expect(
      readFile(join(runtimeDir, "pending-wake-sessions.json"), "utf8"),
    ).resolves.toContain("[]")
  })

  it("stores pendingEventType in the runnable-session index for immediate work discovery", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-runnable-type",
      type: "user.message",
      createdAt: "2026-04-09T11:00:00.000Z",
      processedAt: null,
      message: "hello",
    })

    await expect(store.listRunnableSessions("alpha")).resolves.toEqual([
      {
        sessionId: session.id,
        pendingEventType: "user.message",
        deferUntil: null,
        failureStreak: 0,
      },
    ])
  })

  it("leases the next ready activation and excludes already leased sessions from later discovery", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)
    const journal = new ActivationJournal(store)

    await store.emitEvent(session.id, {
      id: "event-lease-next-ready",
      type: "user.message",
      createdAt: "2026-04-09T11:00:00.000Z",
      processedAt: null,
      message: "lease me",
    })

    const first = await activationQueue.leaseNextActivation("alpha", {
      leaseOwner: "worker-1",
    })
    expect(first.status).toBe("leased")
    if (first.status !== "leased") {
      return
    }
    expect(first.leased.claimId).toMatch(/^[0-9a-f-]{36}$/iu)
    expect(first.leased.activation).toMatchObject({
      sessionId: session.id,
      kind: "pending_events",
      reason: "user.message",
    })

    const blocked = await activationQueue.leaseNextActivation("alpha", {
      leaseOwner: "worker-2",
    })
    expect(blocked).toEqual({
      status: "none",
    })

    await first.leased.ack({
      wakeId: "wake-lease-next-ready",
      stopReason: "idle",
      queuedWakeIds: ["queued-follow-up"],
      processedEventIds: ["event-lease-next-ready"],
      requeue: {
        immediateRetryAt: "2026-04-09T11:10:00.000Z",
        nextQueuedWakeAt: "2026-04-09T11:15:00.000Z",
        queuedWakeIds: ["queued-follow-up"],
      },
    })

    await expect(journal.list("alpha")).resolves.toEqual([
      expect.objectContaining({
        kind: "activation.leased",
        claimId: first.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-1",
        activationKind: "pending_events",
      }),
      expect.objectContaining({
        kind: "activation.acked",
        claimId: first.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-1",
        wakeId: "wake-lease-next-ready",
        stopReason: "idle",
        queuedWakeIds: ["queued-follow-up"],
        processedEventIds: ["event-lease-next-ready"],
      }),
      expect.objectContaining({
        kind: "activation.requeued",
        claimId: first.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-1",
        immediateRetryAt: "2026-04-09T11:10:00.000Z",
        nextQueuedWakeAt: "2026-04-09T11:15:00.000Z",
        queuedWakeIds: ["queued-follow-up"],
      }),
    ])

    const second = await activationQueue.leaseNextActivation("alpha", {
      leaseOwner: "worker-3",
    })
    expect(second.status).toBe("leased")
  })

  it("records abandoned activation leases when work is given up before execution", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)
    const journal = new ActivationJournal(store)

    await store.emitEvent(session.id, {
      id: "event-abandon-next-ready",
      type: "user.message",
      createdAt: "2026-04-09T11:05:00.000Z",
      processedAt: null,
      message: "abandon me",
    })

    const leased = await activationQueue.leaseNextActivation("alpha", {
      leaseOwner: "worker-abandon",
    })
    expect(leased.status).toBe("leased")
    if (leased.status !== "leased") {
      return
    }
    expect(leased.leased.claimId).toMatch(/^[0-9a-f-]{36}$/iu)

    await leased.leased.abandon({
      reason: "wake_failed",
      errorMessage: "synthetic failure",
    })

    await expect(journal.list("alpha")).resolves.toEqual([
      expect.objectContaining({
        kind: "activation.leased",
        claimId: leased.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-abandon",
      }),
      expect.objectContaining({
        kind: "activation.abandoned",
        claimId: leased.leased.claimId,
        sessionId: session.id,
        leaseOwner: "worker-abandon",
        abandonReason: "wake_failed",
        errorMessage: "synthetic failure",
      }),
    ])
  })

  it("skips a contended ready activation and leases the next ready activation in the same call", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const firstSession = await store.createSession({ agentId: "alpha" })
    const secondSession = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)
    const journal = new ActivationJournal(store)

    await store.emitEvent(firstSession.id, {
      id: "event-race-first",
      type: "user.message",
      createdAt: "2026-04-09T11:00:00.000Z",
      processedAt: null,
      message: "first",
    })
    await store.emitEvent(secondSession.id, {
      id: "event-race-second",
      type: "user.message",
      createdAt: "2026-04-09T11:00:00.000Z",
      processedAt: null,
      message: "second",
    })

    const originalAcquireWakeLease = store.acquireWakeLease.bind(store)
    let failedFirstAttempt = false
    vi.spyOn(store, "acquireWakeLease").mockImplementation(async (sessionId, owner, options) => {
      if (!failedFirstAttempt && sessionId === firstSession.id) {
        failedFirstAttempt = true
        return null
      }
      return originalAcquireWakeLease(sessionId, owner, options)
    })

    const leased = await activationQueue.leaseNextActivation("alpha", {
      leaseOwner: "worker-race",
    })
    expect(leased.status).toBe("leased")
    if (leased.status !== "leased") {
      return
    }
    expect(leased.leased.claimId).toMatch(/^[0-9a-f-]{36}$/iu)

    expect(leased.leased.activation.sessionId).toBe(secondSession.id)
    await leased.leased.ack({
      wakeId: "wake-race-second",
      stopReason: "idle",
      queuedWakeIds: [],
      processedEventIds: ["event-race-second"],
    })

    await expect(journal.list("alpha")).resolves.toEqual([
      expect.objectContaining({
        kind: "activation.blocked",
        sessionId: firstSession.id,
        leaseOwner: "worker-race",
        blockedReason: "lease_contended",
        claimId: expect.any(String),
      }),
      expect.objectContaining({
        kind: "activation.leased",
        claimId: leased.leased.claimId,
        sessionId: secondSession.id,
        leaseOwner: "worker-race",
      }),
      expect.objectContaining({
        kind: "activation.acked",
        claimId: leased.leased.claimId,
        sessionId: secondSession.id,
        leaseOwner: "worker-race",
        wakeId: "wake-race-second",
      }),
    ])
  })
})
