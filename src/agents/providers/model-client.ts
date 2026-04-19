import type { AuthMode } from "../auth/codex-auth.js"
import type { BuiltContext } from "../context/model.js"
import type { AgentRuntimeToolDefinition } from "../tools/runtime-tool.js"

export interface ProviderModelCallInput {
  apiKey: string
  authMode?: AuthMode
  systemPrompt: string
  context: BuiltContext
  message: string
  tools?: AgentRuntimeToolDefinition[]
  signal?: AbortSignal
}

export interface ProviderModelClient {
  complete(input: ProviderModelCallInput): Promise<string>
}
