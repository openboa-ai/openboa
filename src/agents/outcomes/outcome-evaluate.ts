import type { RuntimeMemorySnapshot } from "../memory/runtime-memory-store.js"
import type { SessionEvent, SessionOutcomeDefinition } from "../schema/runtime.js"
import type { SessionSnapshot } from "../sessions/session-store.js"
import { summarizeSessionTraces } from "../sessions/session-traces.js"
import { deriveSessionActiveOutcome, gradeSessionOutcome } from "./outcome-grade.js"

export interface SessionOutcomeEvaluation {
  status: "missing_outcome" | "blocked" | "not_ready" | "uncertain" | "fail" | "pass"
  confidence: "low" | "medium" | "high"
  promotionReady: boolean
  trend: "first_iteration" | "improving" | "stable" | "regressing"
  trendSummary: string | null
  summary: string
  evidence: string[]
  nextSuggestedTool: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
}

function evaluationScore(status: SessionOutcomeEvaluation["status"]): number {
  switch (status) {
    case "pass":
      return 5
    case "uncertain":
      return 4
    case "not_ready":
      return 3
    case "blocked":
      return 2
    case "fail":
      return 1
    case "missing_outcome":
      return 0
  }
}

export function applyLiveShellOutcomeGuard(input: {
  evaluation: SessionOutcomeEvaluation
  liveShell: {
    shellId: string
    status: "active" | "closed"
    busy: boolean
    currentCommand: string | null
    currentCommandStartedAt: string | null
  } | null
}): SessionOutcomeEvaluation {
  if (
    !input.liveShell ||
    input.liveShell.status !== "active" ||
    input.liveShell.busy !== true ||
    input.evaluation.status === "missing_outcome" ||
    input.evaluation.status === "blocked" ||
    input.evaluation.status === "fail"
  ) {
    return input.evaluation
  }
  const shellEvidence = [
    `Live shell busy: ${input.liveShell.currentCommand ?? "unknown command"}`,
    ...(input.liveShell.currentCommandStartedAt
      ? [`Live shell startedAt: ${input.liveShell.currentCommandStartedAt}`]
      : []),
  ]
  return {
    ...input.evaluation,
    status: "not_ready",
    promotionReady: false,
    summary:
      "A live persistent shell command is still running, so promotion and completion should wait until that execution hand settles.",
    evidence: [...shellEvidence, ...input.evaluation.evidence],
    nextSuggestedTool: {
      tool: "shell_wait",
      args: { timeoutMs: 1_000 },
      rationale:
        "Wait on the live persistent shell command before concluding that the current bounded work is complete or promotion-safe.",
    },
  }
}

function resolveEvaluationTrend(input: {
  activeOutcome: SessionOutcomeDefinition | null
  runtimeMemory: RuntimeMemorySnapshot
  currentStatus: SessionOutcomeEvaluation["status"]
  currentPromotionReady: boolean
}): Pick<SessionOutcomeEvaluation, "trend" | "trendSummary"> {
  const outcomeFingerprint = computeOutcomeDefinitionFingerprint(input.activeOutcome)
  const previous = [...(input.runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? [])]
    .reverse()
    .find((entry) => entry.outcomeFingerprint === outcomeFingerprint)

  if (!previous) {
    return {
      trend: "first_iteration",
      trendSummary: "No prior evaluator verdict exists for this durable outcome yet.",
    }
  }

  const previousScore =
    evaluationScore(previous.evaluation.status) + (previous.evaluation.promotionReady ? 1 : 0)
  const currentScore = evaluationScore(input.currentStatus) + (input.currentPromotionReady ? 1 : 0)

  if (currentScore > previousScore) {
    return {
      trend: "improving",
      trendSummary: `Evaluator posture improved from ${previous.evaluation.status} to ${input.currentStatus}.`,
    }
  }
  if (currentScore < previousScore) {
    return {
      trend: "regressing",
      trendSummary: `Evaluator posture regressed from ${previous.evaluation.status} to ${input.currentStatus}.`,
    }
  }
  return {
    trend: "stable",
    trendSummary: `Evaluator posture stayed at ${input.currentStatus} across the latest bounded iterations.`,
  }
}

export interface SessionOutcomeEvaluationRecord {
  evaluatedAt: string
  wakeId: string | null
  iteration: number
  outcomeTitle: string | null
  outcomeFingerprint: string | null
  gradeStatus: ReturnType<typeof gradeSessionOutcome>["status"]
  evaluation: SessionOutcomeEvaluation
}

