import { describe, expect, it } from "vitest"
import type { SessionEvent } from "../src/agents/schema/runtime.js"
import { buildSessionContext } from "../src/agents/sessions/context-builder.js"

describe("session context builder", () => {
  it("preserves the most recent conversation continuity under runtime-note pressure", () => {
    const events: SessionEvent[] = [
      {
        id: "event-user",
        type: "user.message",
        createdAt: "2026-04-10T00:00:00.000Z",
        processedAt: "2026-04-10T00:00:00.000Z",
        message: "Earlier question",
      },
      {
        id: "event-agent",
        type: "agent.message",
        createdAt: "2026-04-10T00:00:01.000Z",
        processedAt: "2026-04-10T00:00:01.000Z",
        message: "Earlier answer",
        summary: "Earlier answer",
      },
      {
        id: "event-tool",
        type: "agent.tool_use",
        createdAt: "2026-04-10T00:00:02.000Z",
        processedAt: "2026-04-10T00:00:02.000Z",
        requestId: null,
        toolName: "memory_read",
        ownership: "managed",
        permissionPolicy: "always_allow",
        input: { target: "checkpoint" },
        output: "x".repeat(160),
      },
      {
        id: "event-idle",
        type: "session.status_idle",
        createdAt: "2026-04-10T00:00:03.000Z",
        processedAt: "2026-04-10T00:00:03.000Z",
        reason: "idle",
        summary: "y".repeat(100),
        blockingEventIds: null,
      },
    ]

    const context = buildSessionContext({
      events,
      sessionId: "session-1",
      agentId: "alpha",
      systemPrompt: "",
      incomingMessage: "",
      tokenBudget: 90,
    })

    expect(context.conversationHistory.map((record) => record.message)).toEqual([
      "Earlier question",
      "Earlier answer",
    ])
    expect(context.runtimeNotes.length).toBeGreaterThan(0)
    expect(context.selectedHistory.at(-1)?.kind).toBe("runtime_note")
  })
})
