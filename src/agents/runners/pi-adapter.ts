import type { CodexAuth } from "../auth/codex-auth.js"
import type { BuiltContext } from "../context/model.js"
import { CodexModelClient } from "../providers/codex-model-client.js"
import type { ProviderModelClient } from "../providers/model-client.js"
import type { AgentRuntimeToolDefinition } from "../tools/runtime-tool.js"

export interface PiTurnInput {
  agentId: string
  message: string
  systemPrompt: string
  context: BuiltContext
  auth: CodexAuth
  tools?: AgentRuntimeToolDefinition[]
  signal?: AbortSignal
}

export class PiRuntimeAdapter {
  constructor(private readonly modelClient: ProviderModelClient = new CodexModelClient()) {}

  async generateResponse(input: PiTurnInput): Promise<string> {
    if (input.auth.mode !== "none" && input.auth.token) {
      return this.modelClient.complete({
        apiKey: input.auth.token,
        authMode: input.auth.mode,
        systemPrompt: input.systemPrompt,
        context: input.context,
        message: input.message,
        tools: input.tools,
        signal: input.signal,
      })
    }

    return this.buildFallbackResponse(input)
  }

  private buildFallbackResponse(input: PiTurnInput): string {
    const modeTag = input.auth.mode === "none" ? "offline" : "codex-auth"
    const hasSystemPrompt = input.systemPrompt.length > 0 ? "yes" : "no"
    const lastConversationRecord = input.context.conversationHistory.at(-1)
    const fallbackAnswer =
      input.message
        .match(/Trigger message from @[^\n]+:\n([\s\S]*?)\n\nLatest message from/iu)?.[1]
        ?.trim() ||
      lastConversationRecord?.message?.trim() ||
      input.context.selectedHistory.at(-1)?.message?.trim() ||
      input.message
    return [
      `[pi:${input.agentId}] (${modeTag})`,
      `system-prompt:${hasSystemPrompt}`,
      `history:${input.context.selectedHistory.length}`,
      `answer:${fallbackAnswer}`,
    ].join(" ")
  }

  async *streamResponse(text: string): AsyncGenerator<string> {
    const parts = text.split(" ")
    for (const [index, part] of parts.entries()) {
      const suffix = index === parts.length - 1 ? "" : " "
      yield `${part}${suffix}`
    }
  }
}
