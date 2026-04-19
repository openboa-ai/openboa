import { nowIsoString } from "../../foundation/time.js"
import type { HarnessRunResult, Session, SessionEvent } from "../schema/runtime.js"
import { summarizePendingEvent } from "../sessions/context-builder.js"
import type { SessionStore } from "../sessions/session-store.js"
import type {
  ActivationAbandonJournalInput,
  ActivationAckJournalInput,
} from "./activation-journal.js"
import type { LeasedSessionActivation, SessionActivation } from "./session-activation-queue.js"
import type { SessionWake, SessionWakeQueue } from "./session-wake-queue.js"

export interface WakeSummary {
  id: string
  dueAt: string
  reason: string
  note: string | null
  priority: "low" | "normal" | "high"
}

export interface WakeSessionResult {
  session: Session
  wakeId: string | null
  executed: boolean
  skippedReason: string | null
  response: string | null
  responsePreview: string | null
  stopReason: string
  queuedWakeIds: string[]
  queuedWakeSummaries: WakeSummary[]
  requeue: WakeRequeueSummary | null
  processedEventIds: string[]
  consumedInputs: string[]
  wakeEvents: SessionEvent[]
}

export type WakeRequeueSummary = NonNullable<ActivationAckJournalInput["requeue"]>

export interface SessionLoopRunResult {
  cycles: number
  executed: number
  stopReason: "idle" | "max_cycles"
  lastWake: WakeSessionResult | null
  finalSession: Session
}

interface WakeHarnessContext {
  reason: string
  note: string | null
}

interface RuntimeWakeLease {
  renew(): Promise<void>
  ack(details?: ActivationAckJournalInput): Promise<void>
  abandon(details?: ActivationAbandonJournalInput): Promise<void>
}

const MAX_PREVIEW_LENGTH = 240
const DEFAULT_WAKE_LEASE_HEARTBEAT_MS = 60_000
const DEFAULT_WAKE_FAILURE_RETRY_DELAY_MS = 2_000

