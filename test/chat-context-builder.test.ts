import { describe, expect, it } from "vitest"
import { buildContext } from "../src/chat/policy/rooms/context-builder.js"
import type { TranscriptRecord } from "../src/chat/transcript.js"

function makeRecord(overrides: Partial<TranscriptRecord> = {}): TranscriptRecord {
  return {
    conversationId: "conversation-1",
    threadId: null,
    sessionId: "session-1",
    sender: { kind: "participant", id: "alpha" },
    recipient: { kind: "room", id: "conversation-1" },
    message: "hello",
    timestamp: "2026-04-10T00:00:00.000Z",
    ...overrides,
  }
}

describe("chat room context builder", () => {
  it("builds participant-neutral context from transcript history", () => {
    const history = [
      makeRecord({
        message: "founder posted an update",
      }),
      makeRecord({
        sender: { kind: "system", id: "system" },
        recipient: { kind: "room", id: "conversation-1" },
        speakerRole: "system",
        message: "room topic changed",
      }),
    ]

    const context = buildContext(history, "system prompt", "incoming message", 200)

    expect(context.selectedHistory).toEqual(history)
    expect(context.conversationHistory).toEqual(history)
    expect(context.runtimeNotes).toEqual([])
    expect(context.transcript).toContain("user:participant: founder posted an update")
    expect(context.transcript).toContain("system:system: room topic changed")
  })

  it("keeps the newest records that fit within the token budget", () => {
    const history = [
      makeRecord({ message: "first" }),
      makeRecord({ message: "second" }),
      makeRecord({ message: "third" }),
    ]

    const context = buildContext(history, "", "", 8)

    expect(context.selectedHistory).toEqual([history[2]])
    expect(context.conversationHistory).toEqual([history[2]])
    expect(context.runtimeNotes).toEqual([])
  })
})
