import type { CodexAuth } from "../auth/codex-auth.js"
import type { BuiltContext } from "../context-builder.js"
import { CodexModelClient } from "./codex-model-client.js"

export interface PiTurnInput {
  agentId: string
  message: string
  systemPrompt: string
  context: BuiltContext
  auth: CodexAuth
}

export class PiRuntimeAdapter {
  constructor(private readonly modelClient: CodexModelClient = new CodexModelClient()) {}

  async generateResponse(input: PiTurnInput): Promise<string> {
    if (input.auth.mode === "codex-env" && input.auth.token) {
      return this.modelClient.complete({
        apiKey: input.auth.token,
        systemPrompt: input.systemPrompt,
        context: input.context,
        message: input.message,
      })
    }

    return this.buildFallbackResponse(input)
  }

  private buildFallbackResponse(input: PiTurnInput): string {
    const modeTag = input.auth.mode === "none" ? "offline" : "codex-auth"
    const hasSystemPrompt = input.systemPrompt.length > 0 ? "yes" : "no"
    return [
      `[pi:${input.agentId}] (${modeTag})`,
      `system-prompt:${hasSystemPrompt}`,
      `history:${input.context.selectedHistory.length}`,
      `answer:${input.message}`,
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
