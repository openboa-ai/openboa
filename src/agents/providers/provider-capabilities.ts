export type AgentProviderId = "openai-codex" | "claude-cli"

export type AgentRunnerKind = "embedded" | "cli"

export interface ProviderCapabilities {
  id: AgentProviderId
  aliases: string[]
  providerFamily: "openai" | "anthropic"
  runner: AgentRunnerKind
  defaultModel: string
  supportsCliSessionBinding: boolean
  authMode: "codex" | "none"
}

const PROVIDER_CAPABILITIES: Record<AgentProviderId, ProviderCapabilities> = {
  "openai-codex": {
    id: "openai-codex",
    aliases: ["codex", "openai-codex", "openai_codex"],
    providerFamily: "openai",
    runner: "embedded",
    defaultModel: "gpt-5.4",
    supportsCliSessionBinding: false,
    authMode: "codex",
  },
  "claude-cli": {
    id: "claude-cli",
    aliases: ["claude", "claude-cli", "claude_code", "claude-code"],
    providerFamily: "anthropic",
    runner: "cli",
    defaultModel: "opus",
    supportsCliSessionBinding: true,
    authMode: "none",
  },
}

export function normalizeProviderId(provider: string | undefined | null): AgentProviderId {
  const normalized = provider?.trim().toLowerCase() ?? ""
  for (const capabilities of Object.values(PROVIDER_CAPABILITIES)) {
    if (capabilities.id === normalized || capabilities.aliases.includes(normalized)) {
      return capabilities.id
    }
  }

  throw new Error(`unsupported provider: ${String(provider)}`)
}

export function resolveProviderCapabilities(
  provider: string | undefined | null,
): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[normalizeProviderId(provider)]
}

export function isCliProvider(provider: string | undefined | null): boolean {
  return resolveProviderCapabilities(provider).runner === "cli"
}
