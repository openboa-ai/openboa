import { describe, expect, it, vi } from "vitest"
import type {
  RetrievalBackendProvider,
  RetrievalSearchInput,
} from "../src/agents/retrieval/model.js"
import { formatRetrievalCandidateHint } from "../src/agents/retrieval/pipeline.js"
import {
  presentRetrievalSearchResult,
  searchCrossSessionRecall,
} from "../src/agents/retrieval/search.js"

describe("searchCrossSessionRecall", () => {
  it("supports pluggable retrieval backend providers, including vector backends", async () => {
    const vectorSearch = vi.fn(async (input: RetrievalSearchInput) => [
      {
        backend: "vector" as const,
        source: "local_vector_index",
        agentId: input.session.agentId,
        sessionId: "prior-session",
        eventId: "evt-1",
        title: "Compact recall preference",
        snippet: "Vector hit for compact recall behavior.",
        score: 9,
        createdAt: "2026-04-10T00:00:00.000Z",
        reasons: ["vector-similarity"],
        expansion: {
          tool: "session_get_events",
          args: { sessionId: "prior-session", aroundEventId: "evt-1" },
          rationale: "Open the nearest source event around the vector hit.",
        },
      },
    ])

    const vectorBackend: RetrievalBackendProvider = {
      backend: "vector",
      search: vectorSearch,
    }

    const unusedMemoryBackend: RetrievalBackendProvider = {
      backend: "memory",
      search: vi.fn(async () => {
        throw new Error("memory backend should not run when filtered out")
      }),
    }

    const result = await searchCrossSessionRecall({
      session: { id: "session-1", agentId: "alpha" } as RetrievalSearchInput["session"],
      sessionStore: {} as RetrievalSearchInput["sessionStore"],
      memoryStore: {} as RetrievalSearchInput["memoryStore"],
      learningsStore: {} as RetrievalSearchInput["learningsStore"],
      query: "compact recall",
      limit: 5,
      backends: ["vector"],
      providers: [vectorBackend, unusedMemoryBackend],
    })

    expect(vectorSearch).toHaveBeenCalledOnce()
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]?.backend).toBe("vector")
    expect(result.hits[0]?.expansion?.tool).toBe("session_get_events")
    expect(result.hits[0]?.confidence).toBe("medium")
    expect(result.backendHits.vector).toHaveLength(1)
    expect(result.backendHits.memory).toBeUndefined()
  })

  it("normalizes setup-mismatched pluggable backend hits to agent_compare_setup", async () => {
    const vectorBackend: RetrievalBackendProvider = {
      backend: "vector",
      search: vi.fn(async (input: RetrievalSearchInput) => [
        {
          backend: "vector" as const,
          source: "local_vector_index",
          agentId: input.session.agentId,
          sessionId: "prior-session",
          eventId: "evt-1",
          title: "Prior work from another setup",
          snippet: "Vector hit that should be guarded by setup comparison.",
          score: 9,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["vector-similarity", "setup:different"],
          setupFingerprint: "setup-prior",
          setupMatch: false,
          expansion: {
            tool: "session_get_events",
            args: { sessionId: "prior-session", aroundEventId: "evt-1" },
            rationale: "Open the nearest source event around the vector hit.",
          },
        },
      ]),
    }

    const result = await searchCrossSessionRecall({
      session: { id: "session-1", agentId: "alpha" } as RetrievalSearchInput["session"],
      sessionStore: {} as RetrievalSearchInput["sessionStore"],
      memoryStore: {} as RetrievalSearchInput["memoryStore"],
      learningsStore: {} as RetrievalSearchInput["learningsStore"],
      query: "setup mismatch",
      limit: 5,
      backends: ["vector"],
      providers: [vectorBackend],
    })

    expect(result.hits[0]?.expansion?.tool).toBe("agent_compare_setup")
    expect(result.hits[0]?.expansion?.args).toEqual({ sessionId: "prior-session" })
  })

  it("merges the same anchor across backends and preserves backend evidence", async () => {
    const vectorBackend: RetrievalBackendProvider = {
      backend: "vector",
      search: vi.fn(async (input: RetrievalSearchInput) => [
        {
          backend: "vector" as const,
          source: "local_vector_index",
          agentId: input.session.agentId,
          sessionId: "prior-session",
          eventId: "evt-1",
          sessionRelation: "parent",
          title: "Compact recall preference",
          snippet: "Vector hit for compact recall behavior.",
          score: 9,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["vector-similarity"],
        },
      ]),
    }

    const sessionBackend: RetrievalBackendProvider = {
      backend: "session_context",
      search: vi.fn(async (input: RetrievalSearchInput) => [
        {
          backend: "session_context" as const,
          source: "agent.message",
          agentId: input.session.agentId,
          sessionId: "prior-session",
          eventId: "evt-1",
          title: "Compact recall preference",
          snippet: "The same anchor found via deterministic session reread.",
          score: 7,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["exact-query"],
        },
      ]),
    }

    const result = await searchCrossSessionRecall({
      session: { id: "session-1", agentId: "alpha" } as RetrievalSearchInput["session"],
      sessionStore: {} as RetrievalSearchInput["sessionStore"],
      memoryStore: {} as RetrievalSearchInput["memoryStore"],
      learningsStore: {} as RetrievalSearchInput["learningsStore"],
      query: "compact recall",
      limit: 5,
      backends: ["vector", "session_context"],
      providers: [vectorBackend, sessionBackend],
    })

    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]?.backend).toBe("vector")
    expect(result.hits[0]?.score).toBe(10)
    expect(result.hits[0]?.confidence).toBe("high")
    expect(result.hits[0]?.sessionRelation).toBe("parent")
    expect(result.hits[0]?.evidence?.map((entry) => entry.backend)).toEqual(
      expect.arrayContaining(["vector", "session_context"]),
    )
    expect(
      result.hits[0]?.evidence?.find((entry) => entry.backend === "vector")?.sessionRelation,
    ).toBe("parent")

    const presentation = presentRetrievalSearchResult(result)
    expect(presentation.backendSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backend: "vector", count: 1 }),
        expect.objectContaining({ backend: "session_context", count: 1 }),
      ]),
    )
    expect(presentation.expansionPlan).toHaveLength(0)
  })

  it("supports wake-trace retrieval candidates without collapsing them into event anchors", async () => {
    const traceBackend: RetrievalBackendProvider = {
      backend: "session_trace",
      search: vi.fn(async (input: RetrievalSearchInput) => [
        {
          backend: "session_trace" as const,
          source: "wake.trace",
          agentId: input.session.agentId,
          sessionId: "prior-session",
          eventId: null,
          wakeId: "wake-1",
          title: "Investigated managed tool failure @ wake-1",
          snippet: "Wake trace covering a managed tool failure investigation.",
          score: 8,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["exact-query"],
          expansion: {
            tool: "session_get_trace",
            args: { sessionId: "prior-session", wakeId: "wake-1" },
            rationale: "Open the full bounded trace.",
          },
        },
      ]),
    }

    const sessionBackend: RetrievalBackendProvider = {
      backend: "session_context",
      search: vi.fn(async (input: RetrievalSearchInput) => [
        {
          backend: "session_context" as const,
          source: "agent.tool_use",
          agentId: input.session.agentId,
          sessionId: "prior-session",
          eventId: "evt-1",
          wakeId: "wake-1",
          title: "resources_promote_to_substrate @ evt-1",
          snippet: "The same wake also contains one concrete tool-use anchor.",
          score: 7,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["term-overlap:2"],
        },
      ]),
    }

    const result = await searchCrossSessionRecall({
      session: { id: "session-1", agentId: "alpha" } as RetrievalSearchInput["session"],
      sessionStore: {} as RetrievalSearchInput["sessionStore"],
      memoryStore: {} as RetrievalSearchInput["memoryStore"],
      learningsStore: {} as RetrievalSearchInput["learningsStore"],
      query: "managed tool failure",
      limit: 5,
      backends: ["session_trace", "session_context"],
      providers: [traceBackend, sessionBackend],
    })

    expect(result.hits).toHaveLength(2)
    expect(result.hits.map((hit) => hit.backend)).toEqual(
      expect.arrayContaining(["session_trace", "session_context"]),
    )
    expect(result.hits.find((hit) => hit.backend === "session_trace")?.expansion?.tool).toBe(
      "session_get_trace",
    )
  })

  it("passes the current agent setup fingerprint into retrieval providers", async () => {
    const provider: RetrievalBackendProvider = {
      backend: "memory",
      search: vi.fn(async (input: RetrievalSearchInput) => {
        expect(input.currentAgentSetupFingerprint).toBe("setup-current")
        expect(input.currentActiveOutcome?.title).toBe("Compact preference recall")
        return [
          {
            backend: "memory" as const,
            source: "session_checkpoint",
            agentId: input.session.agentId,
            sessionId: "prior-session",
            eventId: null,
            title: "Same setup checkpoint",
            snippet: "Checkpoint from the same setup.",
            score: 8,
            createdAt: "2026-04-10T00:00:00.000Z",
            reasons: ["setup:same"],
            setupFingerprint: "setup-current",
            setupMatch: true,
          },
        ]
      }),
    }

    const result = await searchCrossSessionRecall({
      session: { id: "session-1", agentId: "alpha" } as RetrievalSearchInput["session"],
      sessionStore: {} as RetrievalSearchInput["sessionStore"],
      memoryStore: {
        read: vi.fn(async () => ({
          checkpoint: {
            lastAgentSetupFingerprint: "setup-current",
          },
        })),
      } as unknown as RetrievalSearchInput["memoryStore"],
      learningsStore: {} as RetrievalSearchInput["learningsStore"],
      currentActiveOutcome: {
        title: "Compact preference recall",
        detail: "Keep recall compact while preserving relevant prior work.",
        successCriteria: ["Use concise ranked recall"],
      },
      query: "same setup",
      limit: 3,
      backends: ["memory"],
      providers: [provider],
    })

    expect(provider.search).toHaveBeenCalledOnce()
    expect(result.hits[0]?.setupMatch).toBe(true)
  })

  it("recommends agent_compare_setup before deeper rereads when a prior session setup differs", async () => {
    const provider: RetrievalBackendProvider = {
      backend: "session_context",
      search: vi.fn(async (input: RetrievalSearchInput) => [
        {
          backend: "session_context" as const,
          source: "agent.message",
          agentId: input.session.agentId,
          sessionId: "prior-session",
          eventId: "evt-1",
          title: "Prior anchor from different setup",
          snippet: "Matched prior event anchor.",
          score: 8,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["setup:different"],
          setupFingerprint: "setup-prior",
          setupMatch: false,
          expansion: {
            tool: "agent_compare_setup",
            args: { sessionId: "prior-session" },
            rationale:
              "Compare the current agent setup with this prior session before reusing its work or rereading deeper traces from a different setup.",
          },
        },
      ]),
    }

    const result = await searchCrossSessionRecall({
      session: { id: "session-1", agentId: "alpha" } as RetrievalSearchInput["session"],
      sessionStore: {} as RetrievalSearchInput["sessionStore"],
      memoryStore: {
        read: vi.fn(async () => ({
          checkpoint: {
            lastAgentSetupFingerprint: "setup-current",
          },
        })),
      } as unknown as RetrievalSearchInput["memoryStore"],
      learningsStore: {} as RetrievalSearchInput["learningsStore"],
      query: "different setup",
      limit: 3,
      backends: ["session_context"],
      providers: [provider],
    })

    expect(result.hits[0]?.expansion?.tool).toBe("agent_compare_setup")
    expect(result.hits[0]?.expansion?.args).toEqual({ sessionId: "prior-session" })

    const presentation = presentRetrievalSearchResult(result)
    expect(presentation.expansionPlan[0]?.tool).toBe("agent_compare_setup")
  })

  it("prefers bounded verification seams over broad rereads when expansion support ties", () => {
    const presentation = presentRetrievalSearchResult({
      backendHits: {},
      hits: [
        {
          backend: "memory",
          source: "session_checkpoint",
          agentId: "alpha",
          sessionId: "prior-session",
          eventId: null,
          title: "Checkpoint",
          snippet: "Matched prior checkpoint.",
          score: 8,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["setup:same"],
          expansion: {
            tool: "session_get_snapshot",
            args: { sessionId: "prior-session" },
            rationale: "Open the bounded session snapshot first.",
          },
        },
        {
          backend: "session_context",
          source: "agent.message",
          agentId: "alpha",
          sessionId: "prior-session",
          eventId: "evt-1",
          title: "Anchor",
          snippet: "Matched prior event anchor.",
          score: 8,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["setup:same"],
          expansion: {
            tool: "session_get_events",
            args: { sessionId: "prior-session", aroundEventId: "evt-1" },
            rationale: "Reread the surrounding events.",
          },
        },
      ],
    })

    expect(presentation.expansionPlan[0]?.tool).toBe("session_get_snapshot")
    expect(presentation.expansionPlan[1]?.tool).toBe("session_get_events")
  })

  it("biases the expansion plan toward evaluator seams when promotion is unsafe", () => {
    const presentation = presentRetrievalSearchResult(
      {
        backendHits: {},
        hits: [
          {
            backend: "session_context",
            source: "agent.message",
            agentId: "alpha",
            sessionId: "prior-session",
            eventId: "evt-1",
            title: "Broad reread 1",
            snippet: "Matched prior event anchor.",
            score: 8,
            createdAt: "2026-04-10T00:00:00.000Z",
            reasons: ["setup:same"],
            expansion: {
              tool: "session_get_events",
              args: { sessionId: "prior-session", aroundEventId: "evt-1" },
              rationale: "Reread the surrounding events.",
            },
          },
          {
            backend: "session_context",
            source: "agent.message",
            agentId: "alpha",
            sessionId: "prior-session",
            eventId: "evt-2",
            title: "Broad reread 2",
            snippet: "Matched another prior event anchor.",
            score: 8,
            createdAt: "2026-04-10T00:00:00.000Z",
            reasons: ["setup:same"],
            expansion: {
              tool: "session_get_events",
              args: { sessionId: "prior-session", aroundEventId: "evt-2" },
              rationale: "Reread the surrounding events.",
            },
          },
          {
            backend: "memory",
            source: "session_evaluation",
            agentId: "alpha",
            sessionId: "prior-session",
            eventId: null,
            title: "Outcome evaluator",
            snippet: "Matched a prior evaluator verdict.",
            score: 8,
            createdAt: "2026-04-10T00:00:00.000Z",
            reasons: ["objective:title-match"],
            expansion: {
              tool: "outcome_evaluate",
              args: { sessionId: "prior-session" },
              rationale: "Inspect the evaluator verdict first.",
            },
          },
        ],
      },
      {
        currentOutcomeEvaluation: {
          status: "not_ready",
          confidence: "medium",
          promotionReady: false,
          trend: "improving",
          trendSummary: "The latest bounded iteration improved the evaluator posture.",
          summary: "Promotion is not safe yet.",
          evidence: ["Still blocked on verification."],
          nextSuggestedTool: {
            tool: "outcome_evaluate",
            args: { sessionId: "session-1" },
            rationale: "Verify again before promotion.",
          },
        },
      },
    )

    expect(presentation.expansionPlan[0]?.tool).toBe("outcome_evaluate")
    expect(presentation.expansionPlan[1]?.tool).toBe("session_get_events")
  })

  it("biases the expansion plan toward outcome_history when evaluator posture is stalled", () => {
    const presentation = presentRetrievalSearchResult(
      {
        backendHits: {},
        hits: [
          {
            backend: "memory",
            source: "session_evaluation",
            agentId: "alpha",
            sessionId: "prior-session",
            eventId: null,
            title: "Outcome evaluator history",
            snippet: "Matched a prior evaluator iteration series.",
            score: 8,
            createdAt: "2026-04-10T00:00:00.000Z",
            reasons: ["objective:title-match"],
            expansion: {
              tool: "outcome_history",
              args: { sessionId: "prior-session" },
              rationale: "Inspect evaluator drift before mutating shared state again.",
            },
          },
          {
            backend: "memory",
            source: "session_evaluation",
            agentId: "alpha",
            sessionId: "prior-session",
            eventId: null,
            title: "Outcome evaluator",
            snippet: "Matched a prior evaluator verdict.",
            score: 8,
            createdAt: "2026-04-10T00:00:00.000Z",
            reasons: ["objective:title-match"],
            expansion: {
              tool: "outcome_evaluate",
              args: { sessionId: "prior-session" },
              rationale: "Inspect the evaluator verdict first.",
            },
          },
        ],
      },
      {
        currentOutcomeEvaluation: {
          status: "not_ready",
          confidence: "medium",
          promotionReady: false,
          trend: "stable",
          trendSummary: "Evaluator posture is stalled.",
          summary: "Promotion is still not safe.",
          evidence: ["The same bounded blocker remains."],
          nextSuggestedTool: {
            tool: "outcome_history",
            args: { sessionId: "session-1" },
            rationale: "Inspect repeated evaluator churn before retrying.",
          },
        },
      },
    )

    expect(presentation.expansionPlan[0]?.tool).toBe("outcome_history")
    expect(presentation.expansionPlan[1]?.tool).toBe("outcome_evaluate")
  })

  it("includes evaluator posture in retrieval candidate hints", () => {
    const hint = formatRetrievalCandidateHint({
      backend: "memory",
      source: "session_evaluation",
      agentId: "alpha",
      sessionId: "prior-session",
      eventId: null,
      title: "Prior evaluator posture",
      snippet: "Promotion was still unsafe.",
      score: 8,
      createdAt: "2026-04-10T00:00:00.000Z",
      reasons: ["evaluation:stable"],
      requiresAction: true,
      pendingActionKind: "tool_confirmation",
      pendingActionToolName: "shell_run",
      outcomeStatus: "not_ready",
      promotionReady: false,
      outcomeTrend: "stable",
    })

    expect(hint).toContain("outcomeStatus=not_ready")
    expect(hint).toContain("promotionReady=false")
    expect(hint).toContain("outcomeTrend=stable")
    expect(hint).toContain("requiresAction=true")
    expect(hint).toContain("pendingActionKind=tool_confirmation")
    expect(hint).toContain("pendingActionTool=shell_run")
  })
})
