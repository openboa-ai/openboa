import { searchAgentMemory } from "../memory/memory-search.js"
import { searchAgentSessionContext } from "../sessions/session-context-search.js"
import { searchAgentSessionTraces } from "../sessions/session-trace-search.js"
import type { RetrievalBackendProvider, RetrievalSearchInput } from "./model.js"

export function createMemoryRetrievalBackend(): RetrievalBackendProvider {
  return {
    backend: "memory",
    async search(input: RetrievalSearchInput) {
      return searchAgentMemory({
        session: input.session,
        sessionStore: input.sessionStore,
        memoryStore: input.memoryStore,
        learningsStore: input.learningsStore,
        currentAgentSetupFingerprint: input.currentAgentSetupFingerprint ?? null,
        currentActiveOutcome: input.currentActiveOutcome ?? null,
        query: input.query,
        limit: input.limit,
      })
    },
  }
}

export function createSessionContextRetrievalBackend(): RetrievalBackendProvider {
  return {
    backend: "session_context",
    async search(input: RetrievalSearchInput) {
      return searchAgentSessionContext({
        session: input.session,
        sessionStore: input.sessionStore,
        memoryStore: input.memoryStore,
        currentAgentSetupFingerprint: input.currentAgentSetupFingerprint ?? null,
        currentActiveOutcome: input.currentActiveOutcome ?? null,
        query: input.query,
        limit: input.limit,
        includeCurrent: input.includeCurrent,
      })
    },
  }
}

export function createSessionTraceRetrievalBackend(): RetrievalBackendProvider {
  return {
    backend: "session_trace",
    async search(input: RetrievalSearchInput) {
      return searchAgentSessionTraces({
        session: input.session,
        sessionStore: input.sessionStore,
        memoryStore: input.memoryStore,
        currentAgentSetupFingerprint: input.currentAgentSetupFingerprint ?? null,
        currentActiveOutcome: input.currentActiveOutcome ?? null,
        query: input.query,
        limit: input.limit,
        includeCurrent: input.includeCurrent,
      })
    },
  }
}

export function createDefaultRetrievalBackends(): RetrievalBackendProvider[] {
  return [
    createMemoryRetrievalBackend(),
    createSessionContextRetrievalBackend(),
    createSessionTraceRetrievalBackend(),
  ]
}
