import { watch as fsWatch } from "node:fs"
import { mkdir } from "node:fs/promises"
import { makeUuidV7 } from "../../foundation/ids.js"
import type { SessionStore } from "../sessions/session-store.js"
import {
  type ActivationAbandonJournalInput,
  type ActivationAckJournalInput,
  ActivationJournal,
  type ActivationRequeueJournalInput,
} from "./activation-journal.js"
import type { SessionWake, SessionWakeQueue } from "./session-wake-queue.js"

export interface SessionActivation {
  sessionId: string
  agentId: string
  kind: "pending_events" | "queued_wake"
  priority: "high" | "normal" | "low"
  dueAt: string | null
  reason: string
  note: string | null
  dueWakes: SessionWake[]
}

export interface LeasedSessionActivation {
  claimId: string
  leaseOwner: string
  activation: SessionActivation
  renew(): Promise<void>
  ack(details?: ActivationAckJournalInput): Promise<void>
  abandon(details?: ActivationAbandonJournalInput): Promise<void>
}

export type LeaseNextActivationResult =
  | {
      status: "leased"
      leased: LeasedSessionActivation
    }
  | {
      status: "blocked"
      claimId: string
      activation: SessionActivation
      reason: "lease_contended"
    }
  | {
      status: "none"
    }

export interface SessionActivationQueue {
  listReadyActivations(
    agentId: string,
    at?: string,
    options?: {
      wakeLeaseStaleAfterMs?: number
      allowedSessionIds?: Iterable<string>
    },
  ): Promise<SessionActivation[]>
  nextReadyActivation(
    agentId: string,
    at?: string,
    options?: {
      wakeLeaseStaleAfterMs?: number
      excludeSessionIds?: Iterable<string>
      allowedSessionIds?: Iterable<string>
    },
  ): Promise<SessionActivation | null>
  leaseNextActivation(
    agentId: string,
    options?: {
      at?: string
      wakeLeaseStaleAfterMs?: number
      excludeSessionIds?: Iterable<string>
      allowedSessionIds?: Iterable<string>
      leaseOwner?: string
    },
  ): Promise<LeaseNextActivationResult>
  peekNextReadyAt(
    agentId: string,
    options?: {
      allowedSessionIds?: Iterable<string>
    },
  ): Promise<string | null>
  waitForChange(
    agentId: string,
    options: {
      timeoutMs: number
      signal?: AbortSignal
      wakeLeaseStaleAfterMs?: number
      allowedSessionIds?: Iterable<string>
    },
  ): Promise<void>
}

