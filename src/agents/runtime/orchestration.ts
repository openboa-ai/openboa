import { stat } from "node:fs/promises"
import { nowIsoString } from "../../foundation/time.js"
import { agentConfigPath, loadAgentConfig, resolveWakeLeasePolicy } from "../agent-config.js"
import type { Session, SessionEvent } from "../schema/runtime.js"
import { SessionStore } from "../sessions/session-store.js"
import { AgentHarness } from "./harness.js"
import {
  type LeasedSessionActivation,
  LocalSessionActivationQueue,
  type SessionActivation,
  type SessionActivationQueue,
} from "./session-activation-queue.js"
import { SessionWakeQueue } from "./session-wake-queue.js"
import { type WakeRequeueSummary, type WakeSummary, wakeSessionOnce } from "./wake-session.js"

export interface WakeResult {
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

export interface AgentOrchestratorLoopResult {
  cycles: number
  executed: number
  stopReason: "idle" | "max_cycles" | "idle_timeout" | "interrupted"
}

export interface AgentOrchestratorActivity {
  cycle: number
  sessionId: string
  activationClaimId: string
  wakeId: string | null
  stopReason: string
  processedEventCount: number
  queuedWakeCount: number
  queuedWakeSummaries: WakeSummary[]
  requeue: WakeRequeueSummary | null
  consumedInputs: string[]
  responsePreview: string | null
  runnablePendingEventType: string | null
  deferUntil: string | null
  failureStreak: number
  pendingWakeCount: number
  nextQueuedWakeAt: string | null
  pendingToolConfirmation: {
    id: string
    toolName: string
    permissionPolicy: string
  } | null
  pendingCustomTool: {
    id: string
    name: string
    input: Record<string, unknown>
    requestedAt: string
  } | null
  wakeEvents: SessionEvent[]
}

export interface AgentOrchestratorSkipActivity {
  cycle: number
  sessionId: string
  activationClaimId: string
  activationKind: SessionActivation["kind"]
  reason: string
  errorMessage?: string
  nextRetryAt?: string
  failureStreak?: number
  activeWakeLease: {
    owner: string
    acquiredAt: string
  } | null
}

export class AgentOrchestration {
  private readonly companyDir: string
  private readonly sessionStore: SessionStore
  private readonly harness: AgentHarness
  private readonly wakeQueue: SessionWakeQueue
  private readonly activationQueue: SessionActivationQueue
  private readonly wakeLeasePolicyCache = new Map<
    string,
    {
      mtimeMs: number | null
      policy: Promise<{
        wakeLease: {
          staleAfterMs: number
          heartbeatMs: number
        }
        resilience: Awaited<ReturnType<typeof loadAgentConfig>>["resilience"]
      }>
    }
  >()

  constructor(
    companyDir: string,
    dependencies: {
      sessionStore?: SessionStore
      harness?: AgentHarness
      wakeQueue?: SessionWakeQueue
      activationQueue?: SessionActivationQueue
    } = {},
  ) {
    this.companyDir = companyDir
    this.sessionStore = dependencies.sessionStore ?? new SessionStore(companyDir)
    this.harness =
      dependencies.harness ??
      new AgentHarness(companyDir, {
        sessionStore: this.sessionStore,
      })
    this.wakeQueue = dependencies.wakeQueue ?? new SessionWakeQueue(companyDir, this.sessionStore)
    this.activationQueue =
      dependencies.activationQueue ??
      new LocalSessionActivationQueue(this.sessionStore, this.wakeQueue)
  }

  async wake(
    sessionId: string,
    activation?: SessionActivation,
    leasedActivation?: LeasedSessionActivation,
  ): Promise<WakeResult> {
    const agentId =
      activation?.agentId ?? (await this.sessionStore.getSession(sessionId)).session.agentId
    const runtimePolicy = await this.loadWakeLeasePolicy(agentId)
    return wakeSessionOnce({
      sessionId,
      activation,
      leasedActivation,
      wakeLease: runtimePolicy.wakeLease,
      resilience: {
        wakeFailureReplayDelayMs: runtimePolicy.resilience.retry.wakeFailureReplayDelayMs,
        replayQueuedWakesOnFailure: true,
      },
      sessionStore: this.sessionStore,
      wakeQueue: this.wakeQueue,
      runHarness: (targetSessionId, wakeContext) => this.harness.run(targetSessionId, wakeContext),
    })
  }

