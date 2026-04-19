import { makeSetupAwareExpansion } from "./expansion.js"
import type { RetrievalCandidate, RetrievalConfidence, RetrievalEvidence } from "./model.js"
import { rankRetrievalCandidates } from "./query.js"
import type { RetrievalSearchPresentation } from "./search.js"

function buildMergeKey(candidate: RetrievalCandidate): string {
  if (candidate.wakeId && !candidate.eventId) {
    return ["wake", candidate.sessionId ?? "none", candidate.wakeId].join("::")
  }
  if (candidate.sessionId || candidate.eventId) {
    return ["anchor", candidate.sessionId ?? "none", candidate.eventId ?? "none"].join("::")
  }
  return ["content", candidate.source, candidate.title, candidate.snippet].join("::")
}

function toEvidence(candidate: RetrievalCandidate): RetrievalEvidence {
  return {
    backend: candidate.backend,
    source: candidate.source,
    score: candidate.score,
    reasons: candidate.reasons,
    setupMatch: candidate.setupMatch ?? null,
    sessionRelation: candidate.sessionRelation ?? null,
  }
}

function computeRetrievalConfidence(input: {
  score: number
  evidenceCount: number
}): RetrievalConfidence {
  if (input.evidenceCount >= 2 || input.score >= 10) {
    return "high"
  }
  if (input.score >= 6) {
    return "medium"
  }
  return "low"
}

export function mergeRetrievalCandidates(
  candidateGroups: RetrievalCandidate[][],
  limit: number,
): RetrievalCandidate[] {
  const merged = new Map<string, RetrievalCandidate>()

  for (const group of candidateGroups) {
    for (const candidate of group) {
      const key = buildMergeKey(candidate)
      const existing = merged.get(key)
      if (!existing) {
        const setupFingerprint = candidate.setupFingerprint ?? null
        const setupMatch = candidate.setupMatch ?? null
        merged.set(key, {
          ...candidate,
          setupFingerprint,
          setupMatch,
          expansion: candidate.expansion
            ? makeSetupAwareExpansion({
                sessionId: candidate.sessionId,
                setupFingerprint,
                setupMatch,
                expansion: candidate.expansion,
              })
            : candidate.expansion,
          evidence: candidate.evidence ?? [toEvidence(candidate)],
          confidence: computeRetrievalConfidence({
            score: candidate.score,
            evidenceCount: candidate.evidence?.length ?? 1,
          }),
        })
        continue
      }

      const strongest = candidate.score > existing.score ? candidate : existing
      const priorEvidence = existing.evidence ?? [toEvidence(existing)]
      const nextEvidence = candidate.evidence ?? [toEvidence(candidate)]
      const mergedEvidence = [...priorEvidence]

      for (const evidence of nextEvidence) {
        if (
          mergedEvidence.some(
            (entry) => entry.backend === evidence.backend && entry.source === evidence.source,
          )
        ) {
          continue
        }
        mergedEvidence.push(evidence)
      }

      const supportBonus = Math.max(0, mergedEvidence.length - 1)
      const mergedScore = Math.max(existing.score, candidate.score) + supportBonus
      const setupFingerprint =
        strongest.setupFingerprint ??
        existing.setupFingerprint ??
        candidate.setupFingerprint ??
        null
      const setupMatch = strongest.setupMatch ?? existing.setupMatch ?? candidate.setupMatch ?? null
      merged.set(key, {
        ...strongest,
        setupFingerprint,
        setupMatch,
        sessionRelation:
          strongest.sessionRelation ??
          existing.sessionRelation ??
          candidate.sessionRelation ??
          null,
        requiresAction:
          strongest.requiresAction ?? existing.requiresAction ?? candidate.requiresAction ?? null,
        pendingActionKind:
          strongest.pendingActionKind ??
          existing.pendingActionKind ??
          candidate.pendingActionKind ??
          null,
        pendingActionToolName:
          strongest.pendingActionToolName ??
          existing.pendingActionToolName ??
          candidate.pendingActionToolName ??
          null,
        outcomeStatus:
          strongest.outcomeStatus ?? existing.outcomeStatus ?? candidate.outcomeStatus ?? null,
        promotionReady:
          strongest.promotionReady ?? existing.promotionReady ?? candidate.promotionReady ?? null,
        outcomeTrend:
          strongest.outcomeTrend ?? existing.outcomeTrend ?? candidate.outcomeTrend ?? null,
        reasons: [...new Set([...existing.reasons, ...candidate.reasons])],
        score: mergedScore,
        expansion: strongest.expansion
          ? makeSetupAwareExpansion({
              sessionId: strongest.sessionId,
              setupFingerprint,
              setupMatch,
              expansion: strongest.expansion,
            })
          : strongest.expansion,
        evidence: mergedEvidence,
        confidence: computeRetrievalConfidence({
          score: mergedScore,
          evidenceCount: mergedEvidence.length,
        }),
      })
    }
  }

  return rankRetrievalCandidates([...merged.values()], limit)
}

