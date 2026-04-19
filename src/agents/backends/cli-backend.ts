import type { AgentProviderId } from "../providers/provider-capabilities.js"
import { normalizeProviderId } from "../providers/provider-capabilities.js"

export interface CliBackendConfig {
  command: string
  args?: string[]
  resumeArgs?: string[]
  output?: "json" | "jsonl" | "text"
  modelArg?: string
  modelAliases?: Record<string, string>
  sessionArg?: string
  sessionMode?: "always" | "resume-only"
  sessionIdFields?: string[]
  systemPromptArg?: string
  systemPromptMode?: "append" | "replace"
  systemPromptWhen?: "always" | "first"
  clearEnv?: string[]
  serialize?: boolean
}

const CLAUDE_CLI_MODEL_ALIASES: Record<string, string> = {
  opus: "opus",
  "opus-4.6": "opus",
  "opus-4.5": "opus",
  "claude-opus-4-6": "opus",
  "claude-opus-4-5": "opus",
  sonnet: "sonnet",
  "sonnet-4.6": "sonnet",
  "sonnet-4.5": "sonnet",
  "claude-sonnet-4-6": "sonnet",
  "claude-sonnet-4-5": "sonnet",
  haiku: "haiku",
  "haiku-3.5": "haiku",
  "claude-haiku-3-5": "haiku",
}

const CLAUDE_CLI_SESSION_ID_FIELDS = [
  "session_id",
  "sessionId",
  "conversation_id",
  "conversationId",
] as const

const CLAUDE_CLI_CLEAR_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_OLD"] as const

const CLI_BACKENDS: Record<AgentProviderId, CliBackendConfig> = {
  "openai-codex": {
    command: "",
    serialize: false,
  },
  "claude-cli": {
    command: "claude",
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
    ],
    resumeArgs: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--resume",
      "{sessionId}",
    ],
    output: "jsonl",
    modelArg: "--model",
    modelAliases: CLAUDE_CLI_MODEL_ALIASES,
    sessionArg: "--session-id",
    sessionMode: "always",
    sessionIdFields: [...CLAUDE_CLI_SESSION_ID_FIELDS],
    systemPromptArg: "--append-system-prompt",
    systemPromptMode: "append",
    systemPromptWhen: "first",
    clearEnv: [...CLAUDE_CLI_CLEAR_ENV],
    serialize: true,
  },
}

export function resolveCliBackendConfig(
  provider: string | undefined | null,
  override?: Partial<CliBackendConfig>,
): CliBackendConfig | null {
  const normalized = normalizeProviderId(provider)
  const base = CLI_BACKENDS[normalized]
  if (!base?.command.trim()) {
    return null
  }

  return {
    ...base,
    ...override,
    args: override?.args ?? base.args,
    resumeArgs: override?.resumeArgs ?? base.resumeArgs,
    modelAliases: { ...(base.modelAliases ?? {}), ...(override?.modelAliases ?? {}) },
    sessionIdFields: override?.sessionIdFields ?? base.sessionIdFields,
    clearEnv: Array.from(new Set([...(base.clearEnv ?? []), ...(override?.clearEnv ?? [])])),
  }
}

export function normalizeCliBackendModel(model: string, backend: CliBackendConfig): string {
  const trimmed = model.trim()
  if (!trimmed) {
    return trimmed
  }

  const normalized = trimmed.toLowerCase()
  return backend.modelAliases?.[normalized] ?? trimmed
}
