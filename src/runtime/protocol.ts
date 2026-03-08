export type ParticipantKind = "human" | "agent"

export interface ParticipantRef {
  kind: ParticipantKind
  id: string
}

export interface TurnEnvelope {
  protocol: "boa.turn.v1"
  chatId: string
  sessionId: string
  agentId: string
  sender: ParticipantRef
  recipient: ParticipantRef
  message: string
  timestamp?: string
}

export interface TurnChunkEvent {
  kind: "turn.chunk"
  chatId: string
  sessionId: string
  agentId: string
  delta: string
}

export interface TurnFinalEvent {
  kind: "turn.final"
  chatId: string
  sessionId: string
  agentId: string
  response: string
  checkpointId: string
  recoveredFromCheckpoint: boolean
  recoveredCheckpointId: string | null
  authMode: "none" | "codex-env" | "codex-file"
}

export type TurnEvent = TurnChunkEvent | TurnFinalEvent

export function nowIsoString(): string {
  return new Date().toISOString()
}
