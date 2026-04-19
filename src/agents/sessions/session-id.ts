import { isUuidV7, makeUuidV7 } from "../../foundation/ids.js"

export function createAgentSessionId(): string {
  return makeUuidV7()
}

export function normalizeAgentSessionId(sessionId: string | undefined | null): string | null {
  const trimmed = sessionId?.trim()
  if (!trimmed) {
    return null
  }
  if (!isUuidV7(trimmed)) {
    throw new Error("session id must be a UUID v7")
  }
  return trimmed
}

export function resolveAgentSessionId(sessionId: string | undefined | null): string {
  return normalizeAgentSessionId(sessionId) ?? createAgentSessionId()
}

export function tryNormalizeAgentSessionId(sessionId: string | undefined | null): string | null {
  try {
    return normalizeAgentSessionId(sessionId)
  } catch {
    return null
  }
}