  async runAgentLoop(
    agentId: string,
    options: {
      maxCycles?: number
      stopWhenIdle?: boolean
      watch?: boolean
      pollIntervalMs?: number
      idleTimeoutMs?: number
      allowedSessionIds?: Iterable<string>
      signal?: AbortSignal
      onActivity?: (activity: AgentOrchestratorActivity) => void | Promise<void>
      onSkip?: (skip: AgentOrchestratorSkipActivity) => void | Promise<void>
    } = {},
  ): Promise<AgentOrchestratorLoopResult> {
    const runtimePolicy = await this.loadWakeLeasePolicy(agentId)
    let cycles = 0
    let executed = 0
    const reportedSkipReasons = new Map<string, string>()
    const watch = options.watch === true
    const maxCycles = options.maxCycles ?? (watch ? Number.POSITIVE_INFINITY : 10)
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 1000)
    const idleTimeoutMs =
      typeof options.idleTimeoutMs === "number" && Number.isFinite(options.idleTimeoutMs)
        ? Math.max(1, options.idleTimeoutMs)
        : null
    let idleSince = Date.now()

    while (cycles < maxCycles) {
      if (options.signal?.aborted) {
        return {
          cycles,
          executed,
          stopReason: "interrupted",
        }
      }

      let executedThisCycle = await this.executeReadyActivationsForCycle(
        agentId,
        cycles + 1,
        runtimePolicy.wakeLease.staleAfterMs,
        options.allowedSessionIds,
        options.onActivity,
        options.onSkip,
        reportedSkipReasons,
      )
      let ranCycle = executedThisCycle > 0

      cycles += 1
      if (ranCycle) {
        executed += executedThisCycle
        idleSince = Date.now()
      }

      if (!watch && !ranCycle && options.stopWhenIdle !== false) {
        return {
          cycles,
          executed,
          stopReason: "idle",
        }
      }

      if (watch) {
        if (!ranCycle && options.stopWhenIdle === true) {
          return {
            cycles,
            executed,
            stopReason: "idle",
          }
        }
        if (!ranCycle && idleTimeoutMs !== null && Date.now() - idleSince >= idleTimeoutMs) {
          executedThisCycle = await this.executeReadyActivationsForCycle(
            agentId,
            cycles,
            runtimePolicy.wakeLease.staleAfterMs,
            options.allowedSessionIds,
            options.onActivity,
            options.onSkip,
            reportedSkipReasons,
          )
          ranCycle = executedThisCycle > 0
          if (ranCycle) {
            executed += executedThisCycle
            idleSince = Date.now()
          } else {
            return {
              cycles,
              executed,
              stopReason: "idle_timeout",
            }
          }
        }

        try {
          await this.activationQueue.waitForChange(agentId, {
            timeoutMs: resolveWatchSleepMs({
              pollIntervalMs,
              nextDueAt: await this.activationQueue.peekNextReadyAt(agentId, {
                allowedSessionIds: options.allowedSessionIds,
              }),
              idleTimeoutMs,
              idleSince,
            }),
            signal: options.signal,
            wakeLeaseStaleAfterMs: runtimePolicy.wakeLease.staleAfterMs,
            allowedSessionIds: options.allowedSessionIds,
          })
        } catch {
          return {
            cycles,
            executed,
            stopReason: "interrupted",
          }
        }
      }
    }

    return {
      cycles,
      executed,
      stopReason: "max_cycles",
    }
  }

