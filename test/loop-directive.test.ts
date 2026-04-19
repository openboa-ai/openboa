import { describe, expect, it } from "vitest"
import { buildHarnessSystemPromptAppendix } from "../src/agents/runtime/loop-directive.js"

describe("buildHarnessSystemPromptAppendix", () => {
  it("tells the model to treat the session log as truth and verify retrieval hints with session tools", () => {
    const appendix = buildHarnessSystemPromptAppendix()

    expect(appendix).toContain("The durable truth is the session log")
    expect(appendix).toContain(
      "Treat retrieval hints, summaries, and runtime notes as leads to verify",
    )
    expect(appendix).toContain("session_list")
    expect(appendix).toContain("retrieval_search")
    expect(appendix).toContain("outcome_read")
    expect(appendix).toContain("outcome_define")
    expect(appendix).toContain("memory_write")
    expect(appendix).toContain("session_search_context")
    expect(appendix).toContain("session_get_snapshot")
    expect(appendix).toContain("session_list_traces")
    expect(appendix).toContain("session_get_events")
    expect(appendix).toContain("session_get_trace")
    expect(appendix).toContain("aroundEventId")
    expect(appendix).toContain("skills_search")
    expect(appendix).toContain("skills_read")
    expect(appendix).toContain("read, write, edit, glob, grep, bash, and shell_run")
    expect(appendix).toContain("sandbox_describe")
    expect(appendix).toContain("commandPolicy")
  })
})
