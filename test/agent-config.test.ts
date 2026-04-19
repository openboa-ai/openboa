import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadAgentConfig, resolveWakeLeasePolicy } from "../src/agents/agent-config.js"
import { ensureAgentConfig } from "../src/agents/setup.js"
import { createCompanyFixture } from "./helpers.js"

describe("agent config", () => {
  it("loads runtime wake-lease overrides from agent config", async () => {
    const companyDir = await createCompanyFixture()
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>
    config.runtime = {
      kind: "embedded",
      provider: "openai-codex",
      wakeLease: {
        staleAfterSeconds: 42,
        heartbeatSeconds: 7,
      },
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

    const loaded = await loadAgentConfig(companyDir, "alpha")
    expect(loaded.runtime.wakeLease).toEqual({
      staleAfterSeconds: 42,
      heartbeatSeconds: 7,
    })
    expect(resolveWakeLeasePolicy(loaded.runtime)).toEqual({
      staleAfterMs: 42_000,
      heartbeatMs: 7_000,
    })
  })

  it("loads resilience overrides from agent config", async () => {
    const companyDir = await createCompanyFixture()
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>
    config.resilience = {
      profile: "resilient",
      retry: {
        recoverableWakeRetryDelayMs: 9000,
        wakeFailureReplayDelayMs: 4000,
        pendingEventBackoffBaseMs: 3000,
        pendingEventBackoffMaxMs: 120000,
      },
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

    const loaded = await loadAgentConfig(companyDir, "alpha")
    expect(loaded.resilience).toEqual({
      profile: "resilient",
      retry: {
        recoverableWakeRetryDelayMs: 9000,
        wakeFailureReplayDelayMs: 4000,
        pendingEventBackoffBaseMs: 3000,
        pendingEventBackoffMaxMs: 120000,
      },
    })
  })
})
