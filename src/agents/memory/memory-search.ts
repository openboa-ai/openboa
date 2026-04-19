import { evaluateSessionOutcome } from "../outcomes/outcome-evaluate.js"
import { makeSetupAwareExpansion } from "../retrieval/expansion.js"
import type { RetrievalCandidate } from "../retrieval/model.js"
import {
  buildRetrievalQuery,
  buildRetrievalSnippet,
  computeOutcomeAffinity,
  computeSessionRelationAffinity,
  matchesSessionLineageFilter,
  rankRetrievalCandidates,
  scoreRetrievalText,
} from "../retrieval/query.js"
import type { Session, SessionOutcomeDefinition } from "../schema/runtime.js"
import type { SessionStore } from "../sessions/session-store.js"
import {
  MEMORY_NOTES_SECTION_END,
  MEMORY_NOTES_SECTION_START,
} from "../workspace/bootstrap-files.js"
import type { AgentLearningsStore } from "./learnings-store.js"
import type { RuntimeMemoryStore } from "./runtime-memory-store.js"

export interface MemorySearchHit extends RetrievalCandidate {
  backend: "memory"
  source:
    | "learning"
    | "workspace_memory"
    | "workspace_memory_notes"
    | "session_checkpoint"
    | "session_evaluation"
    | "session_outcome"
    | "session_state"
    | "working_buffer"
    | "shell_state"
}

function readManagedNotesSection(memoryMarkdown: string): string | null {
  const pattern = new RegExp(
    `${MEMORY_NOTES_SECTION_START}\\n([\\s\\S]*?)\\n${MEMORY_NOTES_SECTION_END}`,
    "u",
  )
  const match = pattern.exec(memoryMarkdown)
  const notes = match?.[1]?.trim() ?? ""
  if (!notes || notes === "_No managed memory notes yet._") {
    return null
  }
  return notes
}

function buildSessionScopedMemoryHit(input: {
  query: NonNullable<ReturnType<typeof buildRetrievalQuery>>
  agentId: string
  sessionId: string
  title: string
  text: string | null
  source: Exclude<
    MemorySearchHit["source"],
    "learning" | "workspace_memory" | "workspace_memory_notes"
  >
  createdAt: string | null
  expansion: MemorySearchHit["expansion"]
  scoreBoost?: number
  reasons?: string[]
  requiresAction?: boolean
  pendingActionKind?: MemorySearchHit["pendingActionKind"]
  pendingActionToolName?: string | null
  outcomeStatus?: MemorySearchHit["outcomeStatus"]
  promotionReady?: MemorySearchHit["promotionReady"]
  outcomeTrend?: MemorySearchHit["outcomeTrend"]
}): MemorySearchHit | null {
  const searchable = input.text?.trim() ?? ""
  if (searchable.length === 0) {
    return null
  }
  const match = scoreRetrievalText(searchable, input.query)
  if (match.score === 0) {
    return null
  }
  return {
    backend: "memory",
    source: input.source,
    agentId: input.agentId,
    sessionId: input.sessionId,
    eventId: null,
    title: input.title,
    snippet: buildRetrievalSnippet(searchable, input.query),
    score: match.score + (input.scoreBoost ?? 0),
    createdAt: input.createdAt,
    reasons: [...match.reasons, ...(input.reasons ?? []), `source:${input.source}`],
    requiresAction: input.requiresAction ?? null,
    pendingActionKind: input.pendingActionKind ?? null,
    pendingActionToolName: input.pendingActionToolName ?? null,
    outcomeStatus: input.outcomeStatus ?? null,
    promotionReady: input.promotionReady ?? null,
    outcomeTrend: input.outcomeTrend ?? null,
    expansion: input.expansion,
  }
}

