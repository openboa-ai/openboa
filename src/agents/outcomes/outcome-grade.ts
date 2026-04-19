import type { RuntimeMemorySnapshot } from "../memory/runtime-memory-store.js"
import { buildRetrievalQuery, scoreRetrievalText } from "../retrieval/query.js"
import { buildReadOnlyBashAlternative } from "../sandbox/sandbox.js"
import type { SessionEvent, SessionOutcomeDefinition } from "../schema/runtime.js"
import type { SessionSnapshot } from "../sessions/session-store.js"

export interface SessionOutcomeGrade {
  status: "missing_outcome" | "blocked" | "sleeping" | "in_progress" | "done_candidate"
  confidence: "low" | "medium" | "high"
  summary: string
  matchedCriteria: number
  totalCriteria: number
  evidence: string[]
  nextSuggestedTool: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
}

export function deriveSessionActiveOutcome(input: {
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
}): SessionOutcomeDefinition | null {
  const latestOutcomeEvent = [...input.snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "user.define_outcome" }> =>
        event.type === "user.define_outcome",
    )
  return latestOutcomeEvent?.outcome ?? input.runtimeMemory.checkpoint?.activeOutcome ?? null
}

export function gradeSessionOutcome(input: {
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
}): SessionOutcomeGrade {
  const activeOutcome = deriveSessionActiveOutcome(input)
  if (!activeOutcome) {
    return {
      status: "missing_outcome",
      confidence: "high",
      summary: "No active outcome is defined for this session yet.",
      matchedCriteria: 0,
      totalCriteria: 0,
      evidence: ["No user.define_outcome event or checkpoint activeOutcome was found."],
      nextSuggestedTool: {
        tool: "outcome_define",
        args: { title: "Describe the bounded success target for this session." },
        rationale: "Define a durable outcome before grading progress.",
      },
    }
  }

  const pendingConfirmation = input.snapshot.session.pendingToolConfirmationRequest
  const pendingCustomTool = input.snapshot.session.pendingCustomToolRequest
  if (
    pendingConfirmation ||
    pendingCustomTool ||
    input.snapshot.session.stopReason === "requires_action"
  ) {
    const readOnlyBlockedShellAlternative =
      pendingConfirmation &&
      (pendingConfirmation.toolName === "shell_run" ||
        pendingConfirmation.toolName === "shell_exec") &&
      pendingConfirmation.input &&
      typeof pendingConfirmation.input === "object" &&
      !Array.isArray(pendingConfirmation.input)
        ? buildReadOnlyBashAlternative({
            command:
              typeof pendingConfirmation.input.command === "string"
                ? pendingConfirmation.input.command
                : null,
            cwd:
              typeof pendingConfirmation.input.cwd === "string"
                ? pendingConfirmation.input.cwd
                : null,
            fallbackCwd: input.runtimeMemory.shellState?.cwd ?? "/workspace",
            timeoutMs: pendingConfirmation.input.timeoutMs,
            maxOutputChars: pendingConfirmation.input.maxOutputChars,
            rationale:
              "The blocked shell request is a bounded read-only command. Prefer the low-risk bash hand instead of waiting on confirmation for a writable shell tool.",
          })
        : null
    const nextSuggestedTool = readOnlyBlockedShellAlternative
      ? readOnlyBlockedShellAlternative
      : pendingConfirmation
        ? {
            tool: "permissions_check",
            args: { toolName: pendingConfirmation.toolName },
            rationale:
              "Inspect the exact confirmation posture for the blocked managed tool before resuming work.",
          }
        : pendingCustomTool
          ? {
              tool: "session_get_snapshot",
              args: { sessionId: input.snapshot.session.id },
              rationale:
                "Inspect the current session snapshot and pending custom tool request before resuming blocked work.",
            }
          : {
              tool: "permissions_describe",
              args: {},
              rationale: "Inspect the current confirmation posture before resuming blocked work.",
            }
    return {
      status: "blocked",
      confidence: "high",
      summary: "The session is currently blocked on external confirmation or tool input.",
      matchedCriteria: 0,
      totalCriteria: activeOutcome.successCriteria.length,
      evidence: [
        pendingConfirmation
          ? `Pending confirmation: ${pendingConfirmation.toolName}`
          : "No pending tool confirmation.",
        pendingCustomTool
          ? `Pending custom tool request: ${pendingCustomTool.name}`
          : "No pending custom tool request.",
        `Stop reason: ${input.snapshot.session.stopReason}`,
      ],
      nextSuggestedTool,
    }
  }

  const summary = input.runtimeMemory.checkpoint?.lastSummary ?? ""
  const sessionState = input.runtimeMemory.sessionState ?? ""
  const workingBuffer = input.runtimeMemory.workingBuffer ?? ""
  const latestAgentMessage =
    [...input.snapshot.events]
      .reverse()
      .find(
        (event): event is Extract<SessionEvent, { type: "agent.message" }> =>
          event.type === "agent.message",
      )?.message ?? ""
  const searchable = [summary, sessionState, workingBuffer, latestAgentMessage]
    .filter((value) => value.trim().length > 0)
    .join("\n")
  const criteria = activeOutcome.successCriteria.filter((criterion) => criterion.trim().length > 0)
  const matchedCriteria = criteria.filter((criterion) => {
    const query = buildRetrievalQuery(criterion)
    if (!query) {
      return false
    }
    return scoreRetrievalText(searchable, query).score >= 4
  }).length

  if (
    input.runtimeMemory.checkpoint?.queuedWakes.length ||
    input.runtimeMemory.checkpoint?.nextWakeAt
  ) {
    return {
      status: "sleeping",
      confidence: "medium",
      summary: "The session has a durable outcome but is currently waiting on queued future work.",
      matchedCriteria,
      totalCriteria: criteria.length,
      evidence: [
        `Queued wakes: ${String(input.runtimeMemory.checkpoint?.queuedWakes.length ?? 0)}`,
        `Next wake: ${input.runtimeMemory.checkpoint?.nextWakeAt ?? "none"}`,
        `Latest summary: ${summary || "none"}`,
      ],
      nextSuggestedTool: {
        tool: "session_get_snapshot",
        args: { sessionId: input.snapshot.session.id },
        rationale:
          "Inspect the current queued wake and checkpoint state before redirecting the session.",
      },
    }
  }

  if (
    criteria.length > 0 &&
    matchedCriteria === criteria.length &&
    input.snapshot.session.stopReason === "idle"
  ) {
    return {
      status: "done_candidate",
      confidence: "medium",
      summary:
        "The latest durable state appears to satisfy all recorded success criteria, but it should still be verified.",
      matchedCriteria,
      totalCriteria: criteria.length,
      evidence: [
        `Matched criteria: ${String(matchedCriteria)}/${String(criteria.length)}`,
        `Latest summary: ${summary || "none"}`,
      ],
      nextSuggestedTool: {
        tool: "session_get_trace",
        args: { sessionId: input.snapshot.session.id },
        rationale: "Verify the final wake trace before concluding the outcome is complete.",
      },
    }
  }

  return {
    status: "in_progress",
    confidence: matchedCriteria > 0 ? "medium" : "low",
    summary:
      "The session has a durable outcome and recent progress, but completion is not yet proven.",
    matchedCriteria,
    totalCriteria: criteria.length,
    evidence: [
      `Matched criteria: ${String(matchedCriteria)}/${String(criteria.length)}`,
      `Stop reason: ${input.snapshot.session.stopReason}`,
      `Latest summary: ${summary || "none"}`,
    ],
    nextSuggestedTool: {
      tool: "session_get_trace",
      args: { sessionId: input.snapshot.session.id },
      rationale: "Inspect the most recent wake trace before choosing the next bounded move.",
    },
  }
}