  private async executeReadyActivationsForCycle(
    agentId: string,
    cycle: number,
    wakeLeaseStaleAfterMs: number,
    allowedSessionIds: Iterable<string> | undefined,
    onActivity?: (activity: AgentOrchestratorActivity) => void | Promise<void>,
    onSkip?: (skip: AgentOrchestratorSkipActivity) => void | Promise<void>,
    reportedSkipReasons?: Map<string, string>,
  ): Promise<number> {
    let executed = 0
    const attemptedSessionIds = new Set<string>()
    while (true) {
      const leased = await this.activationQueue.leaseNextActivation(agentId, {
        wakeLeaseStaleAfterMs,
        excludeSessionIds: attemptedSessionIds,
        allowedSessionIds,
        leaseOwner: `orchestrator:${agentId}:cycle:${cycle}`,
      })
      if (leased.status === "none") {
        break
      }
      if (leased.status === "blocked") {
        attemptedSessionIds.add(leased.activation.sessionId)
        const executionState =
          await this.sessionStore.getSessionExecutionRuntimeStateForAgentSession(
            leased.activation.agentId,
            leased.activation.sessionId,
            {
              staleAfterMs: wakeLeaseStaleAfterMs,
            },
          )
        if (reportedSkipReasons?.get(leased.activation.sessionId) !== leased.reason) {
          reportedSkipReasons?.set(leased.activation.sessionId, leased.reason)
          await onSkip?.({
            cycle,
            sessionId: leased.activation.sessionId,
            activationClaimId: leased.claimId,
            activationKind: leased.activation.kind,
            reason: leased.reason,
            activeWakeLease: executionState.activeWakeLease,
          })
        }
        continue
      }
      const activation = leased.leased.activation
      attemptedSessionIds.add(activation.sessionId)
      let result: WakeResult
      try {
        result = await this.wake(activation.sessionId, activation, leased.leased)
      } catch (error) {
        let retryDetails: {
          deferUntil: string
          failureStreak: number
        } | null = null
        if (activation.kind === "pending_events") {
          await this.sessionStore.reconcileRunnableSession(activation.agentId, activation.sessionId)
          const runtimePolicy = await this.loadWakeLeasePolicy(activation.agentId)
          retryDetails = await this.sessionStore.backoffRunnableSession(activation.sessionId, {
            now: nowIsoString(),
            baseDelayMs: runtimePolicy.resilience.retry.pendingEventBackoffBaseMs,
            maxDelayMs: runtimePolicy.resilience.retry.pendingEventBackoffMaxMs,
          })
        }
        const executionState =
          await this.sessionStore.getSessionExecutionRuntimeStateForAgentSession(
            activation.agentId,
            activation.sessionId,
            {
              staleAfterMs: wakeLeaseStaleAfterMs,
            },
          )
        const errorMessage = error instanceof Error ? error.message : String(error)
        const reason = "wake_failed"
        const skipSignature = `${reason}:${errorMessage}`
        if (reportedSkipReasons?.get(activation.sessionId) !== skipSignature) {
          reportedSkipReasons?.set(activation.sessionId, skipSignature)
          await onSkip?.({
            cycle,
            sessionId: activation.sessionId,
            activationClaimId: leased.leased.claimId,
            activationKind: activation.kind,
            reason,
            errorMessage,
            nextRetryAt: retryDetails?.deferUntil ?? executionState.deferUntil ?? undefined,
            failureStreak: retryDetails?.failureStreak ?? executionState.failureStreak,
            activeWakeLease: executionState.activeWakeLease,
          })
        }
        continue
      }
      if (!result.executed) {
        if (activation.kind === "pending_events") {
          await this.sessionStore.reconcileRunnableSession(activation.agentId, activation.sessionId)
        }
        const reason = result.skippedReason ?? "not_executed"
        const skipSignature = reason
        if (reportedSkipReasons?.get(activation.sessionId) !== skipSignature) {
          reportedSkipReasons?.set(activation.sessionId, skipSignature)
          await onSkip?.({
            cycle,
            sessionId: activation.sessionId,
            activationClaimId: leased.leased.claimId,
            activationKind: activation.kind,
            reason,
            activeWakeLease: null,
          })
        }
        continue
      }
      executed += 1
      reportedSkipReasons?.delete(activation.sessionId)
      const [executionState, pendingWakeState] = await Promise.all([
        this.sessionStore.getSessionExecutionRuntimeStateForAgentSession(
          activation.agentId,
          activation.sessionId,
          {
            staleAfterMs: wakeLeaseStaleAfterMs,
          },
        ),
        this.wakeQueue.inspectPendingForAgentSession(activation.agentId, activation.sessionId),
      ])
      await onActivity?.({
        cycle,
        sessionId: result.session.id,
        activationClaimId: leased.leased.claimId,
        wakeId: result.wakeId,
        stopReason: result.stopReason,
        processedEventCount: result.processedEventIds.length,
        queuedWakeCount: result.queuedWakeIds.length,
        queuedWakeSummaries: result.queuedWakeSummaries,
        requeue: result.requeue,
        consumedInputs: result.consumedInputs,
        responsePreview: result.responsePreview,
        runnablePendingEventType: executionState.runnablePendingEventType,
        deferUntil: executionState.deferUntil,
        failureStreak: executionState.failureStreak,
        pendingWakeCount: pendingWakeState.pendingCount,
        nextQueuedWakeAt: pendingWakeState.nextDueAt,
        pendingToolConfirmation: result.session.pendingToolConfirmationRequest
          ? {
              id: result.session.pendingToolConfirmationRequest.id,
              toolName: result.session.pendingToolConfirmationRequest.toolName,
              permissionPolicy: result.session.pendingToolConfirmationRequest.permissionPolicy,
            }
          : null,
        pendingCustomTool: result.session.pendingCustomToolRequest
          ? {
              id: result.session.pendingCustomToolRequest.id,
              name: result.session.pendingCustomToolRequest.name,
              input: result.session.pendingCustomToolRequest.input,
              requestedAt: result.session.pendingCustomToolRequest.requestedAt,
            }
          : null,
        wakeEvents: result.wakeEvents,
      })
    }
    return executed
  }

