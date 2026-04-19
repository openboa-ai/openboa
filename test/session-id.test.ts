import { describe, expect, it } from "vitest"
import {
  createAgentSessionId,
  normalizeAgentSessionId,
  resolveAgentSessionId,
} from "../src/agents/sessions/session-id.js"
import { isUuidV7 } from "../src/foundation/ids.js"

describe("agent session ids", () => {
  it("creates v7 session ids by default", () => {
    expect(isUuidV7(createAgentSessionId())).toBe(true)
    expect(isUuidV7(resolveAgentSessionId(undefined))).toBe(true)
  })

  it("accepts only v7 ids when a session id is provided", () => {
    const sessionId = createAgentSessionId()
    expect(normalizeAgentSessionId(sessionId)).toBe(sessionId)
    expect(() => normalizeAgentSessionId("main")).toThrow("session id must be a UUID v7")
  })
})