export class LocalSessionActivationQueue implements SessionActivationQueue {
  private readonly activationJournal: ActivationJournal

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly wakeQueue: SessionWakeQueue,
    activationJournal?: ActivationJournal,
  ) {
    this.activationJournal = activationJournal ?? new ActivationJournal(sessionStore)
  }

  async listReadyActivations(
    agentId: string,
    at?: string,
    options: {
      wakeLeaseStaleAfterMs?: number
      allowedSessionIds?: Iterable<string>
    } = {},
  ): Promise<SessionActivation[]> {
    const allowedSessionIds = options.allowedSessionIds ? new Set(options.allowedSessionIds) : null
    const leasedSessionIds = new Set(
      await this.sessionStore.listActiveWakeLeaseSessionIds(agentId, {
        staleAfterMs: options.wakeLeaseStaleAfterMs,
      }),
    )
    const [immediateActivations, delayedActivations] = await Promise.all([
      this.listImmediateActivations(agentId, leasedSessionIds, at, allowedSessionIds),
      this.listDelayedActivations(agentId, at, leasedSessionIds, allowedSessionIds),
    ])
    const activations = mergeActivations(immediateActivations, delayedActivations)
    return activations.sort(compareActivations)
  }

  async peekNextReadyAt(
    agentId: string,
    options: {
      allowedSessionIds?: Iterable<string>
    } = {},
  ): Promise<string | null> {
    const allowedSessionIds = options.allowedSessionIds ? new Set(options.allowedSessionIds) : null
    const [nextQueuedWakeAt, runnableSessions] = await Promise.all([
      this.wakeQueue.peekNextDueAt(agentId, {
        allowedSessionIds,
      }),
      this.sessionStore.listRunnableSessions(agentId),
    ])
    const nextDeferredImmediateAt =
      runnableSessions
        .filter((entry) => !allowedSessionIds || allowedSessionIds.has(entry.sessionId))
        .map((entry) => entry.deferUntil)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
    if (!nextQueuedWakeAt) {
      return nextDeferredImmediateAt
    }
    if (!nextDeferredImmediateAt) {
      return nextQueuedWakeAt
    }
    return Date.parse(nextQueuedWakeAt) <= Date.parse(nextDeferredImmediateAt)
      ? nextQueuedWakeAt
      : nextDeferredImmediateAt
  }

  async leaseNextActivation(
    agentId: string,
    options: {
      at?: string
      wakeLeaseStaleAfterMs?: number
      excludeSessionIds?: Iterable<string>
      allowedSessionIds?: Iterable<string>
      leaseOwner?: string
    } = {},
  ): Promise<LeaseNextActivationResult> {
    const excluded = new Set(options.excludeSessionIds ?? [])
    const activeLeasedSessionIds = await this.sessionStore.listActiveWakeLeaseSessionIds(agentId, {
      staleAfterMs: options.wakeLeaseStaleAfterMs,
    })
    for (const sessionId of activeLeasedSessionIds) {
      excluded.add(sessionId)
    }

    let lastBlocked: {
      claimId: string
      activation: SessionActivation
      reason: "lease_contended"
    } | null = null

    while (true) {
      const activation = await this.nextReadyActivation(agentId, options.at, {
        wakeLeaseStaleAfterMs: options.wakeLeaseStaleAfterMs,
        excludeSessionIds: excluded,
        allowedSessionIds: options.allowedSessionIds,
      })
      if (!activation) {
        if (lastBlocked) {
          return {
            status: "blocked",
            claimId: lastBlocked.claimId,
            activation: lastBlocked.activation,
            reason: lastBlocked.reason,
          }
        }
        return { status: "none" }
      }

      const owner =
        typeof options.leaseOwner === "string" && options.leaseOwner.trim().length > 0
          ? options.leaseOwner.trim()
          : `activation:${agentId}:${activation.sessionId}`
      const claimId = makeUuidV7()
      const lease = await this.sessionStore.acquireWakeLease(activation.sessionId, owner, {
        staleAfterMs: options.wakeLeaseStaleAfterMs,
      })
      if (!lease) {
        await this.activationJournal.recordBlocked({
          agentId,
          activation,
          leaseOwner: owner,
          blockedReason: "lease_contended",
          claimId,
        })
        lastBlocked = {
          claimId,
          activation,
          reason: "lease_contended",
        }
        excluded.add(activation.sessionId)
        continue
      }
      await this.activationJournal.recordLeased({
        agentId,
        activation,
        leaseOwner: owner,
        claimId,
      })
      let closed = false
      const close = async (
        kind: "acked" | "abandoned",
        details?: ActivationAckJournalInput | ActivationAbandonJournalInput,
      ) => {
        if (closed) {
          return
        }
        closed = true
        try {
          if (kind === "acked") {
            const ack = details as ActivationAckJournalInput | undefined
            await this.activationJournal.recordAcked({
              agentId,
              activation,
              leaseOwner: owner,
              claimId,
              ack: {
                wakeId: ack?.wakeId ?? null,
                stopReason: ack?.stopReason ?? "idle",
                queuedWakeIds: [...(ack?.queuedWakeIds ?? [])],
                processedEventIds: [...(ack?.processedEventIds ?? [])],
                requeue: ack?.requeue ?? null,
              },
            })
            if (hasMeaningfulRequeue(ack?.requeue)) {
              await this.activationJournal.recordRequeued({
                agentId,
                activation,
                leaseOwner: owner,
                claimId,
                requeue: ack?.requeue as ActivationRequeueJournalInput,
              })
            }
          } else {
            const abandon = details as ActivationAbandonJournalInput | undefined
            await this.activationJournal.recordAbandoned({
              agentId,
              activation,
              leaseOwner: owner,
              claimId,
              abandon: {
                reason: abandon?.reason ?? "abandoned",
                errorMessage: abandon?.errorMessage ?? null,
              },
            })
          }
        } finally {
          await lease.release()
        }
      }
      return {
        status: "leased",
        leased: {
          claimId,
          leaseOwner: owner,
          activation,
          renew: () => lease.renew(),
          ack: (details) => close("acked", details),
          abandon: (details) => close("abandoned", details),
        },
      }
    }
  }

  async nextReadyActivation(
    agentId: string,
    at?: string,
    options: {
      wakeLeaseStaleAfterMs?: number
      excludeSessionIds?: Iterable<string>
      allowedSessionIds?: Iterable<string>
    } = {},
  ): Promise<SessionActivation | null> {
    const readyActivations = await this.listReadyActivations(agentId, at, {
      wakeLeaseStaleAfterMs: options.wakeLeaseStaleAfterMs,
      allowedSessionIds: options.allowedSessionIds,
    })
    if (!options.excludeSessionIds) {
      return readyActivations[0] ?? null
    }
    const excluded = new Set(options.excludeSessionIds)
    for (const activation of readyActivations) {
      if (!excluded.has(activation.sessionId)) {
        return activation
      }
    }
    return null
  }

  async waitForChange(
    agentId: string,
    options: {
      timeoutMs: number
      signal?: AbortSignal
      wakeLeaseStaleAfterMs?: number
      allowedSessionIds?: Iterable<string>
    },
  ): Promise<void> {
    const timeoutMs = Math.max(1, options.timeoutMs)
    const runtimeDir = this.sessionStore.agentRuntimeDir(agentId)
    await mkdir(runtimeDir, { recursive: true })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let watcher: ReturnType<typeof fsWatch> | null = null
      const unsubscribeRuntimeIndex = this.sessionStore.onAgentRuntimeIndexChanged(agentId, () =>
        finish(resolve),
      )
      const unsubscribePendingWakeIndex = this.wakeQueue.onPendingWakeIndexChanged(agentId, () =>
        finish(resolve),
      )
      const finish = (callback: () => void) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      const timeout = setTimeout(() => finish(resolve), timeoutMs)
      const onAbort = () => finish(() => reject(new Error("aborted")))
      const cleanup = () => {
        clearTimeout(timeout)
        watcher?.close()
        unsubscribeRuntimeIndex()
        unsubscribePendingWakeIndex()
        options.signal?.removeEventListener("abort", onAbort)
      }

      try {
        watcher = fsWatch(runtimeDir, (_eventType, filename) => {
          if (!filename) {
            finish(resolve)
            return
          }
          const changed = filename.toString()
          if (
            changed.startsWith("runnable-sessions") ||
            changed.startsWith("pending-wake-sessions") ||
            changed.startsWith("active-wake-leases")
          ) {
            finish(resolve)
          }
        })
        watcher.on("error", () => {
          watcher?.close()
          watcher = null
        })
      } catch {
        watcher = null
      }

      void this.listReadyActivations(agentId, undefined, {
        wakeLeaseStaleAfterMs: options.wakeLeaseStaleAfterMs,
        allowedSessionIds: options.allowedSessionIds,
      })
        .then((readyActivations) => {
          if (readyActivations.length > 0) {
            finish(resolve)
          }
        })
        .catch(() => undefined)

      if (!options.signal) {
        return
      }
      if (options.signal.aborted) {
        finish(() => reject(new Error("aborted")))
        return
      }
      options.signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  private async listImmediateActivations(
    agentId: string,
    leasedSessionIds: Set<string>,
    at?: string,
    allowedSessionIds?: Set<string> | null,
  ): Promise<SessionActivation[]> {
    const runnableSessions = await this.sessionStore.listRunnableSessions(agentId)
    const asOfMs =
      typeof at === "string" && Number.isFinite(Date.parse(at)) ? Date.parse(at) : Date.now()
    const activations: SessionActivation[] = []
    for (const entry of runnableSessions) {
      if (allowedSessionIds && !allowedSessionIds.has(entry.sessionId)) {
        continue
      }
      if (leasedSessionIds.has(entry.sessionId)) {
        continue
      }
      if (entry.deferUntil && Date.parse(entry.deferUntil) > asOfMs) {
        continue
      }
      activations.push({
        sessionId: entry.sessionId,
        agentId,
        kind: "pending_events",
        priority: "high",
        dueAt: null,
        reason: entry.pendingEventType ?? "session.pending_events",
        note: null,
        dueWakes: [],
      })
    }
    return activations
  }

  private async listDelayedActivations(
    agentId: string,
    at?: string,
    leasedSessionIds?: Set<string>,
    allowedSessionIds?: Set<string> | null,
  ): Promise<SessionActivation[]> {
    const dueSessions = await this.wakeQueue.listDueSessionWakes(agentId, at)
    const activations: SessionActivation[] = []

    for (const dueSession of dueSessions) {
      const sessionId = dueSession.sessionId
      if (allowedSessionIds && !allowedSessionIds.has(sessionId)) {
        continue
      }
      if (leasedSessionIds?.has(sessionId)) {
        continue
      }
      const nextWake = dueSession.dueWakes[0] ?? null
      if (!nextWake) {
        continue
      }
      activations.push({
        sessionId,
        agentId,
        kind: "queued_wake",
        priority: nextWake.priority,
        dueAt: nextWake.dueAt,
        reason: nextWake.reason,
        note: nextWake.note,
        dueWakes: dueSession.dueWakes,
      })
    }

    return activations
  }
}

