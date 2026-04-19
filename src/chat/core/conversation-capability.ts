import type {
  ChatMessage,
  ChatMessageKind,
  ChatParticipantRef,
  ConversationRevision,
} from "./model.js"

export interface ConversationScope {
  conversationId: string
  threadId: string | null
}

export interface ConversationObservation {
  scope: ConversationScope
  revision: ConversationRevision
  latestMessageId: string | null
  roomParticipantIds: string[]
  visibleParticipantIds: string[]
  attachedParticipantIds: string[]
  messages: ChatMessage[]
  triggerMessage: ChatMessage | null
}

export interface ConversationMessageListInput {
  limit?: number
  beforeMessageId?: string | null
  authorId?: string | null
  messageKind?: ChatMessageKind | "all"
}

export interface ConversationMessageSearchInput {
  query: string
  limit?: number
  authorId?: string | null
  messageKind?: ChatMessageKind | "all"
}

export interface ConversationMessageSearchResult {
  message: ChatMessage
  score: number
}

export interface ContributionAttempt {
  scope: ConversationScope
  sessionId: string
  idempotencyKey?: string | null
  basedOnRevision: ConversationRevision
  basedOnMessageId?: string | null
  author: ChatParticipantRef
  audience?: ChatParticipantRef | null
  body: string
  createdAt: string
  mentionedIds?: string[]
  relatedMessageId?: string | null
}

export interface DeferredContribution {
  status: "deferred"
  revision: ConversationRevision
  reason: string | null
}

export interface AcceptedContribution {
  status: "accepted"
  revision: ConversationRevision
  message: ChatMessage
}

export interface StaleContribution {
  status: "stale"
  revision: ConversationRevision
  latestMessageId: string | null
}

export type ContributionResult = AcceptedContribution | StaleContribution

export interface ConversationCapabilityClient {
  observeConversation: (
    scope: ConversationScope,
    triggerMessage?: ChatMessage | null,
  ) => Promise<ConversationObservation>
  listConversationMessages: (
    scope: ConversationScope,
    input?: ConversationMessageListInput,
  ) => Promise<ChatMessage[]>
  searchConversationMessages: (
    scope: ConversationScope,
    input: ConversationMessageSearchInput,
  ) => Promise<ConversationMessageSearchResult[]>
  contributeToConversation: (attempt: ContributionAttempt) => Promise<ContributionResult>
  deferConversation: (input: {
    scope: ConversationScope
    basedOnRevision: number
    participantId: string
    reason?: string | null
  }) => Promise<DeferredContribution>
}
