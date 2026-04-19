import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ensureAgentConfig, ensureOpenboaSetupWithOptions } from "../src/agents/setup.js"
import { createCompanyFixture } from "./helpers.js"

describe("setup", () => {
  it("creates agent workspace directories when an agent is spawned", async () => {
    const companyDir = await createCompanyFixture()
    await ensureOpenboaSetupWithOptions(companyDir, {
      defaultProvider: "openai-codex",
      authProviders: ["codex"],
    })
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    await expect(
      access(join(companyDir, ".openboa", "agents", "alpha", "workspace")),
    ).resolves.toBeUndefined()
    await expect(
      access(join(companyDir, ".openboa", "agents", "alpha", "sessions")),
    ).resolves.toBeUndefined()
    await expect(
      access(join(companyDir, ".openboa", "agents", "alpha", "runtime")),
    ).resolves.toBeUndefined()
  })

  it("seeds OpenClaw-like workspace bootstrap files for each agent", async () => {
    const companyDir = await createCompanyFixture()
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    const workspaceDir = join(companyDir, ".openboa", "agents", "alpha", "workspace")
    for (const fileName of [
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
      "IDENTITY.md",
      "USER.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
      "MEMORY.md",
    ]) {
      await expect(access(join(workspaceDir, fileName))).resolves.toBeUndefined()
    }
    await expect(access(join(workspaceDir, "memory"))).resolves.toBeUndefined()
  })

  it("seeds codex agents with workspace sandbox enabled by default", async () => {
    const companyDir = await createCompanyFixture()
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      sandbox?: { mode?: string; workspaceAccess?: string }
    }

    expect(config.sandbox?.mode).toBe("workspace")
    expect(config.sandbox?.workspaceAccess).toBe("rw")
  })

  it("seeds agents with default wake-lease runtime policy", async () => {
    const companyDir = await createCompanyFixture()
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      runtime?: {
        wakeLease?: { staleAfterSeconds?: number; heartbeatSeconds?: number }
      }
    }

    expect(config.runtime?.wakeLease?.staleAfterSeconds).toBe(600)
    expect(config.runtime?.wakeLease?.heartbeatSeconds).toBe(60)
  })

  it("seeds agents with default resilience policy", async () => {
    const companyDir = await createCompanyFixture()
    await ensureAgentConfig(companyDir, { agentId: "alpha", provider: "openai-codex" })

    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      resilience?: {
        profile?: string
        retry?: {
          recoverableWakeRetryDelayMs?: number
          wakeFailureReplayDelayMs?: number
          pendingEventBackoffBaseMs?: number
          pendingEventBackoffMaxMs?: number
        }
      }
    }

    expect(config.resilience?.profile).toBe("resilient")
    expect(config.resilience?.retry?.recoverableWakeRetryDelayMs).toBe(5_000)
    expect(config.resilience?.retry?.wakeFailureReplayDelayMs).toBe(2_000)
    expect(config.resilience?.retry?.pendingEventBackoffBaseMs).toBe(2_000)
    expect(config.resilience?.retry?.pendingEventBackoffMaxMs).toBe(30_000)
  })
})
