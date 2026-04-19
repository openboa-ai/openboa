import { normalizeProviderId } from "../providers/provider-capabilities.js"
import type { CliBackendConfig } from "./cli-backend.js"

export interface CliUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

export interface CliOutput {
  text: string
  sessionId?: string
  usage?: CliUsage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toCliUsage(raw: Record<string, unknown>): CliUsage | undefined {
  const pick = (key: string) =>
    typeof raw[key] === "number" && raw[key] > 0 ? raw[key] : undefined

  const input = pick("input_tokens") ?? pick("inputTokens")
  const output = pick("output_tokens") ?? pick("outputTokens")
  const cacheRead =
    pick("cache_read_input_tokens") ?? pick("cached_input_tokens") ?? pick("cacheRead")
  const cacheWrite = pick("cache_write_input_tokens") ?? pick("cacheWrite")
  const total = pick("total_tokens") ?? pick("total")

  if (!input && !output && !cacheRead && !cacheWrite && !total) {
    return undefined
  }

  return { input, output, cacheRead, cacheWrite, total }
}

function pickCliSessionId(
  parsed: Record<string, unknown>,
  backend: CliBackendConfig,
): string | undefined {
  const fields = backend.sessionIdFields ?? [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
  ]
  for (const field of fields) {
    const value = parsed[field]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function parseClaudeCliJsonlResult(params: {
  providerId: string
  parsed: Record<string, unknown>
  sessionId?: string
  usage?: CliUsage
}): CliOutput | null {
  if (normalizeProviderId(params.providerId) !== "claude-cli") {
    return null
  }

  if (
    typeof params.parsed.type === "string" &&
    params.parsed.type === "result" &&
    typeof params.parsed.result === "string"
  ) {
    return {
      text: params.parsed.result.trim(),
      sessionId: params.sessionId,
      usage: params.usage,
    }
  }

  return null
}

export function parseCliJsonl(
  raw: string,
  backend: CliBackendConfig,
  providerId: string,
): CliOutput | null {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return null
  }

  let sessionId: string | undefined
  let usage: CliUsage | undefined
  const texts: string[] = []

  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed)) {
      continue
    }

    if (!sessionId) {
      sessionId = pickCliSessionId(parsed, backend)
    }
    if (isRecord(parsed.usage)) {
      usage = toCliUsage(parsed.usage) ?? usage
    }

    const claudeResult = parseClaudeCliJsonlResult({
      providerId,
      parsed,
      sessionId,
      usage,
    })
    if (claudeResult) {
      return claudeResult
    }

    const item = isRecord(parsed.item) ? parsed.item : null
    if (item && typeof item.text === "string") {
      texts.push(item.text)
    }
  }

  const text = texts.join("\n").trim()
  if (!text) {
    return null
  }

  return { text, sessionId, usage }
}

export function parseCliOutput(params: {
  raw: string
  backend: CliBackendConfig
  providerId: string
  outputMode?: "json" | "jsonl" | "text"
  fallbackSessionId?: string
}): CliOutput {
  const outputMode = params.outputMode ?? "text"
  if (outputMode === "text") {
    return { text: params.raw.trim(), sessionId: params.fallbackSessionId }
  }

  if (outputMode === "jsonl") {
    return (
      parseCliJsonl(params.raw, params.backend, params.providerId) ?? {
        text: params.raw.trim(),
        sessionId: params.fallbackSessionId,
      }
    )
  }

  return { text: params.raw.trim(), sessionId: params.fallbackSessionId }
}
