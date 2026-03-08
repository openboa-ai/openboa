import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface AgentAuthConfig {
  provider: "codex"
  required: boolean
}

export interface AgentConfig {
  runtime: "pi"
  auth: AgentAuthConfig
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  runtime: "pi",
  auth: {
    provider: "codex",
    required: false,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export async function loadAgentConfig(workspaceDir: string, agentId: string): Promise<AgentConfig> {
  const agentConfigPath = join(workspaceDir, ".openboa", "agents", agentId, "agent.json")
  let parsed: unknown

  try {
    const raw = await readFile(agentConfigPath, "utf8")
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_AGENT_CONFIG
  }

  if (!isRecord(parsed)) {
    throw new Error(`invalid agent config: ${agentConfigPath}`)
  }

  const runtimeValue = parsed.runtime
  if (runtimeValue !== undefined && runtimeValue !== "pi") {
    throw new Error(`unsupported agent runtime: ${String(runtimeValue)}`)
  }

  const authValue = parsed.auth
  if (authValue === undefined) {
    return DEFAULT_AGENT_CONFIG
  }

  if (!isRecord(authValue)) {
    throw new Error(`invalid agent auth config: ${agentConfigPath}`)
  }

  const provider = authValue.provider
  if (provider !== undefined && provider !== "codex") {
    throw new Error(`unsupported auth provider: ${String(provider)}`)
  }

  const required = authValue.required
  if (required !== undefined && typeof required !== "boolean") {
    throw new Error(`invalid auth.required value: ${String(required)}`)
  }

  return {
    runtime: "pi",
    auth: {
      provider: "codex",
      required: required ?? DEFAULT_AGENT_CONFIG.auth.required,
    },
  }
}
