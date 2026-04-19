import type { RetrievalExpansion } from "./model.js"

export function makeSetupAwareExpansion(input: {
  sessionId: string | null
  setupFingerprint?: string | null
  setupMatch?: boolean | null
  expansion: RetrievalExpansion
}): RetrievalExpansion {
  if (!input.sessionId || !input.setupFingerprint || input.setupMatch !== false) {
    return input.expansion
  }

  return {
    tool: "agent_compare_setup",
    args: { sessionId: input.sessionId },
    rationale:
      "Compare the current agent setup with this prior session before reusing its work or rereading deeper traces from a different setup.",
  }
}