function hasMeaningfulRequeue(
  requeue: ActivationRequeueJournalInput | null | undefined,
): requeue is ActivationRequeueJournalInput {
  if (!requeue) {
    return false
  }
  return Boolean(
    requeue.immediateRetryAt ||
      requeue.nextQueuedWakeAt ||
      (Array.isArray(requeue.queuedWakeIds) && requeue.queuedWakeIds.length > 0),
  )
}

function mergeActivations(
  immediateActivations: SessionActivation[],
  delayedActivations: SessionActivation[],
): SessionActivation[] {
  const immediateSessionIds = new Set(
    immediateActivations.map((activation) => activation.sessionId),
  )
  return [
    ...immediateActivations,
    ...delayedActivations.filter((activation) => !immediateSessionIds.has(activation.sessionId)),
  ]
}

function compareActivations(left: SessionActivation, right: SessionActivation): number {
  const priorityDiff = priorityRank(right.priority) - priorityRank(left.priority)
  if (priorityDiff !== 0) {
    return priorityDiff
  }
  const kindDiff = activationKindRank(left.kind) - activationKindRank(right.kind)
  if (kindDiff !== 0) {
    return kindDiff
  }
  if (left.dueAt && right.dueAt) {
    const dueDiff = Date.parse(left.dueAt) - Date.parse(right.dueAt)
    if (dueDiff !== 0) {
      return dueDiff
    }
  } else if (left.dueAt || right.dueAt) {
    return left.dueAt ? 1 : -1
  }
  return left.sessionId.localeCompare(right.sessionId)
}

function priorityRank(priority: SessionActivation["priority"]): number {
  switch (priority) {
    case "high":
      return 3
    case "normal":
      return 2
    case "low":
      return 1
  }
}

function activationKindRank(kind: SessionActivation["kind"]): number {
  switch (kind) {
    case "pending_events":
      return 0
    case "queued_wake":
      return 1
  }
}
