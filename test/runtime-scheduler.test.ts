import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { CodexAuth } from "../src/agents/auth/codex-auth.js"
import { AgentHarness } from "../src/agents/runtime/harness.js"
import { AgentOrchestration } from "../src/agents/runtime/orchestration.js"
import {
  LocalSessionActivationQueue,
  type SessionActivationQueue,
} from "../src/agents/runtime/session-activation-queue.js"
import { SessionWakeQueue } from "../src/agents/runtime/session-wake-queue.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

const NONE_AUTH: CodexAuth = {
  mode: "none",
  token: null,
}

describe("session orchestration", () => {
  it("prefers immediate pending events over due wakes for the same session in the activation queue", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-10T10:00:00.000Z",
      reason: "session.revisit",
      note: "due revisit",
      dedupeKey: "due-revisit",
      priority: "normal",
    })
    await store.emitEvent(session.id, {
      id: "event-pending-message",
      type: "user.message",
      createdAt: "2026-04-10T10:00:01.000Z",
      processedAt: null,
      message: "immediate work",
    })

    const activations = await activationQueue.listReadyActivations(
      "alpha",
      "2026-04-10T10:05:00.000Z",
    )

    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: session.id,
      kind: "pending_events",
      priority: "high",
      reason: "user.message",
    })
  })

  it("orders activation queue entries by readiness priority before the orchestrator consumes them", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const first = await store.createSession({ agentId: "alpha" })
    const second = await store.createSession({ agentId: "alpha" })
    const third = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await queue.enqueue({
      sessionId: first.id,
      dueAt: "2026-04-10T10:00:05.000Z",
      reason: "session.revisit",
      note: "normal revisit",
      dedupeKey: "first",
      priority: "normal",
    })
    await queue.enqueue({
      sessionId: second.id,
      dueAt: "2026-04-10T10:00:01.000Z",
      reason: "session.follow_up",
      note: "high priority revisit",
      dedupeKey: "second",
      priority: "high",
    })
    await store.emitEvent(third.id, {
      id: "event-third-message",
      type: "user.message",
      createdAt: "2026-04-10T10:00:02.000Z",
      processedAt: null,
      message: "immediate user event",
    })

    const activations = await activationQueue.listReadyActivations(
      "alpha",
      "2026-04-10T10:05:00.000Z",
    )

    expect(
      activations.map((activation) => [activation.sessionId, activation.kind, activation.priority]),
    ).toEqual([
      [third.id, "pending_events", "high"],
      [second.id, "queued_wake", "high"],
      [first.id, "queued_wake", "normal"],
    ])
  })

  it("uses the pending-wake session index instead of scanning every session for delayed activations", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const first = await store.createSession({ agentId: "alpha" })
    const second = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await queue.enqueue({
      sessionId: second.id,
      dueAt: "2026-04-10T10:00:01.000Z",
      reason: "session.revisit",
      note: "indexed delayed wake",
      dedupeKey: "second-delayed",
      priority: "high",
    })

    const listAgentSessionIds = vi.spyOn(store, "listAgentSessionIds")
    const activations = await activationQueue.listReadyActivations(
      "alpha",
      "2026-04-10T10:05:00.000Z",
    )

    expect(listAgentSessionIds).not.toHaveBeenCalled()
    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: second.id,
      kind: "queued_wake",
      priority: "high",
    })
    expect(first.id).not.toBe(second.id)
  })

  it("does not reopen future-wake sessions when only a due wake should activate", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const dueSession = await store.createSession({ agentId: "alpha" })
    const futureSession = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await queue.enqueue({
      sessionId: dueSession.id,
      dueAt: "2026-04-10T10:00:01.000Z",
      reason: "session.revisit",
      note: "due wake",
      dedupeKey: "due-delayed",
      priority: "high",
    })
    await queue.enqueue({
      sessionId: futureSession.id,
      dueAt: "2026-04-10T12:00:01.000Z",
      reason: "session.revisit",
      note: "future wake",
      dedupeKey: "future-delayed",
      priority: "normal",
    })

    const listPending = vi.spyOn(queue, "listPending")
    const listPendingForAgentSession = vi.spyOn(queue, "listPendingForAgentSession")
    const listSessionIdsWithDueWakes = vi.spyOn(queue, "listSessionIdsWithDueWakes")
    const listDueSessionWakes = vi.spyOn(queue, "listDueSessionWakes")
    const activations = await activationQueue.listReadyActivations(
      "alpha",
      "2026-04-10T10:05:00.000Z",
    )

    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: dueSession.id,
      kind: "queued_wake",
      priority: "high",
    })
    expect(listPending).not.toHaveBeenCalled()
    expect(listPendingForAgentSession).not.toHaveBeenCalled()
    expect(listSessionIdsWithDueWakes).not.toHaveBeenCalled()
    expect(listDueSessionWakes).toHaveBeenCalledTimes(1)
    expect(listDueSessionWakes).toHaveBeenCalledWith("alpha", "2026-04-10T10:05:00.000Z")
  })

  it("does not reopen session snapshots while discovering delayed activations from the due-wake index", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-10T10:00:01.000Z",
      reason: "session.revisit",
      note: "due wake",
      dedupeKey: "due-only",
      priority: "high",
    })

    const getAgentSession = vi.spyOn(store, "getAgentSession")
    const activations = await activationQueue.listReadyActivations(
      "alpha",
      "2026-04-10T10:05:00.000Z",
    )

    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: session.id,
      kind: "queued_wake",
      priority: "high",
    })
    expect(getAgentSession).not.toHaveBeenCalled()
  })

  it("maintains a runnable session index for pending runnable events and clears it once they are processed", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    expect(await store.listRunnableSessionIds("alpha")).toEqual([])

    await store.emitEvent(session.id, {
      id: "event-runnable-index",
      type: "user.message",
      createdAt: "2026-04-10T10:00:02.000Z",
      processedAt: null,
      message: "make this session runnable",
    })

    expect(await store.listRunnableSessionIds("alpha")).toEqual([session.id])

    await store.markProcessed(session.id, ["event-runnable-index"], "2026-04-10T10:00:03.000Z")

    expect(await store.listRunnableSessionIds("alpha")).toEqual([])
  })

  it("uses runnable-session index metadata for immediate activations without reopening session snapshots", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const activationQueue = new LocalSessionActivationQueue(
      store,
      new SessionWakeQueue(companyDir, store),
    )

    await store.emitEvent(session.id, {
      id: "event-immediate-index",
      type: "user.message",
      createdAt: "2026-04-10T10:00:02.000Z",
      processedAt: null,
      message: "immediate indexed work",
    })

    const getAgentSession = vi.spyOn(store, "getAgentSession")
    const activations = await activationQueue.listReadyActivations("alpha")

    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: session.id,
      kind: "pending_events",
      reason: "user.message",
      priority: "high",
    })
    expect(getAgentSession).not.toHaveBeenCalled()
  })

  it("trusts the runnable-session index on the hot path and leaves stale-entry repair to reconciliation", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const activationQueue = new LocalSessionActivationQueue(
      store,
      new SessionWakeQueue(companyDir, store),
    )

    await store.emitEvent(session.id, {
      id: "event-immediate-hot-path",
      type: "user.message",
      createdAt: "2026-04-10T10:00:02.000Z",
      processedAt: null,
      message: "immediate indexed work",
    })

    const readSessionIfPresent = vi.spyOn(
      store as never as { readSessionIfPresent: () => Promise<unknown> },
      "readSessionIfPresent",
    )
    const activations = await activationQueue.listReadyActivations("alpha")

    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: session.id,
      kind: "pending_events",
      reason: "user.message",
    })
    expect(readSessionIfPresent).not.toHaveBeenCalled()
  })

  it("excludes runnable sessions that already have an active wake lease", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const activationQueue = new LocalSessionActivationQueue(
      store,
      new SessionWakeQueue(companyDir, store),
    )

    await store.emitEvent(session.id, {
      id: "event-immediate-leased",
      type: "user.message",
      createdAt: "2026-04-10T10:00:02.000Z",
      processedAt: null,
      message: "leased immediate work",
    })
    const lease = await store.acquireWakeLease(session.id, "lease-owner")
    expect(lease).not.toBeNull()
    const listActiveWakeLeaseSessionIds = vi.spyOn(store, "listActiveWakeLeaseSessionIds")
    const hasActiveWakeLease = vi.spyOn(store, "hasActiveWakeLease")

    const activations = await activationQueue.listReadyActivations("alpha")
    expect(activations).toEqual([])
    expect(listActiveWakeLeaseSessionIds).toHaveBeenCalledWith("alpha", {
      staleAfterMs: undefined,
    })
    expect(hasActiveWakeLease).not.toHaveBeenCalled()

    await lease?.release()
  })

  it("treats old wake leases as stale when activation discovery receives a tighter stale threshold", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const activationQueue = new LocalSessionActivationQueue(
      store,
      new SessionWakeQueue(companyDir, store),
    )

    await store.emitEvent(session.id, {
      id: "event-immediate-stale-threshold",
      type: "user.message",
      createdAt: "2026-04-10T10:00:02.000Z",
      processedAt: null,
      message: "stale lease should not block activation",
    })

    const lockPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "wake.lock",
    )
    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          sessionId: session.id,
          owner: "old-owner",
          acquiredAt: "2026-04-10T09:59:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const activations = await activationQueue.listReadyActivations("alpha", undefined, {
      wakeLeaseStaleAfterMs: 1,
    })

    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: session.id,
      kind: "pending_events",
      reason: "user.message",
    })
  })

  it("does not treat queued-wake rescheduling as immediate runnable work without pending events", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await store.updateSession(session.id, (current) => ({
      ...current,
      status: "rescheduling",
      stopReason: "rescheduling",
      updatedAt: "2026-04-10T10:00:04.000Z",
    }))
    await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-10T10:10:00.000Z",
      reason: "session.follow_up",
      note: "queued wake only",
      dedupeKey: "queued-only",
      priority: "normal",
    })

    expect(await store.listRunnableSessionIds("alpha")).toEqual([])
    expect(await activationQueue.listReadyActivations("alpha", "2026-04-10T10:05:00.000Z")).toEqual(
      [],
    )
  })

  it("respects runnable-session deferUntil backoff before surfacing immediate activations", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)

    await store.emitEvent(session.id, {
      id: "event-user-deferred-immediate",
      type: "user.message",
      createdAt: "2026-04-10T10:00:00.000Z",
      processedAt: null,
      message: "deferred immediate activation",
    })
    await store.deferRunnableSession(session.id, "2026-04-10T10:10:00.000Z")

    expect(await activationQueue.listReadyActivations("alpha", "2026-04-10T10:05:00.000Z")).toEqual(
      [],
    )

    const activations = await activationQueue.listReadyActivations(
      "alpha",
      "2026-04-10T10:10:01.000Z",
    )
    expect(activations).toHaveLength(1)
    expect(activations[0]).toMatchObject({
      sessionId: session.id,
      kind: "pending_events",
      reason: "user.message",
    })
  })

  it("self-heals stale runnable-session index entries after an empty immediate activation attempt", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.updateSession(session.id, (current) => ({
      ...current,
      status: "rescheduling",
      stopReason: "rescheduling",
      updatedAt: "2026-04-10T10:00:05.000Z",
    }))
    const runtimeDir = join(companyDir, ".openboa", "agents", "alpha", "runtime")
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      join(runtimeDir, "runnable-sessions.json"),
      `${JSON.stringify([{ sessionId: session.id, pendingEventType: "user.message" }], null, 2)}\n`,
      "utf8",
    )

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'No-op.\n<openboa-session-loop>{"outcome":"sleep","summary":"No-op.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.runAgentLoop("alpha", {
      maxCycles: 1,
      stopWhenIdle: true,
    })

    expect(result.executed).toBe(0)
    expect(result.stopReason).toBe("idle")
    expect(await store.listRunnableSessionIds("alpha")).toEqual([])
  })

  it("enqueues queued wakes and follow-up revisits inside the private wake queue", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-user-queue",
      type: "user.message",
      createdAt: "2026-04-09T10:00:00.000Z",
      processedAt: null,
      message: "Handle this, then revisit twice.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Need follow-up.\n<openboa-session-loop>{"outcome":"continue","summary":"Re-check the same bounded objective.","followUpSeconds":60,"queuedWakes":[{"reason":"session.revisit","delaySeconds":600,"note":"later revisit","dedupeKey":"later-revisit"}]}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
    expect(result.stopReason).toBe("rescheduling")
    expect(result.queuedWakeIds).toHaveLength(2)
    expect(result.consumedInputs).toContain("user.message: Handle this, then revisit twice.")
    expect(result.responsePreview).toContain("Need follow-up.")

    const queue = new SessionWakeQueue(companyDir, store)
    const pending = await queue.listPending(session.id, "9999-12-31T23:59:59.000Z")
    expect(pending.map((wake) => wake.reason)).toContain("session.follow_up")
    expect(pending.map((wake) => wake.reason)).toContain("session.revisit")
  })

  it("re-enqueues a short delayed retry wake when a queued wake hits a retryable provider failure", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)

    await queue.enqueue({
      sessionId: session.id,
      dueAt: "2026-04-09T10:00:00.000Z",
      reason: "session.revisit",
      note: "background revisit",
      dedupeKey: "retryable-revisit",
      priority: "normal",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw Object.assign(new Error("model call timed out"), {
            code: "model_timeout",
          })
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      wakeQueue: queue,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
    expect(result.stopReason).toBe("rescheduling")
    expect(result.queuedWakeIds).toHaveLength(1)

    const snapshot = await store.getSession(session.id)
    expect(snapshot.session.status).toBe("rescheduling")
    expect(snapshot.session.stopReason).toBe("rescheduling")

    const pending = await queue.listPending(session.id, "9999-12-31T23:59:59.000Z")
    expect(pending).toHaveLength(1)
    expect(pending[0]?.reason).toBe("session.revisit")
    expect(pending[0]?.dedupeKey).toBe(`retry:${session.id}:session.revisit`)
    expect(pending[0]?.note).toContain("retry after transient provider failure")
    expect(Date.parse(String(pending[0]?.dueAt))).toBeGreaterThan(
      Date.parse("2026-04-09T10:00:00.000Z"),
    )
  })

  it("lets the orchestrator drain work across multiple sessions and stop when idle", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const first = await store.createSession({ agentId: "alpha" })
    const second = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(first.id, {
      id: "event-user-one",
      type: "user.message",
      createdAt: "2026-04-09T10:10:00.000Z",
      processedAt: null,
      message: "first session",
    })
    await store.emitEvent(second.id, {
      id: "event-user-two",
      type: "user.message",
      createdAt: "2026-04-09T10:10:01.000Z",
      processedAt: null,
      message: "second session",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Done.\n<openboa-session-loop>{"outcome":"sleep","summary":"Session handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.runAgentLoop("alpha", {
      maxCycles: 3,
      stopWhenIdle: true,
    })

    expect(result.stopReason).toBe("idle")
    expect(result.executed).toBe(2)
  })

  it("watch mode consumes delayed wakes when they become due without a manual wake", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const dueAt = new Date(Date.now() + 30).toISOString()

    await queue.enqueue({
      sessionId: session.id,
      dueAt,
      reason: "session.revisit",
      note: "background revisit",
      dedupeKey: "watch-revisit",
      priority: "normal",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Handled revisit.\n<openboa-session-loop>{"outcome":"sleep","summary":"Background revisit handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      wakeQueue: queue,
    })
    const activities: Array<{
      consumedInputs: string[]
      responsePreview: string | null
    }> = []

    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 10,
      idleTimeoutMs: 80,
      maxCycles: 40,
      onActivity: (activity) => {
        activities.push({
          consumedInputs: activity.consumedInputs,
          responsePreview: activity.responsePreview,
        })
      },
    })

    expect(result.executed).toBe(1)
    expect(result.stopReason).toBe("idle_timeout")
    expect(activities).toHaveLength(1)
    expect(activities[0]?.consumedInputs).toContain(
      "queued_wake: session.revisit (background revisit)",
    )
    expect(activities[0]?.responsePreview).toContain("Handled revisit.")
  })

  it("shortens watch sleep to the next due wake instead of waiting for the full poll interval", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)
    const dueAt = new Date(Date.now() + 40).toISOString()

    await queue.enqueue({
      sessionId: session.id,
      dueAt,
      reason: "session.revisit",
      note: "short sleep due wake",
      dedupeKey: "short-sleep-revisit",
      priority: "normal",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Handled short-sleep revisit.\n<openboa-session-loop>{"outcome":"sleep","summary":"Short-sleep revisit handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      wakeQueue: queue,
    })

    const startedAt = Date.now()
    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 1000,
      idleTimeoutMs: 250,
      maxCycles: 20,
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.executed).toBe(1)
    expect(result.stopReason).toBe("idle_timeout")
    expect(elapsedMs).toBeLessThan(900)
  })

  it("watch mode reacts to newly appended user events without an explicit wake", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.message: background-triggered message")
          return {
            response:
              'Handled inbound event.\n<openboa-session-loop>{"outcome":"sleep","summary":"Inbound event handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    setTimeout(() => {
      void store.emitEvent(session.id, {
        id: "event-user-background",
        type: "user.message",
        createdAt: new Date().toISOString(),
        processedAt: null,
        message: "background-triggered message",
      })
    }, 20)

    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 10,
      idleTimeoutMs: 100,
      maxCycles: 50,
    })

    expect(result.executed).toBe(1)
    expect(result.stopReason).toBe("idle_timeout")
  })

  it("re-checks activations before idling out so newly ready work at the timeout boundary still runs", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    await store.emitEvent(session.id, {
      id: "event-boundary-message",
      type: "user.message",
      createdAt: "2026-04-10T12:00:00.000Z",
      processedAt: null,
      message: "boundary-triggered message",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.message: boundary-triggered message")
          return {
            response:
              'Handled boundary event.\n<openboa-session-loop>{"outcome":"sleep","summary":"Boundary event handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const baseActivationQueue = new LocalSessionActivationQueue(
      store,
      new SessionWakeQueue(companyDir, store),
    )
    let callCount = 0
    const activationQueue: SessionActivationQueue = {
      async listReadyActivations(agentId, at) {
        callCount += 1
        if (callCount === 1) {
          return []
        }
        return baseActivationQueue.listReadyActivations(agentId, at)
      },
      async nextReadyActivation(agentId, at, options) {
        const activations = await this.listReadyActivations(agentId, at)
        const excluded = new Set(options?.excludeSessionIds ?? [])
        return activations.find((activation) => !excluded.has(activation.sessionId)) ?? null
      },
      async leaseNextActivation(agentId, options) {
        const activation = await this.nextReadyActivation(agentId, options?.at, options)
        if (!activation) {
          return { status: "none" as const }
        }
        return {
          status: "leased" as const,
          leased: {
            activation,
            async renew() {},
            async ack() {},
            async abandon() {},
          },
        }
      },
      async peekNextReadyAt() {
        return null
      },
      async waitForChange(_agentId, options) {
        await new Promise((resolve) => setTimeout(resolve, options.timeoutMs))
      },
    }
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      activationQueue,
    })

    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 5,
      idleTimeoutMs: 1,
      maxCycles: 5,
    })

    expect(result.executed).toBe(1)
    expect(result.stopReason).toBe("idle_timeout")
  })

  it("deduplicates repeated skip logs when the same session stays lease-contended across cycles", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw new Error("should not run")
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const session = await store.createSession({
      agentId: "alpha",
      sessionId: "019d7f24-40f6-731d-a14f-13753283f34d",
    })
    const activationQueue: SessionActivationQueue = {
      async listReadyActivations() {
        return [
          {
            sessionId: session.id,
            agentId: "alpha",
            kind: "pending_events",
            priority: "high",
            dueAt: null,
            reason: "user.message",
            note: null,
            dueWakes: [],
          },
        ]
      },
      async nextReadyActivation(_agentId, _at, options) {
        const activations = await this.listReadyActivations()
        const excluded = new Set(options?.excludeSessionIds ?? [])
        return activations.find((activation) => !excluded.has(activation.sessionId)) ?? null
      },
      async leaseNextActivation(agentId, options) {
        const activation = await this.nextReadyActivation(agentId, options?.at, options)
        if (!activation) {
          return { status: "none" as const }
        }
        return {
          status: "leased" as const,
          leased: {
            activation,
            async renew() {},
            async ack() {},
            async abandon() {},
          },
        }
      },
      async peekNextReadyAt() {
        return null
      },
      async waitForChange(_agentId, options) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.timeoutMs, 5)))
      },
    }
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      activationQueue,
    })
    const wakeSpy = vi.spyOn(orchestration, "wake").mockResolvedValue({
      session,
      wakeId: null,
      executed: false,
      skippedReason: "lease_contended",
      response: null,
      responsePreview: null,
      stopReason: "rescheduling",
      queuedWakeIds: [],
      queuedWakeSummaries: [],
      requeue: null,
      processedEventIds: [],
      consumedInputs: [],
      wakeEvents: [],
    })
    const skips: Array<{ cycle: number; sessionId: string; reason: string }> = []

    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 10,
      idleTimeoutMs: 20,
      maxCycles: 3,
      onSkip: (skip) => {
        skips.push({
          cycle: skip.cycle,
          sessionId: skip.sessionId,
          reason: skip.reason,
        })
      },
    })

    expect(result.executed).toBe(0)
    expect(wakeSpy).toHaveBeenCalledTimes(3)
    expect(skips).toEqual([
      {
        cycle: 1,
        sessionId: session.id,
        reason: "lease_contended",
      },
    ])
  })

  it("reloads wake-lease policy when agent.json changes during the same orchestrator lifetime", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw new Error("should not run")
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const activationQueueCalls: number[] = []
    const activationQueue: SessionActivationQueue = {
      async listReadyActivations(_agentId, _at, options) {
        activationQueueCalls.push(options?.wakeLeaseStaleAfterMs ?? -1)
        return []
      },
      async nextReadyActivation(agentId, at, options) {
        const activations = await this.listReadyActivations(agentId, at, options)
        return activations[0] ?? null
      },
      async leaseNextActivation(agentId, options) {
        const activation = await this.nextReadyActivation(agentId, options?.at, options)
        if (!activation) {
          return { status: "none" as const }
        }
        return {
          status: "leased" as const,
          leased: {
            activation,
            async renew() {},
            async ack() {},
            async abandon() {},
          },
        }
      },
      async peekNextReadyAt() {
        return null
      },
      async waitForChange(_agentId, options) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.timeoutMs, 5)))
      },
    }
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      activationQueue,
    })

    await orchestration.runAgentLoop("alpha", {
      maxCycles: 1,
      stopWhenIdle: true,
    })

    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          runtime: {
            kind: "embedded",
            provider: "openai-codex",
            wakeLease: {
              staleAfterSeconds: 5,
              heartbeatSeconds: 2,
            },
          },
          model: {
            provider: "openai-codex",
            id: "gpt-5.4",
          },
          auth: {
            provider: "codex",
            required: false,
            method: "oauth-browser",
          },
          ui: {
            mode: "tui",
          },
          tools: {
            profile: "default",
          },
          sandbox: {
            mode: "workspace",
            workspaceAccess: "rw",
          },
          skills: {
            enabled: true,
          },
          session: {
            reuse: "provider",
          },
          heartbeat: {
            enabled: true,
            intervalSeconds: 300,
            maxConsecutiveFollowUps: 3,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await orchestration.runAgentLoop("alpha", {
      maxCycles: 1,
      stopWhenIdle: true,
    })

    expect(activationQueueCalls).toEqual([600_000, 5_000])
  })

  it("re-queries activations between executions so newly ready higher-priority work can preempt the remaining snapshot", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw new Error("should not run")
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const first = await store.createSession({ agentId: "alpha" })
    const second = await store.createSession({ agentId: "alpha" })
    const third = await store.createSession({ agentId: "alpha" })
    let phase = 0

    const activationQueue: SessionActivationQueue = {
      async listReadyActivations() {
        if (phase === 0) {
          return [
            {
              sessionId: first.id,
              agentId: "alpha",
              kind: "queued_wake",
              priority: "normal",
              dueAt: "2026-04-10T10:00:00.000Z",
              reason: "session.revisit.first",
              note: null,
              dueWakes: [],
            },
            {
              sessionId: second.id,
              agentId: "alpha",
              kind: "queued_wake",
              priority: "normal",
              dueAt: "2026-04-10T10:00:01.000Z",
              reason: "session.revisit.second",
              note: null,
              dueWakes: [],
            },
          ]
        }
        if (phase === 1) {
          return [
            {
              sessionId: third.id,
              agentId: "alpha",
              kind: "pending_events",
              priority: "high",
              dueAt: null,
              reason: "user.message",
              note: null,
              dueWakes: [],
            },
            {
              sessionId: second.id,
              agentId: "alpha",
              kind: "queued_wake",
              priority: "normal",
              dueAt: "2026-04-10T10:00:01.000Z",
              reason: "session.revisit.second",
              note: null,
              dueWakes: [],
            },
          ]
        }
        if (phase === 2) {
          return [
            {
              sessionId: second.id,
              agentId: "alpha",
              kind: "queued_wake",
              priority: "normal",
              dueAt: "2026-04-10T10:00:01.000Z",
              reason: "session.revisit.second",
              note: null,
              dueWakes: [],
            },
          ]
        }
        return []
      },
      async nextReadyActivation(_agentId, _at, options) {
        const activations = await this.listReadyActivations()
        const excluded = new Set(options?.excludeSessionIds ?? [])
        return activations.find((activation) => !excluded.has(activation.sessionId)) ?? null
      },
      async leaseNextActivation(agentId, options) {
        const activation = await this.nextReadyActivation(agentId, options?.at, options)
        if (!activation) {
          return { status: "none" as const }
        }
        return {
          status: "leased" as const,
          leased: {
            activation,
            async renew() {},
            async ack() {},
            async abandon() {},
          },
        }
      },
      async peekNextReadyAt() {
        return null
      },
      async waitForChange(_agentId, options) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.timeoutMs, 5)))
      },
    }

    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      activationQueue,
    })
    const executionOrder: string[] = []
    vi.spyOn(orchestration, "wake").mockImplementation(async (sessionId) => {
      executionOrder.push(sessionId)
      if (sessionId === first.id) {
        phase = 1
      } else if (sessionId === third.id) {
        phase = 2
      } else {
        phase = 3
      }
      const snapshot = await store.getSession(sessionId)
      return {
        session: snapshot.session,
        wakeId: null,
        executed: true,
        skippedReason: null,
        response: "ok",
        responsePreview: "ok",
        stopReason: "idle",
        queuedWakeIds: [],
        queuedWakeSummaries: [],
        requeue: null,
        processedEventIds: [],
        consumedInputs: [],
        wakeEvents: [],
      }
    })

    const result = await orchestration.runAgentLoop("alpha", {
      maxCycles: 1,
      stopWhenIdle: true,
    })

    expect(result.executed).toBe(3)
    expect(executionOrder).toEqual([first.id, third.id, second.id])
  })

  it("continues to the next ready activation when one wake throws and reports the failure through onSkip", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw new Error("should not run")
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const first = await store.createSession({ agentId: "alpha" })
    const second = await store.createSession({ agentId: "alpha" })
    let leaseIndex = 0

    const activationQueue: SessionActivationQueue = {
      async listReadyActivations() {
        return []
      },
      async nextReadyActivation() {
        return null
      },
      async leaseNextActivation() {
        const activations = [
          {
            sessionId: first.id,
            agentId: "alpha",
            kind: "queued_wake" as const,
            priority: "normal" as const,
            dueAt: "2026-04-10T10:00:00.000Z",
            reason: "session.revisit.first",
            note: "first",
            dueWakes: [],
          },
          {
            sessionId: second.id,
            agentId: "alpha",
            kind: "queued_wake" as const,
            priority: "normal" as const,
            dueAt: "2026-04-10T10:00:01.000Z",
            reason: "session.revisit.second",
            note: "second",
            dueWakes: [],
          },
        ]
        const activation = activations[leaseIndex] ?? null
        leaseIndex += 1
        if (!activation) {
          return { status: "none" as const }
        }
        return {
          status: "leased" as const,
          leased: {
            activation,
            async renew() {},
            async ack() {},
            async abandon() {},
          },
        }
      },
      async peekNextReadyAt() {
        return null
      },
      async waitForChange(_agentId, options) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.timeoutMs, 5)))
      },
    }

    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      activationQueue,
    })
    const wake = vi.spyOn(orchestration, "wake")
    wake.mockRejectedValueOnce(new Error("lease renew failed")).mockResolvedValueOnce({
      session: {
        ...(await store.getAgentSession("alpha", second.id)).session,
        status: "idle",
        stopReason: "idle",
      },
      wakeId: "wake-second-success",
      executed: true,
      skippedReason: null,
      response: "handled second",
      responsePreview: "handled second",
      stopReason: "idle",
      queuedWakeIds: [],
      queuedWakeSummaries: [],
      requeue: null,
      processedEventIds: ["event-second-success"],
      consumedInputs: [],
      wakeEvents: [],
    })

    const skips: Array<{ sessionId: string; reason: string; errorMessage?: string }> = []
    const result = await orchestration.runAgentLoop("alpha", {
      maxCycles: 1,
      stopWhenIdle: true,
      onSkip: (skip) => {
        skips.push({
          sessionId: skip.sessionId,
          reason: skip.reason,
          errorMessage: skip.errorMessage,
        })
      },
    })

    expect(result.executed).toBe(1)
    expect(skips).toEqual([
      {
        sessionId: first.id,
        reason: "wake_failed",
        errorMessage: "lease renew failed",
      },
    ])
    expect(wake).toHaveBeenCalledTimes(2)
  })

  it("defers pending-event activations briefly after a wake failure", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-10T10:00:00.000Z"))
    try {
      const companyDir = await createCompanyFixture()
      await createOfflineCodexAgent(companyDir, "alpha")
      const store = new SessionStore(companyDir)
      const queue = new SessionWakeQueue(companyDir, store)
      const inspectionQueue = new LocalSessionActivationQueue(store, queue)
      const harness = new AgentHarness(companyDir, {
        authProvider: {
          async resolve() {
            return NONE_AUTH
          },
        },
      })
      const session = await store.createSession({ agentId: "alpha" })

      await store.emitEvent(session.id, {
        id: "event-wake-failed-backoff",
        type: "user.message",
        createdAt: "2026-04-10T10:00:00.000Z",
        processedAt: null,
        message: "fail then cool down",
      })

      let leased = false
      const activationQueue: SessionActivationQueue = {
        async listReadyActivations() {
          return []
        },
        async nextReadyActivation() {
          return null
        },
        async leaseNextActivation() {
          if (leased) {
            return { status: "none" as const }
          }
          leased = true
          return {
            status: "leased" as const,
            leased: {
              activation: {
                sessionId: session.id,
                agentId: "alpha",
                kind: "pending_events" as const,
                priority: "high" as const,
                dueAt: null,
                reason: "pending session events",
                note: null,
                dueWakes: [],
              },
              async renew() {},
              async ack() {},
              async abandon() {},
            },
          }
        },
        async peekNextReadyAt() {
          return null
        },
        async waitForChange() {},
      }

      const orchestration = new AgentOrchestration(companyDir, {
        sessionStore: store,
        harness,
        wakeQueue: queue,
        activationQueue,
      })
      vi.spyOn(orchestration, "wake").mockRejectedValueOnce(new Error("synthetic wake failure"))

      const result = await orchestration.runAgentLoop("alpha", {
        maxCycles: 1,
        stopWhenIdle: false,
      })

      expect(result.cycles).toBe(1)
      const executionState = await store.getSessionExecutionRuntimeStateForAgentSession(
        "alpha",
        session.id,
      )
      expect(executionState.deferUntil).toBe("2026-04-10T10:00:02.000Z")

      const hiddenDuringBackoff = await inspectionQueue.listReadyActivations(
        "alpha",
        "2026-04-10T10:00:01.000Z",
      )
      expect(hiddenDuringBackoff.map((activation) => activation.sessionId)).not.toContain(
        session.id,
      )

      const readyAfterBackoff = await inspectionQueue.listReadyActivations(
        "alpha",
        "2026-04-10T10:00:02.000Z",
      )
      expect(readyAfterBackoff.map((activation) => activation.sessionId)).toContain(session.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it("cancels queued wakes when a user interrupt redirects the session", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const queue = new SessionWakeQueue(companyDir, store)

    await queue.enqueue({
      sessionId: session.id,
      dueAt: "9999-12-31T23:59:59.000Z",
      reason: "session.follow_up",
      note: "future revisit",
      dedupeKey: "future-revisit",
      priority: "normal",
    })
    await store.updateSession(session.id, (current) => ({
      ...current,
      status: "rescheduling",
      stopReason: "rescheduling",
    }))
    await store.emitEvent(session.id, {
      id: "event-interrupt-only",
      type: "user.interrupt",
      createdAt: "2026-04-10T12:00:00.000Z",
      processedAt: null,
      note: "cancel queued revisit",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.interrupt: cancel queued revisit")
          return {
            response:
              'Interrupt handled.\n<openboa-session-loop>{"outcome":"sleep","summary":"Dropped the queued revisit.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
      wakeQueue: queue,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
    expect(result.queuedWakeIds).toHaveLength(0)

    const pending = await queue.listPending(session.id, "9999-12-31T23:59:59.000Z")
    expect(pending).toHaveLength(0)
  })

  it("watch mode wakes on runnable-index changes instead of waiting for the full poll interval", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.message: watcher-triggered message")
          return {
            response:
              'Handled watcher-triggered event.\n<openboa-session-loop>{"outcome":"sleep","summary":"Watcher-triggered event handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const controller = new AbortController()
    setTimeout(() => {
      void store.emitEvent(session.id, {
        id: "event-user-watcher",
        type: "user.message",
        createdAt: new Date().toISOString(),
        processedAt: null,
        message: "watcher-triggered message",
      })
    }, 20)

    const startedAt = Date.now()
    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 1000,
      idleTimeoutMs: 1200,
      maxCycles: 10,
      signal: controller.signal,
      onActivity: () => {
        controller.abort()
      },
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.executed).toBe(1)
    expect(result.stopReason).toBe("interrupted")
    expect(elapsedMs).toBeLessThan(700)
  })

  it("watch mode can scope consumption to a target session even when another session is already runnable", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const otherSession = await store.createSession({ agentId: "alpha" })
    const targetSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(otherSession.id, {
      id: "event-other-ready-first",
      type: "user.message",
      createdAt: "2026-04-10T12:00:00.000Z",
      processedAt: null,
      message: "other runnable work",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.message: target runnable work")
          expect(input.message).not.toContain("other runnable work")
          return {
            response:
              'Handled target runnable work.\n<openboa-session-loop>{"outcome":"sleep","summary":"Target runnable work handled.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const controller = new AbortController()
    setTimeout(() => {
      void store.emitEvent(targetSession.id, {
        id: "event-target-ready",
        type: "user.message",
        createdAt: new Date().toISOString(),
        processedAt: null,
        message: "target runnable work",
      })
    }, 20)

    const result = await orchestration.runAgentLoop("alpha", {
      watch: true,
      pollIntervalMs: 1000,
      idleTimeoutMs: 1200,
      maxCycles: 10,
      signal: controller.signal,
      allowedSessionIds: [targetSession.id],
      onActivity: (activity) => {
        if (activity.sessionId === targetSession.id) {
          controller.abort()
        }
      },
    })

    expect(result.executed).toBe(1)
    expect(result.stopReason).toBe("interrupted")

    const otherSnapshot = await store.getSession(otherSession.id)
    expect(otherSnapshot.events.some((event) => event.processedAt === null)).toBe(true)
  })

  it("waitForChange reacts to active wake-lease index updates without waiting for the full timeout", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)
    const session = await store.createSession({ agentId: "alpha" })

    const startedAt = Date.now()
    const waitPromise = activationQueue.waitForChange("alpha", {
      timeoutMs: 1000,
    })

    setTimeout(() => {
      void store.acquireWakeLease(session.id, "watch-lease-owner")
    }, 20)

    await waitPromise
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it("waitForChange returns immediately when a runnable activation already exists before the wait arm completes", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const queue = new SessionWakeQueue(companyDir, store)
    const activationQueue = new LocalSessionActivationQueue(store, queue)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-ready-before-wait",
      type: "user.message",
      createdAt: new Date().toISOString(),
      processedAt: null,
      message: "ready before wait arm completes",
    })

    const startedAt = Date.now()
    await activationQueue.waitForChange("alpha", {
      timeoutMs: 1000,
    })

    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})
