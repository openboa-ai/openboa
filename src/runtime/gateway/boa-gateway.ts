import type { BoaRuntime } from "../boa-runtime.js"
import type { TurnEnvelope } from "../protocol.js"

export class BoaGateway {
  constructor(private readonly runtime: BoaRuntime) {}

  async *handleWebSocketMessage(rawPayload: string): AsyncGenerator<string> {
    const envelope = parseTurnEnvelope(rawPayload)
    validateTurnEnvelope(envelope)

    for await (const event of this.runtime.runTurn(envelope)) {
      yield JSON.stringify(event)
    }
  }
}

function parseTurnEnvelope(rawPayload: string): TurnEnvelope {
  try {
    return JSON.parse(rawPayload) as TurnEnvelope
  } catch {
    throw new Error("invalid turn envelope")
  }
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function validateTurnEnvelope(envelope: TurnEnvelope): void {
  if (envelope.protocol !== "boa.turn.v1") {
    throw new Error(`unsupported protocol: ${envelope.protocol}`)
  }

  if (
    !hasText(envelope.chatId) ||
    !hasText(envelope.sessionId) ||
    !hasText(envelope.agentId) ||
    !hasText(envelope.message) ||
    !hasText(envelope.sender?.id) ||
    !hasText(envelope.recipient?.id)
  ) {
    throw new Error("invalid turn envelope")
  }

  if (!isParticipantKind(envelope.sender.kind) || !isParticipantKind(envelope.recipient.kind)) {
    throw new Error("invalid turn envelope")
  }
}

function isParticipantKind(value: string): value is "human" | "agent" {
  return value === "human" || value === "agent"
}
