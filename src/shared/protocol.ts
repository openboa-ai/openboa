export type ParticipantKind = "participant" | "room" | "system"

export interface ParticipantRef {
  kind: ParticipantKind
  id: string
}

export interface TranscriptRecord {
  companyId?: string
  conversationId: string
  threadId?: string | null
  sessionId: string
  sender: ParticipantRef
  recipient: ParticipantRef
  speakerRole?: "user" | "assistant" | "system"
  message: string
  timestamp: string
}
