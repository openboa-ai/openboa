import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodexAuthProvider } from "../src/agents/auth/codex-auth.js"
import { AgentTurnRunner } from "../src/agents/runners/agent-runner.js"
import { runAgentScenarioSoak } from "../src/agents/runtime/scenario-soak.js"
import { createCompanyFixture } from "./helpers.js"

describe("runAgentScenarioSoak", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("runs a bounded multi-worker soak and writes markdown/json reports", async () => {
    const companyDir = await createCompanyFixture()

    vi.spyOn(CodexAuthProvider.prototype, "resolve").mockResolvedValue({
      mode: "codex-oauth",
      token: "test-token",
    })

    vi.spyOn(AgentTurnRunner.prototype, "run").mockResolvedValue({
      response:
        'Soak complete.\n<openboa-session-loop>{"outcome":"sleep","summary":"Handled the soak session.","followUpSeconds":null}</openboa-session-loop>',
      authMode: "oauth",
      provider: "openai-codex",
      model: "gpt-5.4",
      runner: "embedded",
    })

    const result = await runAgentScenarioSoak(companyDir, {
      agentId: "soak-agent",
      workers: 2,
      sessions: 3,
      delayedSessions: 2,
      outputPath: "AGENT_SCENARIO_SOAK.md",
      pollIntervalMs: 25,
      idleTimeoutMs: 1200,
    })

    expect(result.agentId).toBe("soak-agent")
    expect(result.workers).toBe(2)
    expect(result.sessions).toBe(3)
    expect(result.delayedSessions).toBe(2)
    expect(result.immediatePassed).toBe(3)
    expect(result.delayedPassed).toBe(2)
    expect(result.failed).toBe(0)

    const markdown = await readFile(join(companyDir, "AGENT_SCENARIO_SOAK.md"), "utf8")
    expect(markdown).toContain("# Agent Scenario Soak")
    expect(markdown).toContain("Immediate Passed: 3")
    expect(markdown).toContain("Delayed Passed: 2")

    const json = JSON.parse(
      await readFile(join(companyDir, "AGENT_SCENARIO_SOAK.md.json"), "utf8"),
    ) as Record<string, unknown>
    expect(json.agentId).toBe("soak-agent")
    expect(json.workers).toBe(2)
    expect(json.sessions).toBe(3)
    expect(json.delayedSessions).toBe(2)
    const sessionSummaries = json.sessionSummaries as Array<Record<string, unknown>>
    expect(
      sessionSummaries.filter((summary) => Number(summary.delayedAckCount ?? 0) >= 1),
    ).toHaveLength(2)
  })
})
