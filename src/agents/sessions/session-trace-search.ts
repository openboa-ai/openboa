import type { RuntimeMemoryStore } from "../memory/runtime-memory-store.js"
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
import type { SessionStore } from "./session-store.js"
import { summarizeSessionTraces } from "./session-traces.js"

export interface SessionTraceSearchHit extends RetrievalCandidate {
  backend: "session_trace"
  sessionId: string
  wakeId: string
}

export async function searchAgentSessionTraces(input: {
  session: Session
  sessionStore: Pick<SessionStore, "listAgentSessions" | "getSession">
  memoryStore: Pick<RuntimeMemoryStore, "read">
  currentAgentSetupFingerprint?: string | null
  currentActiveOutcome?: SessionOutcomeDefinition | null
  query: string
  limit: number
  includeCurrent?: boolean
  lineage?: "related" | "parent" | "children" | "siblings" | null
}): Promise<SessionTraceSearchHit[]> {
  const query = buildRetrievalQuery(input.query)
  if (!query) {
    return []
  }

  const sessions = await input.sessionStore.listAgentSessions(input.session.agentId)
  const targetSessions = sessions.filter(
    (session) => input.includeCurrent === true || session.id !== input.session.id,
  )
  const snapshots = await Promise.all(
    targetSessions.map(async (session) => ({
      session,
      snapshot: await input.sessionStore.getSession(session.id),
      runtimeMemory: await input.memoryStore.read(input.session.agentId, session.id),
    })),
  )

  const hits: SessionTraceSearchHit[] = []
  for (const { session, snapshot, runtimeMemory } of snapshots) {
    const candidateActiveOutcome = runtimeMemory.checkpoint?.activeOutcome ?? null
    const outcomeAffinity = computeOutcomeAffinity({
      currentActiveOutcome: input.currentActiveOutcome,
      candidateActiveOutcome,
    })
    const relationAffinity = computeSessionRelationAffinity({
      currentSession: input.session,
      candidateSession: snapshot.session,
    })
    if (!matchesSessionLineageFilter(input.lineage, relationAffinity.relation)) {
      continue
    }
    const setupFingerprint = runtimeMemory.checkpoint?.lastAgentSetupFingerprint ?? null
    const setupMatch =
      input.currentAgentSetupFingerprint !== null &&
      input.currentAgentSetupFingerprint !== undefined &&
      setupFingerprint !== null &&
      setupFingerprint === input.currentAgentSetupFingerprint
    const outcomeEvaluation = evaluateSessionOutcome({
      snapshot,
      runtimeMemory,
    })
    const requiresAction =
      snapshot.session.stopReason === "requires_action" ||
      snapshot.session.pendingToolConfirmationRequest !== null ||
      snapshot.session.pendingCustomToolRequest !== null
    const pendingActionKind =
      snapshot.session.pendingToolConfirmationRequest !== null
        ? ("tool_confirmation" as const)
        : snapshot.session.pendingCustomToolRequest !== null
          ? ("custom_tool" as const)
          : null
    const pendingActionToolName =
      snapshot.session.pendingToolConfirmationRequest?.toolName ??
      snapshot.session.pendingCustomToolRequest?.name ??
      null
    const traces = summarizeSessionTraces(snapshot.events)
    for (const trace of traces) {
      const text = [trace.latestSummary ?? "", trace.eventTypes.join(" "), trace.wakeId].join(" ")
      const match = scoreRetrievalText(text, query)
      if (match.score === 0) {
        continue
      }
      hits.push({
        backend: "session_trace",
        source: "wake.trace",
        agentId: input.session.agentId,
        sessionId: session.id,
        eventId: null,
        wakeId: trace.wakeId,
        setupFingerprint,
        setupMatch: setupFingerprint ? setupMatch : null,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        title: trace.latestSummary
          ? `${trace.latestSummary} @ ${trace.wakeId}`
          : `wake.trace @ ${trace.wakeId}`,
        snippet: buildRetrievalSnippet(text, query),
        score:
          match.score +
          3 +
          (setupMatch ? 2 : 0) +
          outcomeAffinity.scoreBoost +
          relationAffinity.scoreBoost,
        createdAt: trace.updatedAt,
        reasons: [
          ...match.reasons,
          `source:wake.trace`,
          `events:${trace.eventCount}`,
          ...(setupFingerprint ? [`setup:${setupMatch ? "same" : "different"}`] : []),
          ...outcomeAffinity.reasons,
          ...relationAffinity.reasons,
        ],
        sessionRelation: relationAffinity.relation,
        expansion: makeSetupAwareExpansion({
          sessionId: session.id,
          setupFingerprint,
          setupMatch: setupFingerprint ? setupMatch : null,
          expansion: {
            tool: "session_get_trace",
            args: {
              sessionId: session.id,
              wakeId: trace.wakeId,
            },
            rationale: "Inspect the bounded wake trace that best matches the current query.",
          },
        }),
      })
    }
  }

  return rankRetrievalCandidates(hits, input.limit)
}