  private loadWakeLeasePolicy(agentId: string): Promise<{
    wakeLease: {
      staleAfterMs: number
      heartbeatMs: number
    }
    resilience: Awaited<ReturnType<typeof loadAgentConfig>>["resilience"]
  }> {
    return this.loadWakeLeasePolicyFresh(agentId)
  }

  private async loadWakeLeasePolicyFresh(agentId: string): Promise<{
    wakeLease: {
      staleAfterMs: number
      heartbeatMs: number
    }
    resilience: Awaited<ReturnType<typeof loadAgentConfig>>["resilience"]
  }> {
    const configPath = agentConfigPath(this.companyDir, agentId)
    const stats = await stat(configPath).catch(() => null)
    const mtimeMs = stats?.mtimeMs ?? null
    const cached = this.wakeLeasePolicyCache.get(agentId)
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.policy
    }
    const policy = loadAgentConfig(this.companyDir, agentId).then((config) => ({
      wakeLease: resolveWakeLeasePolicy(config.runtime),
      resilience: config.resilience,
    }))
    this.wakeLeasePolicyCache.set(agentId, { mtimeMs, policy })
    return policy
  }
}

function resolveWatchSleepMs(input: {
  pollIntervalMs: number
  nextDueAt: string | null
  idleTimeoutMs: number | null
  idleSince: number
}): number {
  const candidates = [input.pollIntervalMs]
  if (input.nextDueAt) {
    const msUntilDue = Date.parse(input.nextDueAt) - Date.now()
    if (!Number.isFinite(msUntilDue) || msUntilDue <= 0) {
      return 1
    }
    candidates.push(msUntilDue)
  }
  if (input.idleTimeoutMs !== null) {
    const remainingIdleBudget = input.idleTimeoutMs - (Date.now() - input.idleSince)
    if (remainingIdleBudget <= 0) {
      return 1
    }
    candidates.push(remainingIdleBudget)
  }
  return Math.max(1, Math.min(...candidates))
}