export async function searchAgentMemory(input: {
  session: Session
  sessionStore: SessionStore
  memoryStore: RuntimeMemoryStore
  learningsStore: AgentLearningsStore
  currentAgentSetupFingerprint?: string | null
  currentActiveOutcome?: SessionOutcomeDefinition | null
  query: string
  limit: number
  lineage?: "related" | "parent" | "children" | "siblings" | null
}): Promise<MemorySearchHit[]> {
  const query = buildRetrievalQuery(input.query)
  if (!query) {
    return []
  }

  const [learnings, workspaceMemory, sessions] = await Promise.all([
    input.learningsStore.list(input.session.agentId),
    input.learningsStore.readWorkspaceMemory(input.session.agentId).catch(() => ""),
    input.sessionStore.listAgentSessions(input.session.agentId),
  ])

  const hits: MemorySearchHit[] = []

  for (const record of learnings) {
    const title = `${record.learning.kind}: ${record.learning.title}`
    const text = [record.learning.title, record.learning.detail].join("\n")
    const match = scoreRetrievalText(text, query)
    if (match.score === 0) {
      continue
    }
    hits.push({
      backend: "memory",
      source: "learning",
      agentId: input.session.agentId,
      sessionId: record.sessionId,
      eventId: null,
      title,
      snippet: buildRetrievalSnippet(record.learning.detail, query),
      score: match.score + 5,
      createdAt: record.createdAt,
      reasons: [...match.reasons, "source:learning"],
      expansion: {
        tool: "learning_list",
        args: { limit: 10 },
        rationale: "Inspect promoted learnings for the same agent.",
      },
    })
  }

  if (workspaceMemory.trim().length > 0) {
    const match = scoreRetrievalText(workspaceMemory, query)
    if (match.score > 0) {
      hits.push({
        backend: "memory",
        source: "workspace_memory",
        agentId: input.session.agentId,
        sessionId: null,
        eventId: null,
        title: "workspace MEMORY.md",
        snippet: buildRetrievalSnippet(workspaceMemory, query),
        score: match.score + 3,
        createdAt: null,
        reasons: [...match.reasons, "source:workspace_memory"],
        expansion: {
          tool: "memory_read",
          args: { target: "workspace_memory" },
          rationale: "Read the promoted workspace memory file directly.",
        },
      })
    }
  }

  const workspaceMemoryNotes = readManagedNotesSection(workspaceMemory)
  if (workspaceMemoryNotes) {
    const match = scoreRetrievalText(workspaceMemoryNotes, query)
    if (match.score > 0) {
      hits.push({
        backend: "memory",
        source: "workspace_memory_notes",
        agentId: input.session.agentId,
        sessionId: null,
        eventId: null,
        title: "workspace managed memory notes",
        snippet: buildRetrievalSnippet(workspaceMemoryNotes, query),
        score: match.score + 4,
        createdAt: null,
        reasons: [...match.reasons, "source:workspace_memory_notes"],
        expansion: {
          tool: "memory_read",
          args: { target: "workspace_memory_notes" },
          rationale: "Inspect the managed workspace notes section directly.",
        },
      })
    }
  }

  const sessionMemorySnapshots = await Promise.all(
    sessions.map(async (session) => ({
      snapshot: await input.sessionStore.getSession(session.id),
      runtimeMemory: await input.memoryStore.read(input.session.agentId, session.id),
    })),
  )

  for (const snapshot of sessionMemorySnapshots) {
    const summary = snapshot.runtimeMemory.checkpoint?.lastSummary ?? null
    const activeOutcome = snapshot.runtimeMemory.checkpoint?.activeOutcome
    const outcomeAffinity = computeOutcomeAffinity({
      currentActiveOutcome: input.currentActiveOutcome,
      candidateActiveOutcome: activeOutcome,
    })
    const relationAffinity = computeSessionRelationAffinity({
      currentSession: input.session,
      candidateSession: snapshot.snapshot.session,
    })
    if (!matchesSessionLineageFilter(input.lineage, relationAffinity.relation)) {
      continue
    }
    const setupFingerprint = snapshot.runtimeMemory.checkpoint?.lastAgentSetupFingerprint ?? null
    const setupMatch =
      input.currentAgentSetupFingerprint !== null &&
      input.currentAgentSetupFingerprint !== undefined &&
      setupFingerprint !== null &&
      setupFingerprint === input.currentAgentSetupFingerprint
    const outcomeEvaluation = evaluateSessionOutcome({
      snapshot: snapshot.snapshot,
      runtimeMemory: snapshot.runtimeMemory,
    })
    const requiresAction =
      snapshot.snapshot.session.stopReason === "requires_action" ||
      snapshot.snapshot.session.pendingToolConfirmationRequest !== null ||
      snapshot.snapshot.session.pendingCustomToolRequest !== null
    const pendingActionKind =
      snapshot.snapshot.session.pendingToolConfirmationRequest !== null
        ? ("tool_confirmation" as const)
        : snapshot.snapshot.session.pendingCustomToolRequest !== null
          ? ("custom_tool" as const)
          : null
    const pendingActionToolName =
      snapshot.snapshot.session.pendingToolConfirmationRequest?.toolName ??
      snapshot.snapshot.session.pendingCustomToolRequest?.name ??
      null
    const outcomeEvaluationHistory =
      snapshot.runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? []
    const sessionState = snapshot.runtimeMemory.sessionState ?? ""
    const workingBuffer = snapshot.runtimeMemory.workingBuffer ?? ""
    const shellState = snapshot.runtimeMemory.shellState
    const createdAt =
      snapshot.runtimeMemory.checkpoint?.updatedAt ?? snapshot.snapshot.session.updatedAt
    const shellSearchable = shellState
      ? [
          shellState.cwd,
          ...Object.keys(shellState.env),
          shellState.lastCommand
            ? [
                shellState.lastCommand.command,
                ...shellState.lastCommand.args,
                shellState.lastCommand.cwd,
                shellState.lastCommand.stdoutPreview ?? "",
                shellState.lastCommand.stderrPreview ?? "",
                shellState.lastCommand.outputPreview ?? "",
              ].join(" ")
            : null,
          ...shellState.recentCommands.map((command) =>
            [
              command.command,
              ...command.args,
              command.cwd,
              command.stdoutPreview ?? "",
              command.stderrPreview ?? "",
              command.outputPreview ?? "",
            ].join(" "),
          ),
        ]
          .filter(Boolean)
          .join("\n")
      : null
    const candidateHits = [
      buildSessionScopedMemoryHit({
        query,
        agentId: input.session.agentId,
        sessionId: snapshot.snapshot.session.id,
        title: `session ${snapshot.snapshot.session.id} checkpoint`,
        text: summary,
        source: "session_checkpoint",
        createdAt,
        scoreBoost: 1 + outcomeAffinity.scoreBoost + relationAffinity.scoreBoost,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        expansion: {
          tool: "session_get_snapshot",
          args: { sessionId: snapshot.snapshot.session.id },
          rationale:
            "Inspect the prior session snapshot before deciding whether to reread detailed events.",
        },
        reasons: [
          ...(setupMatch ? ["setup-match"] : setupFingerprint ? ["setup-different"] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
      }),
      buildSessionScopedMemoryHit({
        query,
        agentId: input.session.agentId,
        sessionId: snapshot.snapshot.session.id,
        title: `session ${snapshot.snapshot.session.id} evaluation`,
        text: [
          `status ${outcomeEvaluation.status}`,
          `confidence ${outcomeEvaluation.confidence}`,
          `promotion ready ${String(outcomeEvaluation.promotionReady)}`,
          outcomeEvaluation.summary,
          ...outcomeEvaluation.evidence,
          ...outcomeEvaluationHistory
            .slice(-3)
            .flatMap((record) => [
              `iteration ${String(record.iteration)}`,
              `evaluation status ${record.evaluation.status}`,
              `evaluation summary ${record.evaluation.summary}`,
            ]),
        ]
          .filter((part) => part && part.trim().length > 0)
          .join("\n"),
        source: "session_evaluation",
        createdAt,
        scoreBoost: 3 + outcomeAffinity.scoreBoost + relationAffinity.scoreBoost,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        expansion: {
          tool: outcomeEvaluationHistory.length > 1 ? "outcome_history" : "outcome_evaluate",
          args:
            outcomeEvaluationHistory.length > 1
              ? {
                  sessionId: snapshot.snapshot.session.id,
                  limit: Math.min(outcomeEvaluationHistory.length, 6),
                }
              : { sessionId: snapshot.snapshot.session.id },
          rationale:
            outcomeEvaluationHistory.length > 1
              ? "Inspect recent evaluator iterations for the matched prior session before repeating or promoting similar changes."
              : "Inspect the evaluator verdict for the matched prior session before reusing its outcome or promoting similar changes.",
        },
        reasons: [
          ...(setupMatch ? ["setup-match"] : setupFingerprint ? ["setup-different"] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
      }),
      buildSessionScopedMemoryHit({
        query,
        agentId: input.session.agentId,
        sessionId: snapshot.snapshot.session.id,
        title: `session ${snapshot.snapshot.session.id} outcome`,
        text: activeOutcome
          ? [activeOutcome.title, activeOutcome.detail, ...activeOutcome.successCriteria]
              .filter(Boolean)
              .join("\n")
          : null,
        source: "session_outcome",
        createdAt,
        scoreBoost: 2 + outcomeAffinity.scoreBoost + relationAffinity.scoreBoost,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        expansion: {
          tool: "outcome_read",
          args: { sessionId: snapshot.snapshot.session.id },
          rationale: "Inspect the active outcome recorded for that prior session.",
        },
        reasons: [
          ...(setupMatch ? ["setup-match"] : setupFingerprint ? ["setup-different"] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
      }),
      buildSessionScopedMemoryHit({
        query,
        agentId: input.session.agentId,
        sessionId: snapshot.snapshot.session.id,
        title: `session ${snapshot.snapshot.session.id} state`,
        text: sessionState,
        source: "session_state",
        createdAt,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        expansion: {
          tool: "memory_read",
          args: { target: "session_state", sessionId: snapshot.snapshot.session.id },
          rationale: "Read the session-state.md file for the matched prior session.",
        },
        reasons: [
          ...(setupMatch ? ["setup-match"] : setupFingerprint ? ["setup-different"] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
      }),
      buildSessionScopedMemoryHit({
        query,
        agentId: input.session.agentId,
        sessionId: snapshot.snapshot.session.id,
        title: `session ${snapshot.snapshot.session.id} working buffer`,
        text: workingBuffer,
        source: "working_buffer",
        createdAt,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        expansion: {
          tool: "memory_read",
          args: { target: "working_buffer", sessionId: snapshot.snapshot.session.id },
          rationale: "Read the working-buffer.md scratchpad for the matched prior session.",
        },
        reasons: [
          ...(setupMatch ? ["setup-match"] : setupFingerprint ? ["setup-different"] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
      }),
      buildSessionScopedMemoryHit({
        query,
        agentId: input.session.agentId,
        sessionId: snapshot.snapshot.session.id,
        title: `session ${snapshot.snapshot.session.id} shell state`,
        text: shellSearchable,
        source: "shell_state",
        createdAt,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        expansion: {
          tool: shellState?.lastCommand ? "shell_read_last_output" : "shell_describe",
          args: { sessionId: snapshot.snapshot.session.id },
          rationale: shellState?.lastCommand
            ? "Read the bounded stdout/stderr summary from the prior session before widening to broader shell history."
            : "Inspect the prior session shell hand first, including cwd and durable env keys, before rereading command history.",
        },
        reasons: [
          ...(setupMatch ? ["setup-match"] : setupFingerprint ? ["setup-different"] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
      }),
    ]

    for (const hit of candidateHits) {
      if (hit) {
        if (setupFingerprint !== null) {
          hit.setupFingerprint = setupFingerprint
          hit.setupMatch = setupMatch
          if (hit.expansion) {
            hit.expansion = makeSetupAwareExpansion({
              sessionId: hit.sessionId,
              setupFingerprint,
              setupMatch,
              expansion: hit.expansion,
            })
          }
          hit.reasons = [...hit.reasons, `setup:${setupMatch ? "same" : "different"}`]
          if (setupMatch) {
            hit.score += 2
          }
        }
        if (relationAffinity.relation) {
          hit.sessionRelation = relationAffinity.relation
        }
        hits.push(hit)
      }
    }
  }

  return rankRetrievalCandidates(hits, input.limit)
}
