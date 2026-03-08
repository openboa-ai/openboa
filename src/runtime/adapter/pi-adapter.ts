import type { CodexAuth } from "../auth/codex-auth.js"
import type { BuiltContext } from "../context-builder.js"

export interface PiTurnInput {
  agentId: string
  message: string
  systemPrompt: string
  context: BuiltContext
  auth: CodexAuth
}

export class PiRuntimeAdapter {
  buildResponse(input: PiTurnInput): string {
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
