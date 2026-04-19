import type { Session, SessionOutcomeDefinition } from "../schema/runtime.js"
import type {
  RetrievalCandidate,
  RetrievalLineageFilter,
  RetrievalMatch,
  RetrievalQuery,
  RetrievalSessionRelation,
} from "./model.js"

const RETRIEVAL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
])

const PATH_LIKE_TERM = /[/.:]/u
const IDENTIFIER_LIKE_TERM = /[_-]|(?=.*\d)(?=.*[a-z])/iu
const QUOTED_PHRASE_PATTERN = /"([^"\n]{2,160})"|`([^`\n]{2,160})`/gu
const STRUCTURED_TOKEN_PATTERN = /[A-Za-z0-9_./:#-]+/gu

function normalizeRetrievalValue(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase()
}

function uniqueTerms(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

export function buildRetrievalQuery(value: string): RetrievalQuery | null {
  const normalized = normalizeRetrievalValue(value)
  if (normalized.length === 0) {
    return null
  }

  const rawPhrases = [...value.matchAll(QUOTED_PHRASE_PATTERN)]
    .map((match) => match[1] ?? match[2] ?? "")
    .map((phrase) => normalizeRetrievalValue(phrase))
    .filter((phrase) => phrase.length > 1)

  const terms = normalized
    .split(/\s+/u)
    .filter((term) => term.length > 1)
    .filter((term) => !RETRIEVAL_STOPWORDS.has(term))

  const structuredTokens = uniqueTerms(
    [...value.matchAll(STRUCTURED_TOKEN_PATTERN)]
      .map((match) => normalizeRetrievalValue(match[0] ?? ""))
      .filter((token) => token.length > 1),
  )

  const pathTerms = structuredTokens.filter((token) => PATH_LIKE_TERM.test(token))
  const identifiers = structuredTokens.filter(
    (token) => !pathTerms.includes(token) && IDENTIFIER_LIKE_TERM.test(token),
  )

  return {
    raw: value.trim(),
    normalized,
    terms: terms.length > 0 ? [...new Set(terms)] : normalized.split(/\s+/u),
    phrases: uniqueTerms(rawPhrases),
    pathTerms,
    identifiers,
  }
}

export function composeRetrievalQueryParts(
  parts: Array<string | null | undefined>,
  options: { maxParts?: number; maxCharsPerPart?: number } = {},
): string {
  const maxParts = options.maxParts ?? 3
  const maxCharsPerPart = options.maxCharsPerPart ?? 240
  const normalizedParts: string[] = []

  for (const part of parts) {
    const normalized = part?.replace(/\s+/gu, " ").trim()
    if (!normalized || normalized.length === 0) {
      continue
    }
    const bounded =
      normalized.length > maxCharsPerPart
        ? normalized.slice(0, maxCharsPerPart).trimEnd()
        : normalized
    if (!normalizedParts.includes(bounded)) {
      normalizedParts.push(bounded)
    }
    if (normalizedParts.length >= maxParts) {
      break
    }
  }

  return normalizedParts.join("\n")
}

export function buildRetrievalSnippet(
  text: string,
  query: RetrievalQuery,
  maxLength = 180,
): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length === 0) {
    return ""
  }
  const lower = normalized.toLowerCase()
  const anchors = [
    query.normalized,
    ...query.phrases,
    ...query.pathTerms,
    ...query.identifiers,
    ...query.terms,
  ]
  const termIndex = anchors
    .map((anchor) => lower.indexOf(anchor))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  if (termIndex === undefined) {
    return normalized.slice(0, maxLength)
  }
  const start = Math.max(0, termIndex - 40)
  const end = Math.min(normalized.length, start + maxLength)
  const snippet = normalized.slice(start, end)
  return `${start > 0 ? "..." : ""}${snippet}${end < normalized.length ? "..." : ""}`
}

export function scoreRetrievalText(text: string, query: RetrievalQuery): RetrievalMatch {
  const lower = text.toLowerCase()
  let score = 0
  const reasons: string[] = []

  if (query.normalized.length > 0 && lower.includes(query.normalized)) {
    score += 6
    reasons.push("exact-query")
  }

  const exactPhraseMatches = query.phrases.filter((phrase) => lower.includes(phrase)).length
  if (exactPhraseMatches > 0) {
    score += exactPhraseMatches * 4
    reasons.push(`exact-phrase:${exactPhraseMatches}`)
  }

  const pathMatches = query.pathTerms.filter((term) => lower.includes(term)).length
  if (pathMatches > 0) {
    score += pathMatches * 5
    reasons.push(`path-match:${pathMatches}`)
  }

  const identifierMatches = query.identifiers.filter((term) => lower.includes(term)).length
  if (identifierMatches > 0) {
    score += identifierMatches * 3
    reasons.push(`identifier-match:${identifierMatches}`)
  }

  let overlap = 0
  for (const term of query.terms) {
    if (lower.includes(term)) {
      overlap += 1
    }
  }
  if (overlap > 0) {
    score += overlap
    reasons.push(`term-overlap:${overlap}`)
  }

  return { score, reasons }
}

