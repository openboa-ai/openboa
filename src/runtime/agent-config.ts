import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type CodexAuthMethod = "oauth-browser" | "api-key"

export interface AgentAuthConfig {
  provider: "codex"
  required: boolean
  method: CodexAuthMethod
}

export interface AgentUiConfig {
  mode: "tui"
}

export interface AgentConfig {
  runtime: "pi"
  auth: AgentAuthConfig
  ui: AgentUiConfig
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  runtime: "pi",
  auth: {
    provider: "codex",
    required: false,
    method: "oauth-browser",
  },
  ui: {
    mode: "tui",
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
  if (authValue !== undefined && !isRecord(authValue)) {
    throw new Error(`invalid agent auth config: ${agentConfigPath}`)
  }

  const provider = isRecord(authValue) ? authValue.provider : undefined
  if (provider !== undefined && provider !== "codex") {
    throw new Error(`unsupported auth provider: ${String(provider)}`)
  }

  const required = isRecord(authValue) ? authValue.required : undefined
  if (required !== undefined && typeof required !== "boolean") {
    throw new Error(`invalid auth.required value: ${String(required)}`)
  }

  const method = isRecord(authValue) ? authValue.method : undefined
  if (method !== undefined && method !== "oauth-browser" && method !== "api-key") {
    throw new Error(`unsupported auth method: ${String(method)}`)
  }

  const uiValue = parsed.ui
  if (uiValue !== undefined && !isRecord(uiValue)) {
    throw new Error(`invalid agent ui config: ${agentConfigPath}`)
  }

  const uiMode = isRecord(uiValue) ? uiValue.mode : undefined
  if (uiMode !== undefined && uiMode !== "tui") {
    throw new Error(`unsupported ui mode: ${String(uiMode)}`)
  }

  return {
    runtime: "pi",
    auth: {
      provider: "codex",
      required: required ?? DEFAULT_AGENT_CONFIG.auth.required,
      method: method ?? DEFAULT_AGENT_CONFIG.auth.method,
    },
    ui: {
      mode: "tui",
    },
  }
}
