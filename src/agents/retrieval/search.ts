import type { SessionOutcomeEvaluation } from "../outcomes/outcome-evaluate.js"
import { createDefaultRetrievalBackends } from "./backends.js"
import type {
  RetrievalBackend,
  RetrievalBackendProvider,
  RetrievalCandidate,
  RetrievalExpansion,
  RetrievalSearchInput,
} from "./model.js"
import { mergeRetrievalCandidates } from "./pipeline.js"

export type RetrievalSearchBackend = RetrievalBackend

export interface RetrievalSearchResult {
  hits: RetrievalCandidate[]
  backendHits: Partial<Record<RetrievalBackend, RetrievalCandidate[]>>
}

export interface RetrievalBackendSummary {
  backend: RetrievalBackend
  count: number
  topScore: number | null
}

export interface RetrievalExpansionPlanStep extends RetrievalExpansion {
  supportCount: number
  candidateTitles: string[]
}

export interface RetrievalSearchPresentation {
  backendSummary: RetrievalBackendSummary[]
  expansionPlan: RetrievalExpansionPlanStep[]
}

function expansionToolPriority(tool: RetrievalExpansion["tool"]): number {
  switch (tool) {
    case "outcome_read":
      return 0
    case "outcome_history":
      return 1
    case "outcome_evaluate":
      return 2
    case "agent_compare_setup":
      return 3
    case "session_get_snapshot":
      return 4
    case "session_get_trace":
      return 5
    case "memory_read":
      return 6
    case "shell_describe":
      return 7
    case "shell_read_last_output":
      return 8
    case "shell_history":
      return 9
    case "session_get_events":
      return 10
    case "learning_list":
      return 11
  }
}

function expansionUrgencyBoost(
  tool: RetrievalExpansion["tool"],
  currentOutcomeEvaluation: SessionOutcomeEvaluation | null | undefined,
): number {
  if (!currentOutcomeEvaluation || currentOutcomeEvaluation.promotionReady) {
    return 0
  }
  const stalledTrend =
    currentOutcomeEvaluation.trend === "stable" || currentOutcomeEvaluation.trend === "regressing"
  switch (tool) {
    case "outcome_history":
      return stalledTrend ? 5 : 3
    case "outcome_evaluate":
      return stalledTrend ? 1 : 2
    case "outcome_read":
      return 1
    case "agent_compare_setup":
      return 1
    case "session_get_snapshot":
      return 1
    case "session_get_trace":
      return 1
    default:
      return 0
  }
}

function buildRetrievalBackendSummary(
  backendHits: Partial<Record<RetrievalBackend, RetrievalCandidate[]>>,
): RetrievalBackendSummary[] {
  return Object.entries(backendHits).map(([backend, hits]) => ({
    backend: backend as RetrievalBackend,
    count: hits?.length ?? 0,
    topScore: hits && hits.length > 0 ? Math.max(...hits.map((hit) => hit.score)) : null,
  }))
}

function buildRetrievalExpansionPlan(
  hits: RetrievalCandidate[],
  options: { currentOutcomeEvaluation?: SessionOutcomeEvaluation | null } = {},
): RetrievalExpansionPlanStep[] {
  const grouped = new Map<string, RetrievalExpansionPlanStep>()

  for (const hit of hits) {
    if (!hit.expansion) {
      continue
    }
    const key = `${hit.expansion.tool}::${JSON.stringify(hit.expansion.args)}`
    const existing = grouped.get(key)
    if (existing) {
      existing.supportCount += 1
      if (!existing.candidateTitles.includes(hit.title)) {
        existing.candidateTitles.push(hit.title)
      }
      continue
    }
    grouped.set(key, {
      ...hit.expansion,
      supportCount: 1,
      candidateTitles: [hit.title],
    })
  }

  return [...grouped.values()].sort(
    (left, right) =>
      right.supportCount +
        expansionUrgencyBoost(right.tool, options.currentOutcomeEvaluation) -
        (left.supportCount + expansionUrgencyBoost(left.tool, options.currentOutcomeEvaluation)) ||
      expansionToolPriority(left.tool) - expansionToolPriority(right.tool),
  )
}

export function presentRetrievalSearchResult(
  result: RetrievalSearchResult,
  options: { currentOutcomeEvaluation?: SessionOutcomeEvaluation | null } = {},
): RetrievalSearchPresentation {
  return {
    backendSummary: buildRetrievalBackendSummary(result.backendHits),
    expansionPlan: buildRetrievalExpansionPlan(result.hits, options),
  }
}

export async function searchCrossSessionRecall(input: {
  session: RetrievalSearchInput["session"]
  sessionStore: RetrievalSearchInput["sessionStore"]
  memoryStore: RetrievalSearchInput["memoryStore"]
  learningsStore: RetrievalSearchInput["learningsStore"]
  currentAgentSetupFingerprint?: string | null
  currentActiveOutcome?: RetrievalSearchInput["currentActiveOutcome"]
  query: string
  limit: number
  includeCurrent?: boolean
  lineage?: RetrievalSearchInput["lineage"]
  backends?: RetrievalSearchBackend[]
  providers?: RetrievalBackendProvider[]
}): Promise<RetrievalSearchResult> {
  const selectedBackends =
    input.backends && input.backends.length > 0
      ? [...new Set(input.backends)]
      : (["memory", "session_context", "session_trace"] as RetrievalSearchBackend[])
  const providers = input.providers ?? createDefaultRetrievalBackends()
  const selectedProviders = providers.filter((provider) =>
    selectedBackends.includes(provider.backend),
  )

  let currentAgentSetupFingerprint = input.currentAgentSetupFingerprint ?? null
  if (currentAgentSetupFingerprint === null && typeof input.memoryStore.read === "function") {
    try {
      const currentRuntimeMemory = await input.memoryStore.read(
        input.session.agentId,
        input.session.id,
      )
      currentAgentSetupFingerprint =
        currentRuntimeMemory.checkpoint?.lastAgentSetupFingerprint ?? null
    } catch {
      currentAgentSetupFingerprint = null
    }
  }

  const backendEntries = await Promise.all(
    selectedProviders.map(
      async (provider) =>
        [
          provider.backend,
          await provider.search({
            session: input.session,
            sessionStore: input.sessionStore,
            memoryStore: input.memoryStore,
            learningsStore: input.learningsStore,
            currentAgentSetupFingerprint,
            currentActiveOutcome: input.currentActiveOutcome ?? null,
            query: input.query,
            limit: input.limit,
            includeCurrent: input.includeCurrent,
            lineage: input.lineage ?? null,
          }),
        ] as const,
    ),
  )
  const backendHits = Object.fromEntries(backendEntries) as Partial<
    Record<RetrievalBackend, RetrievalCandidate[]>
  >

  return {
    hits: mergeRetrievalCandidates(Object.values(backendHits), input.limit),
    backendHits,
  }
}