export function computeOutcomeDefinitionFingerprint(
  outcome: SessionOutcomeDefinition | null,
): string | null {
  if (!outcome) {
    return null
  }
  return JSON.stringify({
    title: outcome.title,
    detail: outcome.detail,
    successCriteria: outcome.successCriteria,
  })
}

function latestWakeEvents(input: {
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
}): SessionEvent[] {
  const latestWakeId =
    input.runtimeMemory.checkpoint?.lastWakeId ??
    summarizeSessionTraces(input.snapshot.events, 1)[0]?.wakeId ??
    null
  if (!latestWakeId) {
    return []
  }
  return input.snapshot.events
    .filter((event) => event.wakeId === latestWakeId)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

function resolveOutcomeHistorySuggestion(input: {
  activeOutcome: SessionOutcomeDefinition
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
  fallback: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
}): {
  tool: string
  args: Record<string, unknown>
  rationale: string
} | null {
  const history = input.runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? []
  const outcomeFingerprint = computeOutcomeDefinitionFingerprint(input.activeOutcome)
  const relatedHistory = history.filter((entry) => entry.outcomeFingerprint === outcomeFingerprint)
  if (relatedHistory.length < 2) {
    return input.fallback
  }
  const recentStatuses = relatedHistory.slice(-3).map((entry) => entry.evaluation.status)
  if (recentStatuses.some((status) => status === "pass")) {
    return input.fallback
  }
  return {
    tool: "outcome_history",
    args: {
      sessionId: input.snapshot.session.id,
      limit: Math.min(relatedHistory.length, 6),
    },
    rationale:
      "Inspect recent evaluator iterations before repeating another bounded revision or promotion attempt.",
  }
}

function evaluateDoneCandidate(input: {
  activeOutcome: SessionOutcomeDefinition
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
  matchedCriteria: number
  totalCriteria: number
}): SessionOutcomeEvaluation {
  const wakeEvents = latestWakeEvents({
    snapshot: input.snapshot,
    runtimeMemory: input.runtimeMemory,
  })
  const latestWakeCompletion = [...wakeEvents]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "span.completed" }> =>
        event.type === "span.completed" && event.spanKind === "wake",
    )
  const latestIdle = [...wakeEvents]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "session.status_idle" }> =>
        event.type === "session.status_idle",
    )
  const latestAgentMessage = [...wakeEvents]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "agent.message" }> =>
        event.type === "agent.message",
    )
  const toolError = [...wakeEvents]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "span.completed" }> =>
        event.type === "span.completed" && event.spanKind === "tool" && event.result === "error",
    )

  if (toolError) {
    const trend = resolveEvaluationTrend({
      activeOutcome: input.activeOutcome,
      runtimeMemory: input.runtimeMemory,
      currentStatus: "fail",
      currentPromotionReady: false,
    })
    return {
      status: "fail",
      confidence: "high",
      promotionReady: false,
      trend: trend.trend,
      trendSummary: trend.trendSummary,
      summary:
        "A recent tool error is present in the latest wake trace, so promotion is not safe yet.",
      evidence: [
        `Latest tool error: ${toolError.name}`,
        `Trace summary: ${toolError.summary ?? "none"}`,
        `Matched criteria: ${String(input.matchedCriteria)}/${String(input.totalCriteria)}`,
      ],
      nextSuggestedTool: resolveOutcomeHistorySuggestion({
        activeOutcome: input.activeOutcome,
        snapshot: input.snapshot,
        runtimeMemory: input.runtimeMemory,
        fallback: {
          tool: "session_get_trace",
          args: { sessionId: input.snapshot.session.id, wakeId: toolError.wakeId ?? undefined },
          rationale:
            "Inspect the failing wake trace before promoting shared memory or substrate changes.",
        },
      }),
    }
  }

  if (latestWakeCompletion?.result === "success" && latestIdle?.reason === "idle") {
    const trend = resolveEvaluationTrend({
      activeOutcome: input.activeOutcome,
      runtimeMemory: input.runtimeMemory,
      currentStatus: "pass",
      currentPromotionReady: true,
    })
    return {
      status: "pass",
      confidence: latestAgentMessage?.summary ? "high" : "medium",
      promotionReady: true,
      trend: trend.trend,
      trendSummary: trend.trendSummary,
      summary:
        "The latest wake finished successfully and the durable outcome currently looks promotion-safe.",
      evidence: [
        `Matched criteria: ${String(input.matchedCriteria)}/${String(input.totalCriteria)}`,
        `Latest wake result: ${latestWakeCompletion.result}`,
        `Latest idle reason: ${latestIdle.reason}`,
        `Latest summary: ${latestAgentMessage?.summary ?? input.runtimeMemory.checkpoint?.lastSummary ?? "none"}`,
      ],
      nextSuggestedTool: null,
    }
  }

  return {
    status: "uncertain",
    confidence: "medium",
    promotionReady: false,
    ...resolveEvaluationTrend({
      activeOutcome: input.activeOutcome,
      runtimeMemory: input.runtimeMemory,
      currentStatus: "uncertain",
      currentPromotionReady: false,
    }),
    summary:
      "The durable outcome looks close to complete, but the latest wake trace is not strong enough to treat promotion as safe yet.",
    evidence: [
      `Matched criteria: ${String(input.matchedCriteria)}/${String(input.totalCriteria)}`,
      `Latest wake result: ${latestWakeCompletion?.result ?? "none"}`,
      `Latest idle reason: ${latestIdle?.reason ?? "none"}`,
      `Latest summary: ${latestAgentMessage?.summary ?? input.runtimeMemory.checkpoint?.lastSummary ?? "none"}`,
    ],
    nextSuggestedTool: resolveOutcomeHistorySuggestion({
      activeOutcome: input.activeOutcome,
      snapshot: input.snapshot,
      runtimeMemory: input.runtimeMemory,
      fallback: {
        tool: "session_get_trace",
        args: {
          sessionId: input.snapshot.session.id,
          wakeId: latestWakeCompletion?.wakeId ?? undefined,
        },
        rationale: "Verify the latest wake trace before treating the outcome as promotion-ready.",
      },
    }),
  }
}