function normalizeOutcomeTerms(value: string | null | undefined): string[] {
  return (
    value
      ?.toLowerCase()
      .split(/[^a-z0-9_./:#-]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 2) ?? []
  )
}

export function computeOutcomeAffinity(input: {
  currentActiveOutcome: SessionOutcomeDefinition | null | undefined
  candidateActiveOutcome: SessionOutcomeDefinition | null | undefined
}): { scoreBoost: number; reasons: string[] } {
  if (!input.currentActiveOutcome || !input.candidateActiveOutcome) {
    return { scoreBoost: 0, reasons: [] }
  }

  const currentTitle = input.currentActiveOutcome.title.trim().toLowerCase()
  const candidateTitle = input.candidateActiveOutcome.title.trim().toLowerCase()
  const reasons: string[] = []
  let scoreBoost = 0

  if (currentTitle.length > 0 && currentTitle === candidateTitle) {
    scoreBoost += 3
    reasons.push("objective:title-match")
  }

  const currentCriteria = new Set(
    input.currentActiveOutcome.successCriteria.flatMap((criterion) =>
      normalizeOutcomeTerms(criterion),
    ),
  )
  const candidateCriteria = new Set(
    input.candidateActiveOutcome.successCriteria.flatMap((criterion) =>
      normalizeOutcomeTerms(criterion),
    ),
  )
  const overlappingCriteria = [...candidateCriteria].filter((term) => currentCriteria.has(term))
  if (overlappingCriteria.length > 0) {
    scoreBoost += Math.min(2, overlappingCriteria.length)
    reasons.push(`objective:criteria-overlap:${overlappingCriteria.length}`)
  }

  return { scoreBoost, reasons }
}

export function computeSessionRelationAffinity(input: {
  currentSession: Session
  candidateSession: Session
}): {
  relation: RetrievalSessionRelation | null
  scoreBoost: number
  reasons: string[]
} {
  if (input.candidateSession.metadata?.parentSessionId === input.currentSession.id) {
    return {
      relation: "child",
      scoreBoost: 2,
      reasons: ["relation:child"],
    }
  }
  if (input.currentSession.metadata?.parentSessionId === input.candidateSession.id) {
    return {
      relation: "parent",
      scoreBoost: 2,
      reasons: ["relation:parent"],
    }
  }
  if (
    input.currentSession.metadata?.parentSessionId &&
    input.candidateSession.metadata?.parentSessionId &&
    input.currentSession.metadata.parentSessionId ===
      input.candidateSession.metadata.parentSessionId
  ) {
    return {
      relation: "sibling",
      scoreBoost: 1,
      reasons: ["relation:sibling"],
    }
  }
  return {
    relation: null,
    scoreBoost: 0,
    reasons: [],
  }
}

export function matchesSessionLineageFilter(
  filter: RetrievalLineageFilter | null | undefined,
  relation: RetrievalSessionRelation | null | undefined,
): boolean {
  if (!filter) {
    return true
  }
  if (filter === "related") {
    return relation === "parent" || relation === "child" || relation === "sibling"
  }
  if (filter === "parent") {
    return relation === "parent"
  }
  if (filter === "children") {
    return relation === "child"
  }
  if (filter === "siblings") {
    return relation === "sibling"
  }
  return true
}

export function rankRetrievalCandidates<T extends RetrievalCandidate>(
  candidates: T[],
  limit: number,
): T[] {
  return candidates
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      if (Boolean(right.setupMatch) !== Boolean(left.setupMatch)) {
        return Number(Boolean(right.setupMatch)) - Number(Boolean(left.setupMatch))
      }
      if (Boolean(right.sessionRelation) !== Boolean(left.sessionRelation)) {
        return Number(Boolean(right.sessionRelation)) - Number(Boolean(left.sessionRelation))
      }
      return (
        Date.parse(right.createdAt ?? "1970-01-01T00:00:00.000Z") -
        Date.parse(left.createdAt ?? "1970-01-01T00:00:00.000Z")
      )
    })
    .slice(0, limit)
}
