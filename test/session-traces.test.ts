import { describe, expect, it } from "vitest"
import type { SessionEvent } from "../src/agents/schema/runtime.js"
import { summarizeSessionTraces } from "../src/agents/sessions/session-traces.js"

describe("summarizeSessionTraces", () => {
  it("falls back to the latest tool activity when a wake has not reached idle yet", () => {
    const wakeId = "wake-1"
    const events: SessionEvent[] = [
      {
        id: "evt-1",
        type: "session.status_changed",
        createdAt: "2026-04-10T00:00:00.000Z",
        processedAt: "2026-04-10T00:00:00.000Z",
        wakeId,
        fromStatus: "idle",
        toStatus: "running",
        reason: "idle",
      },
      {
        id: "evt-2",
        type: "span.started",
        createdAt: "2026-04-10T00:00:01.000Z",
        processedAt: "2026-04-10T00:00:01.000Z",
        wakeId,
        spanId: "tool-span-1",
        parentSpanId: wakeId,
        spanKind: "tool",
        name: "session_get_trace",
        summary: "Read one bounded wake trace.",
      },
      {
        id: "evt-3",
        type: "agent.tool_use",
        createdAt: "2026-04-10T00:00:02.000Z",
        processedAt: "2026-04-10T00:00:02.000Z",
        wakeId,
        requestId: null,
        toolName: "session_get_trace",
        ownership: "managed",
        permissionPolicy: "always_allow",
        input: {},
        output: "{}",
      },
    ]

    const traces = summarizeSessionTraces(events)
    expect(traces).toHaveLength(1)
    expect(traces[0]?.latestSummary).toBe("tool:session_get_trace")
  })
})