export function evaluateSessionOutcome(input: {
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
}): SessionOutcomeEvaluation {
  const activeOutcome = deriveSessionActiveOutcome(input)
  const grade = gradeSessionOutcome(input)

  if (!activeOutcome) {
    return {
      status: "missing_outcome",
      confidence: "high",
      promotionReady: false,
      trend: "first_iteration",
      trendSummary: "No durable outcome exists yet, so there is no evaluator history to compare.",
      summary: "No durable outcome is defined yet, so promotion safety cannot be evaluated.",
      evidence: grade.evidence,
      nextSuggestedTool: {
        tool: "outcome_define",
        args: { title: "Describe the bounded success target for this session." },
        rationale: "Define the durable outcome before evaluating whether shared promotion is safe.",
      },
    }
  }

  if (grade.status === "blocked") {
    const trend = resolveEvaluationTrend({
      activeOutcome,
      runtimeMemory: input.runtimeMemory,
      currentStatus: "blocked",
      currentPromotionReady: false,
    })
    return {
      status: "blocked",
      confidence: "high",
      promotionReady: false,
      trend: trend.trend,
      trendSummary: trend.trendSummary,
      summary:
        "The session is blocked, so promotion should wait until the current confirmation or tool pause is resolved.",
      evidence: grade.evidence,
      nextSuggestedTool: resolveOutcomeHistorySuggestion({
        activeOutcome,
        snapshot: input.snapshot,
        runtimeMemory: input.runtimeMemory,
        fallback: grade.nextSuggestedTool,
      }),
    }
  }

  if (grade.status === "sleeping" || grade.status === "in_progress") {
    const trend = resolveEvaluationTrend({
      activeOutcome,
      runtimeMemory: input.runtimeMemory,
      currentStatus: "not_ready",
      currentPromotionReady: false,
    })
    return {
      status: "not_ready",
      confidence: grade.confidence,
      promotionReady: false,
      trend: trend.trend,
      trendSummary: trend.trendSummary,
      summary:
        "The session still has active work or deferred follow-up, so shared promotion is premature.",
      evidence: grade.evidence,
      nextSuggestedTool: resolveOutcomeHistorySuggestion({
        activeOutcome,
        snapshot: input.snapshot,
        runtimeMemory: input.runtimeMemory,
        fallback: grade.nextSuggestedTool,
      }),
    }
  }

  return evaluateDoneCandidate({
    activeOutcome,
    snapshot: input.snapshot,
    runtimeMemory: input.runtimeMemory,
    matchedCriteria: grade.matchedCriteria,
    totalCriteria: grade.totalCriteria,
  })
}
