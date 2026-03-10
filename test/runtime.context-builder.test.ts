import { describe, expect, it } from "vitest"

import { buildContext } from "../src/runtime/context-builder.js"
import type { ChatRecord } from "../src/runtime/storage/chat-store.js"

function record(message: string): ChatRecord {
  return {
    type: "inbound",
    chatId: "chat-1",
    sessionId: "session-1",
    agentId: "pi-agent",
    sender: { kind: "human", id: "operator" },
    recipient: { kind: "agent", id: "pi-agent" },
    message,
    timestamp: new Date(0).toISOString(),
  }
}

describe("buildContext token budget trimming", () => {
  it("keeps newest turns at exact budget boundary", () => {
    const history = [record("one"), record("two"), record("three")]

    const oneTurnCost = buildContext([history[0]], "", "", 1000).estimatedTokens
    const tokenBudget = oneTurnCost * 2 + 2

    const built = buildContext(history, "", "", tokenBudget)
    const messages = built.selectedHistory.map((entry) => entry.message)

    expect(messages).toEqual(["two", "three"])
  })

  it("trims deterministically when over budget", () => {
    const history = [record("one"), record("two"), record("three")]

    const oneTurnCost = buildContext([history[0]], "", "", 1000).estimatedTokens
    const tokenBudget = oneTurnCost * 2 + 1

    const first = buildContext(history, "", "", tokenBudget)
    const second = buildContext(history, "", "", tokenBudget)

    expect(first.selectedHistory.map((entry) => entry.message)).toEqual(["three"])
    expect(second.selectedHistory.map((entry) => entry.message)).toEqual(["three"])
    expect(first.transcript).toBe(second.transcript)
    expect(first.estimatedTokens).toBe(second.estimatedTokens)
  })
})
