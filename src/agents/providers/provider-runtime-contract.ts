import type { AgentRuntimeToolDefinition } from "../tools/runtime-tool.js"
import { AgentRuntimeInterruptError } from "../tools/runtime-tool.js"

export interface ProviderErrorFactory<TError extends Error> {
  isProviderError(error: unknown): error is TError
  timeoutError(): TError
  invalidResponseError(message: string): TError
}

export function rethrowAgentRuntimeInterrupt(error: unknown): void {
  if (error instanceof AgentRuntimeInterruptError) {
    throw error
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }
  const code = (error as { code?: unknown }).code
  return code === "model_timeout" || code === "model_http_error"
}

export function throwNormalizedProviderError<TError extends Error>(input: {
  error: unknown
  factory: ProviderErrorFactory<TError>
  invalidResponseMessage: string
}): never {
  rethrowAgentRuntimeInterrupt(input.error)
  if (input.factory.isProviderError(input.error)) {
    throw input.error
  }
  if (isAbortErrorLike(input.error)) {
    throw input.factory.timeoutError()
  }
  throw input.factory.invalidResponseError(input.invalidResponseMessage)
}

export async function executeProviderToolCall(input: {
  tool: AgentRuntimeToolDefinition | null | undefined
  toolName: string
  args: unknown
}): Promise<string> {
  if (!input.tool) {
    return JSON.stringify({ error: `Unknown tool: ${input.toolName}` })
  }

  try {
    return await input.tool.execute(input.args)
  } catch (error) {
    rethrowAgentRuntimeInterrupt(error)
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function isAbortErrorLike(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError"
}
