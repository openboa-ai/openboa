export type TranscriptParticipantKind = "participant" | "room" | "system"

export interface TranscriptParticipantRef {
  kind: TranscriptParticipantKind
  id: string
}

export interface TranscriptRecord {
  scopeId?: string
  conversationId: string
  threadId?: string | null
  sessionId: string
  sender: TranscriptParticipantRef
  recipient: TranscriptParticipantRef
  speakerRole?: "user" | "assistant" | "system"
  message: string
  timestamp: string
}
