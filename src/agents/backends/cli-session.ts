import { createHash } from "node:crypto"

import { normalizeProviderId } from "../providers/provider-capabilities.js"

export interface CliSessionBinding {
  sessionId: string
  systemPromptHash?: string
}

export interface CliSessionBindingRecord {
  cliSessionBindings?: Record<string, CliSessionBinding>
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function hashCliSessionText(value: string | undefined): string | undefined {
  const trimmed = trimOptional(value)
  if (!trimmed) {
    return undefined
  }
  return createHash("sha256").update(trimmed).digest("hex")
}

export function getCliSessionBinding(
  entry: CliSessionBindingRecord | undefined,
  provider: string,
): CliSessionBinding | undefined {
  if (!entry?.cliSessionBindings) {
    return undefined
  }
  const binding = entry.cliSessionBindings[normalizeProviderId(provider)]
  if (!binding?.sessionId?.trim()) {
    return undefined
  }
  return {
    sessionId: binding.sessionId.trim(),
    ...(trimOptional(binding.systemPromptHash)
      ? { systemPromptHash: trimOptional(binding.systemPromptHash) }
      : {}),
  }
}

export function setCliSessionBinding(
  entry: CliSessionBindingRecord,
  provider: string,
  binding: CliSessionBinding,
): void {
  const normalized = normalizeProviderId(provider)
  const sessionId = binding.sessionId.trim()
  if (!sessionId) {
    return
  }

  entry.cliSessionBindings = {
    ...(entry.cliSessionBindings ?? {}),
    [normalized]: {
      sessionId,
      ...(trimOptional(binding.systemPromptHash)
        ? { systemPromptHash: trimOptional(binding.systemPromptHash) }
        : {}),
    },
  }
}

export function resolveCliSessionReuse(params: {
  binding?: CliSessionBinding
  systemPromptHash?: string
}): { sessionId?: string; invalidatedReason?: "system-prompt" } {
  const binding = params.binding
  const sessionId = trimOptional(binding?.sessionId)
  if (!sessionId) {
    return {}
  }
  const currentHash = trimOptional(params.systemPromptHash)
  if (binding?.systemPromptHash && trimOptional(binding.systemPromptHash) !== currentHash) {
    return { invalidatedReason: "system-prompt" }
  }
  return { sessionId }
}
