import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const DEFAULT_AGENT_CONFIG = {
  runtime: "pi",
  auth: {
    provider: "codex",
    required: true,
  },
} as const

export interface SetupResult {
  created: boolean
  configPath: string
}

export async function ensureCodexPiAgentConfig(
  workspaceDir: string,
  agentId = "pi-agent",
): Promise<SetupResult> {
  const configPath = join(workspaceDir, ".openboa", "agents", agentId, "agent.json")

  try {
    await readFile(configPath, "utf8")
    return { created: false, configPath }
  } catch {
    await mkdir(join(workspaceDir, ".openboa", "agents", agentId), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(DEFAULT_AGENT_CONFIG, null, 2)}\n`, "utf8")
    return { created: true, configPath }
  }
}
