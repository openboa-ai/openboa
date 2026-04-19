import type { AgentProviderId } from "../providers/provider-capabilities.js"

export type AuthTarget = "codex" | "claude-cli"

function providerToAuthTarget(defaultProvider: AgentProviderId): AuthTarget {
  return defaultProvider === "claude-cli" ? "claude-cli" : "codex"
}

function dedupePreservingOrder(targets: AuthTarget[]): AuthTarget[] {
  const seen = new Set<AuthTarget>()
  const ordered: AuthTarget[] = []
  for (const target of targets) {
    if (seen.has(target)) {
      continue
    }
    seen.add(target)
    ordered.push(target)
  }
  return ordered
}

export function resolveAuthTargets(
  rawSelection: string | undefined,
  defaultProvider: AgentProviderId,
): AuthTarget[] {
  const normalized = rawSelection?.trim().toLowerCase()
  const defaultTarget = providerToAuthTarget(defaultProvider)

  if (!normalized || normalized === "default") {
    return [defaultTarget]
  }

  if (normalized === "none") {
    return []
  }

  if (normalized === "both") {
    return dedupePreservingOrder([
      defaultTarget,
      defaultTarget === "codex" ? "claude-cli" : "codex",
    ])
  }

  if (normalized === "codex" || normalized === "openai-codex" || normalized === "openai_codex") {
    return ["codex"]
  }

  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude-cli") {
    return ["claude-cli"]
  }

  throw new Error(
    `unsupported auth selection: ${rawSelection} (expected one of: default, none, both, codex, openai-codex, claude-cli)`,
  )
}
