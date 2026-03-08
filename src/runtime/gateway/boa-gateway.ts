import type { BoaRuntime } from "../boa-runtime.js"
import type { TurnEnvelope } from "../protocol.js"

export class BoaGateway {
  constructor(private readonly runtime: BoaRuntime) {}

  async *handleWebSocketMessage(rawPayload: string): AsyncGenerator<string> {
    const envelope = JSON.parse(rawPayload) as TurnEnvelope
    validateTurnEnvelope(envelope)

    for await (const event of this.runtime.runTurn(envelope)) {
      yield JSON.stringify(event)
    }
  }
}

function validateTurnEnvelope(envelope: TurnEnvelope): void {
  if (envelope.protocol !== "boa.turn.v1") {
    throw new Error(`unsupported protocol: ${envelope.protocol}`)
  }

  if (!envelope.chatId || !envelope.sessionId || !envelope.agentId || !envelope.message) {
    throw new Error("invalid turn envelope")
  }
}