function compactPreview(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? ""
  if (!normalized) {
    return null
  }
  if (normalized.length <= MAX_PREVIEW_LENGTH) {
    return normalized
  }
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…`
}

function summarizeWakeContext(input: { reason: string; note: string | null }): string {
  const note = compactPreview(input.note)
  return note ? `queued_wake: ${input.reason} (${note})` : `queued_wake: ${input.reason}`
}

export async function wakeSessionOnce(input: {
  sessionId: string
  activation?: SessionActivation
  leasedActivation?: LeasedSessionActivation
  wakeLease?: {
    staleAfterMs: number
    heartbeatMs: number
  }
  resilience?: {
    wakeFailureReplayDelayMs: number
    replayQueuedWakesOnFailure: boolean
  }
  sessionStore: SessionStore
  wakeQueue: SessionWakeQueue
  runHarness: (
    sessionId: string,
    wakeContext: WakeHarnessContext | null,
  ) => Promise<HarnessRunResult>
}): Promise<WakeSessionResult> {
  const lease =
    input.leasedActivation ??
    (await acquireOwnedWakeLease({
      sessionId: input.sessionId,
      sessionStore: input.sessionStore,
      wakeLease: input.wakeLease,
    }))
  if (!lease) {
    const snapshot = await input.sessionStore.getSession(input.sessionId)
    return {
      session: snapshot.session,
      wakeId: null,
      executed: false,
      skippedReason: "lease_contended",
      response: null,
      responsePreview: null,
      stopReason: snapshot.session.stopReason,
      queuedWakeIds: [],
      queuedWakeSummaries: [],
      requeue: null,
      processedEventIds: [],
      consumedInputs: [],
      wakeEvents: [],
    }
  }
  const heartbeat = setInterval(() => {
    void lease.renew().catch((error) => {
      if (!leaseRenewalError) {
        leaseRenewalError = error
      }
    })
  }, input.wakeLease?.heartbeatMs ?? DEFAULT_WAKE_LEASE_HEARTBEAT_MS)
  let releaseMode: "ack" | "abandon" = "abandon"
  let ackDetails: ActivationAckJournalInput | undefined
  let abandonDetails: ActivationAbandonJournalInput = {
    reason: "not_executed",
    errorMessage: null,
  }
  let leaseRenewalError: unknown = null
  let consumedWakes: SessionWake[] = []
  try {
    const snapshot = await input.sessionStore.getSession(input.sessionId)
    const session = snapshot.session
    const pendingEvents = snapshot.events.filter((event) => event.processedAt === null)
    const interrupted = pendingEvents.some((event) => event.type === "user.interrupt")
    const prefetchedDueWakes =
      input.activation?.kind === "queued_wake" ? input.activation.dueWakes : []
    const dueWakes = interrupted
      ? []
      : prefetchedDueWakes.length > 0
        ? prefetchedDueWakes
        : await input.wakeQueue.listPendingForAgentSession(session.agentId, input.sessionId)

    if (pendingEvents.length === 0 && dueWakes.length === 0) {
      abandonDetails = {
        reason: "idle",
        errorMessage: null,
      }
      return {
        session,
        wakeId: null,
        executed: false,
        skippedReason: "idle",
        response: null,
        responsePreview: null,
        stopReason: session.stopReason,
        queuedWakeIds: [],
        queuedWakeSummaries: [],
        requeue: null,
        processedEventIds: [],
        consumedInputs: [],
        wakeEvents: [],
      }
    }

    consumedWakes = interrupted
      ? await input.wakeQueue.cancelPendingForAgentSession(session.agentId, input.sessionId)
      : prefetchedDueWakes.length > 0
        ? await input.wakeQueue.consumeKnownForAgentSession(
            session.agentId,
            input.sessionId,
            prefetchedDueWakes,
          )
        : await input.wakeQueue.consumeDueForAgentSession(session.agentId, input.sessionId)
    const consumedInputs = [
      ...pendingEvents.map((event) => compactPreview(summarizePendingEvent(event))).filter(Boolean),
      ...consumedWakes.map((wake) =>
        compactPreview(summarizeWakeContext({ reason: wake.reason, note: wake.note })),
      ),
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
    const result = await input.runHarness(
      input.sessionId,
      consumedWakes[0]
        ? {
            reason: consumedWakes[0].reason,
            note: consumedWakes[0].note,
          }
        : null,
    )
    if (leaseRenewalError !== null) {
      const renewalError = leaseRenewalError
      abandonDetails = {
        reason: "wake_lease_renew_failed",
        errorMessage: renewalError instanceof Error ? renewalError.message : String(renewalError),
      }
      throw renewalError instanceof Error ? renewalError : new Error(String(renewalError))
    }
    const queuedWakes = await enqueueQueuedWakes({
      sessionId: input.sessionId,
      wakeQueue: input.wakeQueue,
      result,
    })
    const requeue =
      result.stopReason === "rescheduling"
        ? normalizeActivationRequeueDetails(
            await buildActivationRequeueDetails({
              sessionStore: input.sessionStore,
              wakeQueue: input.wakeQueue,
              session: result.session,
              queuedWakes,
            }),
          )
        : null
    const wakeEvents =
      result.wakeId === null
        ? []
        : (
            await input.sessionStore.listSessionJournalEvents(
              result.session.agentId,
              input.sessionId,
            )
          ).filter((event) => event.wakeId === result.wakeId)
    releaseMode = "ack"
    ackDetails = {
      wakeId: result.wakeId,
      stopReason: result.stopReason,
      queuedWakeIds: queuedWakes.map((wake) => wake.id),
      processedEventIds: [...result.processedEventIds],
      requeue,
    }

    return {
      session: result.session,
      wakeId: result.wakeId,
      executed: true,
      skippedReason: null,
      response: result.response,
      responsePreview: compactPreview(result.response),
      stopReason: result.stopReason,
      queuedWakeIds: queuedWakes.map((wake) => wake.id),
      queuedWakeSummaries: queuedWakes.map(summarizeQueuedWake),
      requeue,
      processedEventIds: result.processedEventIds,
      consumedInputs,
      wakeEvents,
    }
  } catch (error) {
    if (input.resilience?.replayQueuedWakesOnFailure !== false && consumedWakes.length > 0) {
      await restoreConsumedWakes(input.wakeQueue, consumedWakes, {
        retryDelayMs:
          input.resilience?.wakeFailureReplayDelayMs ?? DEFAULT_WAKE_FAILURE_RETRY_DELAY_MS,
      })
    }
    if (abandonDetails.reason === "not_executed") {
      abandonDetails = {
        reason: "wake_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
    throw error
  } finally {
    clearInterval(heartbeat)
    if (releaseMode === "ack") {
      await lease.ack(ackDetails)
    } else {
      await lease.abandon(abandonDetails)
    }
  }
}

function normalizeActivationRequeueDetails(
  requeue: ActivationAckJournalInput["requeue"],
): WakeRequeueSummary | null {
  if (!requeue) {
    return null
  }
  if (
    !requeue.immediateRetryAt &&
    !requeue.nextQueuedWakeAt &&
    (!Array.isArray(requeue.queuedWakeIds) || requeue.queuedWakeIds.length === 0)
  ) {
    return null
  }
  return {
    immediateRetryAt: requeue.immediateRetryAt,
    nextQueuedWakeAt: requeue.nextQueuedWakeAt,
    queuedWakeIds: [...requeue.queuedWakeIds],
  }
}

async function restoreConsumedWakes(
  wakeQueue: SessionWakeQueue,
  wakes: SessionWake[],
  options: {
    retryDelayMs?: number
  } = {},
): Promise<void> {
  const uniqueWakes = dedupeWakeRestoreList(wakes)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 0)
  const retryDueAt = retryDelayMs > 0 ? new Date(Date.now() + retryDelayMs).toISOString() : null
  for (const wake of uniqueWakes) {
    await wakeQueue.enqueue({
      sessionId: wake.sessionId,
      dueAt:
        retryDueAt && Date.parse(wake.dueAt) < Date.parse(retryDueAt) ? retryDueAt : wake.dueAt,
      reason: wake.reason,
      note: wake.note,
      dedupeKey: wake.dedupeKey,
      priority: wake.priority,
    })
  }
}

function dedupeWakeRestoreList(wakes: SessionWake[]): SessionWake[] {
  const seen = new Set<string>()
  const ordered = [...wakes].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))
  return ordered.filter((wake) => {
    if (seen.has(wake.id)) {
      return false
    }
    seen.add(wake.id)
    return true
  })
}

async function buildActivationRequeueDetails(input: {
  sessionStore: SessionStore
  wakeQueue: SessionWakeQueue
  session: Session
  queuedWakes: SessionWake[]
}): Promise<ActivationAckJournalInput["requeue"]> {
  const [executionState, pendingWakeState] = await Promise.all([
    input.sessionStore.getSessionExecutionRuntimeStateForAgentSession(
      input.session.agentId,
      input.session.id,
    ),
    input.wakeQueue.inspectPendingForAgentSession(input.session.agentId, input.session.id),
  ])
  return {
    immediateRetryAt: executionState.deferUntil,
    nextQueuedWakeAt: pendingWakeState.nextDueAt,
    queuedWakeIds: input.queuedWakes.map((wake) => wake.id),
  }
}

async function acquireOwnedWakeLease(input: {
  sessionId: string
  sessionStore: SessionStore
  wakeLease?: {
    staleAfterMs: number
    heartbeatMs: number
  }
}): Promise<RuntimeWakeLease | null> {
  const lease = await input.sessionStore.acquireWakeLease(
    input.sessionId,
    `wake-session:${input.sessionId}:${nowIsoString()}`,
    {
      staleAfterMs: input.wakeLease?.staleAfterMs,
    },
  )
  if (!lease) {
    return null
  }
  let closed = false
  const close = async () => {
    if (closed) {
      return
    }
    closed = true
    await lease.release()
  }
  return {
    renew: () => lease.renew(),
    ack: () => close(),
    abandon: () => close(),
  }
}

export async function runSessionLoop(input: {
  sessionId: string
  maxCycles: number
  sessionStore: SessionStore
  wakeQueue: SessionWakeQueue
  runHarness: (
    sessionId: string,
    wakeContext: WakeHarnessContext | null,
  ) => Promise<HarnessRunResult>
  stopWhenIdle?: boolean
}): Promise<SessionLoopRunResult> {
  let cycles = 0
  let executed = 0
  let lastWake: WakeSessionResult | null = null

  while (cycles < input.maxCycles) {
    const result = await wakeSessionOnce({
      sessionId: input.sessionId,
      sessionStore: input.sessionStore,
      wakeQueue: input.wakeQueue,
      runHarness: input.runHarness,
    })
    cycles += 1
    lastWake = result
    if (result.executed) {
      executed += 1
    }
    if (!result.executed && input.stopWhenIdle !== false) {
      return {
        cycles,
        executed,
        stopReason: "idle",
        lastWake,
        finalSession: result.session,
      }
    }
    if (result.executed && result.stopReason === "idle" && input.stopWhenIdle !== false) {
      return {
        cycles,
        executed,
        stopReason: "idle",
        lastWake,
        finalSession: result.session,
      }
    }
  }

  const finalSession =
    lastWake?.session ?? (await input.sessionStore.getSession(input.sessionId)).session
  return {
    cycles,
    executed,
    stopReason: "max_cycles",
    lastWake,
    finalSession,
  }
}

async function enqueueQueuedWakes(input: {
  sessionId: string
  wakeQueue: SessionWakeQueue
  result: HarnessRunResult
}): Promise<SessionWake[]> {
  const queuedWakes: SessionWake[] = []
  for (const wake of input.result.queuedWakes) {
    const queued = await input.wakeQueue.enqueue({
      sessionId: input.sessionId,
      dueAt: wake.dueAt,
      reason: wake.reason,
      note: wake.note,
      dedupeKey: wake.dedupeKey,
      priority: wake.priority,
    })
    queuedWakes.push(queued)
  }
  return queuedWakes
}

function summarizeQueuedWake(wake: SessionWake): WakeSummary {
  return {
    id: wake.id,
    dueAt: wake.dueAt,
    reason: wake.reason,
    note: wake.note,
    priority: wake.priority,
  }
}
