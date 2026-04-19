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
import type {
  Session,
  SessionEvent,
  SessionEventType,
  SessionOutcomeDefinition,
} from "../schema/runtime.js"
import { SESSION_CONTEXT_EVENT_TYPES } from "./context-query-policy.js"
import type { SessionStore } from "./session-store.js"

export interface SessionContextSearchHit extends RetrievalCandidate {
  backend: "session_context"
  sessionId: string
  eventId: string
  wakeId?: string | null
  eventType: SessionEventType
  createdAt: string
}

function renderSearchableEventText(event: SessionEvent): string | null {
  switch (event.type) {
    case "user.message":
      return event.message
    case "span.started":
      return [event.spanKind, event.name, event.summary ?? ""].join(" ")
    case "span.completed":
      return [event.spanKind, event.name, event.result, event.summary ?? ""].join(" ")
    case "user.define_outcome":
      return [
        event.outcome.title,
        event.outcome.detail ?? "",
        ...event.outcome.successCriteria,
      ].join("\n")
    case "user.interrupt":
      return event.note ?? "interrupt"
    case "agent.message":
      return `${event.summary}\n${event.message}`
    case "user.tool_confirmation":
      return `${event.toolName} ${event.requestId} ${String(event.allowed)} ${event.note ?? ""}`
    case "user.custom_tool_result":
      return `${event.toolName} ${event.output}`
    case "session.child_created":
      return `${event.childSessionId} ${event.outcomeTitle ?? ""} ${event.message}`
    case "session.child_idle":
      return `${event.childSessionId} ${event.childStopReason} ${event.summary}`
    case "agent.custom_tool_use":
      return `${event.toolName} ${JSON.stringify(event.input)}`
    case "agent.tool_use":
      return `${event.toolName} ${event.requestId ?? ""} ${event.output ?? ""}`
    case "session.status_changed":
      return `${event.fromStatus} ${event.toStatus} ${event.reason}`
    case "session.status_idle":
      return `${event.reason} ${event.summary}`
  }
}

export async function searchAgentSessionContext(input: {
  session: Session
  sessionStore: Pick<SessionStore, "listAgentSessions" | "getSession">
  memoryStore: Pick<RuntimeMemoryStore, "read">
  currentAgentSetupFingerprint?: string | null
  currentActiveOutcome?: SessionOutcomeDefinition | null
  query: string
  limit: number
  includeCurrent?: boolean
  lineage?: "related" | "parent" | "children" | "siblings" | null
  types?: SessionEventType[]
}): Promise<SessionContextSearchHit[]> {
  const query = buildRetrievalQuery(input.query)
  if (!query) {
    return []
  }

  const allowedTypes =
    input.types && input.types.length > 0 ? input.types : [...SESSION_CONTEXT_EVENT_TYPES]
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

  const hits: SessionContextSearchHit[] = []
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
    for (const event of snapshot.events) {
      if (!allowedTypes.includes(event.type)) {
        continue
      }
      const text = renderSearchableEventText(event)
      if (!text) {
        continue
      }
      const match = scoreRetrievalText(text, query)
      if (match.score === 0) {
        continue
      }
      hits.push({
        backend: "session_context",
        source: event.type,
        agentId: input.session.agentId,
        sessionId: session.id,
        eventId: event.id,
        wakeId: event.wakeId ?? null,
        setupFingerprint,
        setupMatch: setupFingerprint ? setupMatch : null,
        requiresAction,
        pendingActionKind,
        pendingActionToolName,
        outcomeStatus: outcomeEvaluation.status,
        promotionReady: outcomeEvaluation.promotionReady,
        outcomeTrend: outcomeEvaluation.trend,
        eventType: event.type,
        title: `${event.type} @ ${session.id}`,
        createdAt: event.createdAt,
        snippet: buildRetrievalSnippet(text, query),
        score:
          match.score +
          2 +
          (setupMatch ? 2 : 0) +
          outcomeAffinity.scoreBoost +
          relationAffinity.scoreBoost,
        reasons: [
          ...match.reasons,
          `source:${event.type}`,
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
            tool: event.wakeId ? "session_get_trace" : "session_get_events",
            args: event.wakeId
              ? {
                  sessionId: session.id,
                  wakeId: event.wakeId,
                }
              : {
                  sessionId: session.id,
                  aroundEventId: event.id,
                  beforeLimit: 2,
                  afterLimit: 2,
                  includeProcessed: true,
                },
            rationale: event.wakeId
              ? "Inspect the bounded wake trace that produced this anchor event."
              : "Reread the surrounding session events around this anchor event.",
          },
        }),
      })
    }
  }

  return rankRetrievalCandidates(hits, input.limit)
}
