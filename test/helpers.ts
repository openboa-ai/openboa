import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ensureAgentConfig, ensureOpenboaSetupWithOptions } from "../src/agents/setup.js"

export async function createCompanyFixture(): Promise<string> {
  const fixtureRoot = join(homedir(), ".openboa-test-fixtures")
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  const companyDir = await mkdtemp(join(fixtureRoot, "openboa-company-"))
  await ensureOpenboaSetupWithOptions(companyDir, {
    defaultProvider: "openai-codex",
    authProviders: ["codex"],
  })
  return companyDir
}

export async function createChatFixture(): Promise<string> {
  return createCompanyFixture()
}

export async function createOfflineCodexAgent(companyDir: string, agentId: string): Promise<void> {
  await ensureAgentConfig(companyDir, {
    agentId,
    provider: "openai-codex",
  })
  const configPath = join(companyDir, ".openboa", "agents", agentId, "agent.json")
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>
  const auth = (config.auth ?? {}) as Record<string, unknown>
  auth.required = false
  config.auth = auth
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

export async function createAgentSkillFixture(params: {
  companyDir: string
  name: string
  description: string
  body: string
}): Promise<void> {
  const skillDir = join(params.companyDir, ".openboa", "skills", params.name)
  await mkdir(skillDir, { recursive: true })
  const content = [
    "---",
    `name: ${params.name}`,
    `description: ${params.description}`,
    "---",
    "",
    params.body.trim(),
    "",
  ].join("\n")
  await writeFile(join(skillDir, "SKILL.md"), content, "utf8")
}
