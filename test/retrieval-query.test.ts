import { describe, expect, it } from "vitest"

import {
  buildRetrievalQuery,
  buildRetrievalSnippet,
  computeSessionRelationAffinity,
  matchesSessionLineageFilter,
  rankRetrievalCandidates,
  scoreRetrievalText,
} from "../src/agents/retrieval/query.js"

describe("retrieval query scoring", () => {
  it("extracts quoted phrases and path-like anchors for deterministic recall", () => {
    const query = buildRetrievalQuery(
      'check `src/agents/runtime/harness.ts` for "quality pass" handling',
    )
    expect(query).not.toBeNull()
    expect(query?.phrases).toContain("quality pass")
    expect(query?.pathTerms).toContain("src/agents/runtime/harness.ts")
  })

  it("scores exact phrases, path-like tokens, and identifiers above plain lexical overlap", () => {
    const query = buildRetrievalQuery(
      'inspect `src/agents/runtime/harness.ts` issue QA-142 "quality pass"',
    )
    expect(query).not.toBeNull()
    if (!query) {
      throw new Error("Expected retrieval query to be built")
    }

    const match = scoreRetrievalText(
      "Follow up on QA-142 in src/agents/runtime/harness.ts before the quality pass lands.",
      query,
    )

    expect(match.score).toBeGreaterThan(0)
    expect(match.reasons.some((reason) => reason.startsWith("exact-phrase:"))).toBe(true)
    expect(match.reasons.some((reason) => reason.startsWith("path-match:"))).toBe(true)
    expect(match.reasons.some((reason) => reason.startsWith("identifier-match:"))).toBe(true)

    const snippet = buildRetrievalSnippet(
      "Please inspect src/agents/runtime/harness.ts before the quality pass lands for QA-142.",
      query,
      80,
    )
    expect(snippet).toContain("src/agents/runtime/harness.ts")
  })

  it("prefers setup-matching retrieval candidates when scores tie", () => {
    const ranked = rankRetrievalCandidates(
      [
        {
          backend: "memory",
          source: "session_checkpoint",
          agentId: "alpha",
          sessionId: "session-different",
          eventId: null,
          title: "Different setup",
          snippet: "A prior checkpoint from a different setup.",
          score: 7,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["term-overlap:2", "setup:different"],
          setupFingerprint: "setup-b",
          setupMatch: false,
        },
        {
          backend: "memory",
          source: "session_checkpoint",
          agentId: "alpha",
          sessionId: "session-same",
          eventId: null,
          title: "Same setup",
          snippet: "A prior checkpoint from the same setup.",
          score: 7,
          createdAt: "2026-04-09T00:00:00.000Z",
          reasons: ["term-overlap:2", "setup:same"],
          setupFingerprint: "setup-a",
          setupMatch: true,
        },
      ],
      2,
    )

    expect(ranked[0]?.sessionId).toBe("session-same")
    expect(ranked[1]?.sessionId).toBe("session-different")
  })

  it("prefers related sessions when scores and setup posture tie", () => {
    const ranked = rankRetrievalCandidates(
      [
        {
          backend: "memory",
          source: "session_checkpoint",
          agentId: "alpha",
          sessionId: "unrelated-session",
          eventId: null,
          title: "Unrelated checkpoint",
          snippet: "A prior checkpoint from an unrelated session.",
          score: 7,
          createdAt: "2026-04-10T00:00:00.000Z",
          reasons: ["term-overlap:2"],
          setupMatch: true,
        },
        {
          backend: "memory",
          source: "session_checkpoint",
          agentId: "alpha",
          sessionId: "parent-session",
          eventId: null,
          title: "Parent checkpoint",
          snippet: "A prior checkpoint from the parent session.",
          score: 7,
          createdAt: "2026-04-09T00:00:00.000Z",
          reasons: ["term-overlap:2", "relation:parent"],
          setupMatch: true,
          sessionRelation: "parent",
        },
      ],
      2,
    )

    expect(ranked[0]?.sessionId).toBe("parent-session")
    expect(ranked[1]?.sessionId).toBe("unrelated-session")
  })

  it("computes parent, child, and sibling relation affinity", () => {
    const parent = computeSessionRelationAffinity({
      currentSession: {
        id: "current",
        metadata: { parentSessionId: "parent" },
      } as never,
      candidateSession: {
        id: "parent",
        metadata: {},
      } as never,
    })
    const child = computeSessionRelationAffinity({
      currentSession: {
        id: "current",
        metadata: {},
      } as never,
      candidateSession: {
        id: "child",
        metadata: { parentSessionId: "current" },
      } as never,
    })
    const sibling = computeSessionRelationAffinity({
      currentSession: {
        id: "current",
        metadata: { parentSessionId: "shared-parent" },
      } as never,
      candidateSession: {
        id: "sibling",
        metadata: { parentSessionId: "shared-parent" },
      } as never,
    })

    expect(parent).toMatchObject({ relation: "parent", scoreBoost: 2 })
    expect(child).toMatchObject({ relation: "child", scoreBoost: 2 })
    expect(sibling).toMatchObject({ relation: "sibling", scoreBoost: 1 })
  })

  it("matches lineage filters against session relations", () => {
    expect(matchesSessionLineageFilter("related", "parent")).toBe(true)
    expect(matchesSessionLineageFilter("related", "child")).toBe(true)
    expect(matchesSessionLineageFilter("related", "sibling")).toBe(true)
    expect(matchesSessionLineageFilter("parent", "parent")).toBe(true)
    expect(matchesSessionLineageFilter("children", "child")).toBe(true)
    expect(matchesSessionLineageFilter("siblings", "sibling")).toBe(true)
    expect(matchesSessionLineageFilter("parent", "child")).toBe(false)
    expect(matchesSessionLineageFilter("children", null)).toBe(false)
  })
})