export function formatRetrievalCandidateHint(candidate: RetrievalCandidate): string {
  const parts = [
    "[retrieval-candidate]",
    `backend=${candidate.backend}`,
    `source=${candidate.source}`,
  ]
  if (candidate.sessionId) {
    parts.push(`session=${candidate.sessionId}`)
  }
  if (candidate.eventId) {
    parts.push(`event=${candidate.eventId}`)
  }
  if (candidate.wakeId) {
    parts.push(`wake=${candidate.wakeId}`)
  }
  if (candidate.setupMatch !== null && candidate.setupMatch !== undefined) {
    parts.push(`setupMatch=${String(candidate.setupMatch)}`)
  }
  if (candidate.sessionRelation) {
    parts.push(`sessionRelation=${candidate.sessionRelation}`)
  }
  if (candidate.requiresAction !== null && candidate.requiresAction !== undefined) {
    parts.push(`requiresAction=${String(candidate.requiresAction)}`)
  }
  if (candidate.pendingActionKind) {
    parts.push(`pendingActionKind=${candidate.pendingActionKind}`)
  }
  if (candidate.pendingActionToolName) {
    parts.push(`pendingActionTool=${candidate.pendingActionToolName}`)
  }
  if (candidate.outcomeStatus) {
    parts.push(`outcomeStatus=${candidate.outcomeStatus}`)
  }
  if (candidate.promotionReady !== null && candidate.promotionReady !== undefined) {
    parts.push(`promotionReady=${String(candidate.promotionReady)}`)
  }
  if (candidate.outcomeTrend) {
    parts.push(`outcomeTrend=${candidate.outcomeTrend}`)
  }
  if (candidate.reasons.length > 0) {
    parts.push(`reasons=${candidate.reasons.join(",")}`)
  }
  if ((candidate.evidence?.length ?? 0) > 0) {
    parts.push(`matchedBy=${candidate.evidence?.map((entry) => entry.backend).join(",")}`)
  }
  if (candidate.confidence) {
    parts.push(`confidence=${candidate.confidence}`)
  }
  parts.push(`title=${candidate.title}`)
  parts.push(`snippet=${candidate.snippet}`)
  if (candidate.expansion) {
    parts.push(`nextTool=${candidate.expansion.tool}`)
    parts.push(`nextArgs=${JSON.stringify(candidate.expansion.args)}`)
    parts.push(`nextWhy=${candidate.expansion.rationale}`)
  }
  return parts.join(" ")
}

export function formatRetrievalPlanHint(presentation: RetrievalSearchPresentation): string | null {
  const backendSummary = presentation.backendSummary
    .map(
      (entry) =>
        `${entry.backend}:${entry.count}${entry.topScore !== null ? `@${entry.topScore}` : ""}`,
    )
    .join(",")
  const topStep = presentation.expansionPlan[0]
  if (!backendSummary && !topStep) {
    return null
  }
  const parts = ["[retrieval-plan]"]
  if (backendSummary) {
    parts.push(`backends=${backendSummary}`)
  }
  if (topStep) {
    parts.push(`nextTool=${topStep.tool}`)
    parts.push(`nextArgs=${JSON.stringify(topStep.args)}`)
    parts.push(`support=${String(topStep.supportCount)}`)
    parts.push(`nextWhy=${topStep.rationale}`)
  }
  return parts.join(" ")
}
