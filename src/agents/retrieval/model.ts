import type { AgentLearningsStore } from "../memory/learnings-store.js"
import type { RuntimeMemoryStore } from "../memory/runtime-memory-store.js"
import type { Session, SessionOutcomeDefinition } from "../schema/runtime.js"
import type { SessionStore } from "../sessions/session-store.js"

export type RetrievalBackend = "memory" | "session_context" | "session_trace" | "vector"
export type RetrievalSessionRelation = "parent" | "child" | "sibling"
export type RetrievalLineageFilter = "related" | "parent" | "children" | "siblings"

export interface RetrievalQuery {
  raw: string
  normalized: string
  terms: string[]
  phrases: string[]
  pathTerms: string[]
  identifiers: string[]
}

export interface RetrievalMatch {
  score: number
  reasons: string[]
}

export interface RetrievalExpansion {
  tool:
    | "agent_compare_setup"
    | "session_get_events"
    | "session_get_trace"
    | "session_get_snapshot"
    | "memory_read"
    | "shell_describe"
    | "shell_read_last_output"
    | "shell_history"
    | "learning_list"
    | "outcome_read"
    | "outcome_history"
    | "outcome_evaluate"
  args: Record<string, unknown>
  rationale: string
}

export interface RetrievalEvidence {
  backend: RetrievalBackend
  source: string
  score: number
  reasons: string[]
  setupMatch?: boolean | null
  sessionRelation?: RetrievalSessionRelation | null
}

export type RetrievalConfidence = "low" | "medium" | "high"

export interface RetrievalCandidate {
  backend: RetrievalBackend
  source: string
  agentId: string
  sessionId: string | null
  eventId: string | null
  wakeId?: string | null
  setupFingerprint?: string | null
  setupMatch?: boolean | null
  sessionRelation?: RetrievalSessionRelation | null
  requiresAction?: boolean | null
  pendingActionKind?: "tool_confirmation" | "custom_tool" | null
  pendingActionToolName?: string | null
  outcomeStatus?: "missing_outcome" | "blocked" | "not_ready" | "uncertain" | "fail" | "pass" | null
  promotionReady?: boolean | null
  outcomeTrend?: "first_iteration" | "improving" | "stable" | "regressing" | null
  title: string
  snippet: string
  score: number
  createdAt: string | null
  reasons: string[]
  confidence?: RetrievalConfidence
  evidence?: RetrievalEvidence[]
  expansion?: RetrievalExpansion
}

export interface RetrievalSearchInput {
  session: Session
  sessionStore: SessionStore
  memoryStore: RuntimeMemoryStore
  learningsStore: AgentLearningsStore
  currentAgentSetupFingerprint?: string | null
  currentActiveOutcome?: SessionOutcomeDefinition | null
  query: string
  limit: number
  includeCurrent?: boolean
  lineage?: RetrievalLineageFilter | null
}

export interface RetrievalBackendProvider {
  backend: RetrievalBackend
  search(input: RetrievalSearchInput): Promise<RetrievalCandidate[]>
}
