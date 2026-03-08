import { createMinimalPiRuntime } from "./factory.js"
import type { TurnEnvelope, TurnFinalEvent } from "./protocol.js"

export interface ChatTurnInput {
  workspaceDir: string
  agentId: string
  chatId: string
  sessionId: string
  senderId: string
  message: string
}

export interface ChatTurnResult {
  chunks: string[]
  final: TurnFinalEvent
}

function isTurnFinalEvent(value: unknown): value is TurnFinalEvent {
  if (typeof value !== "object" || value === null) {
    return false
  }

  return (
    "kind" in value &&
    value.kind === "turn.final" &&
    "response" in value &&
    typeof value.response === "string"
  )
}

function isTurnChunkEvent(value: unknown): value is { kind: "turn.chunk"; delta: string } {
  if (typeof value !== "object" || value === null) {
    return false
  }

  return "kind" in value && value.kind === "turn.chunk" && "delta" in value
}

export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const { gateway } = createMinimalPiRuntime(input.workspaceDir)

  const envelope: TurnEnvelope = {
    protocol: "boa.turn.v1",
    chatId: input.chatId,
    sessionId: input.sessionId,
    agentId: input.agentId,
    sender: { kind: "human", id: input.senderId },
    recipient: { kind: "agent", id: input.agentId },
    message: input.message,
  }

  const chunks: string[] = []
  let final: TurnFinalEvent | null = null

  for await (const frame of gateway.handleWebSocketMessage(JSON.stringify(envelope))) {
    const event = JSON.parse(frame) as unknown
    if (isTurnChunkEvent(event)) {
      chunks.push(String(event.delta ?? ""))
      continue
    }

    if (isTurnFinalEvent(event)) {
      final = event
    }
  }

  if (!final) {
    throw new Error("turn.final was not emitted")
  }

  return { chunks, final }
}
