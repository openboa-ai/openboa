import { nowIsoString } from "../../foundation/time.js"
import type {
  AcceptedContribution,
  ContributionAttempt,
  ConversationCapabilityClient,
  ConversationMessageListInput,
  ConversationMessageSearchInput,
  ConversationMessageSearchResult,
  ConversationObservation,
  ConversationScope,
  DeferredContribution,
  StaleContribution,
} from "./conversation-capability.js"
import type { SharedChatLedger } from "./ledger.js"
import type {
  ChatConversationAttachmentRecord,
  ChatMessage,
  ChatMessageKind,
  ChatParticipantRef,
  ChatSystemEventKind,
} from "./model.js"

function scopeKey(scope: ConversationScope): string {
  return `${scope.conversationId}::${scope.threadId ?? "root"}`
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeSearchQuery(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function matchesAuthor(message: ChatMessage, authorId?: string | null): boolean {
  return !authorId || message.author.id === authorId
}

function matchesMessageKind(message: ChatMessage, messageKind?: ChatMessageKind | "all"): boolean {
  return !messageKind || messageKind === "all" || message.messageKind === messageKind
}

function scoreSearchResult(message: ChatMessage, terms: string[]): number {
  const haystacks = [
    message.body.toLowerCase(),
    message.author.id.toLowerCase(),
    ...message.mentionedIds.map((mentionedId) => mentionedId.toLowerCase()),
  ]
  let score = 0
  for (const term of terms) {
    if (haystacks.some((haystack) => haystack.includes(term))) {
      score += 1
    }
  }
  return score
}

function activeAttachmentIds(records: ChatConversationAttachmentRecord[]): string[] {
  return unique(records.filter((record) => record.attached).map((record) => record.participantId))
}

function latestScopeRevision(messages: ChatMessage[]): number {
  return messages.reduce((maxRevision, message) => Math.max(maxRevision, message.revision), 0)
}

export class ConversationService implements ConversationCapabilityClient {
  private readonly scopeLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly scopeId: string,
    private readonly ledger: SharedChatLedger,
  ) {}

  async observeConversation(
    scope: ConversationScope,
    triggerMessage: ChatMessage | null = null,
  ): Promise<ConversationObservation> {
    const [scopedMessages, conversation, rootAttachments, scopedAttachments] = await Promise.all([
      this.ledger.listScopeMessages(this.scopeId, scope),
      this.ledger.getConversationById(scope.conversationId, this.scopeId),
      this.ledger.listConversationAttachments(this.scopeId, {
        conversationId: scope.conversationId,
        threadId: null,
      }),
      this.ledger.listConversationAttachments(this.scopeId, scope),
    ])
    const latestScopedReply =
      scope.threadId != null
        ? (scopedMessages.filter((message) => message.threadId === scope.threadId).at(-1) ?? null)
        : (scopedMessages.at(-1) ?? null)
    const latestMessage =
      latestScopedReply ?? (scope.threadId ? (scopedMessages.at(0) ?? null) : null)
    const attachedParticipantIds = unique([
      ...activeAttachmentIds(rootAttachments),
      ...activeAttachmentIds(scopedAttachments),
    ])
    const roomParticipantIds = unique(conversation?.participantIds ?? [])
    const visibleParticipantIds = unique([
      ...(conversation?.participantIds ?? []),
      ...attachedParticipantIds,
    ])

    return {
      scope,
      revision: latestScopeRevision(scopedMessages),
      latestMessageId: latestMessage?.messageId ?? null,
      roomParticipantIds,
      visibleParticipantIds,
      attachedParticipantIds,
      messages: scopedMessages,
      triggerMessage,
    }
  }

  async listConversationMessages(
    scope: ConversationScope,
    input: ConversationMessageListInput = {},
  ): Promise<ChatMessage[]> {
    const scopedMessages = (await this.ledger.listScopeMessages(this.scopeId, scope)).filter(
      (message) =>
        matchesAuthor(message, input.authorId) && matchesMessageKind(message, input.messageKind),
    )
    const beforeIndex =
      input.beforeMessageId != null
        ? scopedMessages.findIndex((message) => message.messageId === input.beforeMessageId)
        : -1
    const boundedMessages = beforeIndex >= 0 ? scopedMessages.slice(0, beforeIndex) : scopedMessages
    const limit = Math.max(1, input.limit ?? 20)
    return boundedMessages.slice(-limit)
  }

  async searchConversationMessages(
    scope: ConversationScope,
    input: ConversationMessageSearchInput,
  ): Promise<ConversationMessageSearchResult[]> {
    const scopedMessages = (await this.ledger.listScopeMessages(this.scopeId, scope)).filter(
      (message) =>
        matchesAuthor(message, input.authorId) && matchesMessageKind(message, input.messageKind),
    )
    const terms = normalizeSearchQuery(input.query)
    if (terms.length === 0) {
      return []
    }
    const limit = Math.max(1, input.limit ?? 10)
    return scopedMessages
      .map((message) => ({
        message,
        score: scoreSearchResult(message, terms),
      }))
      .filter((result) => result.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return left.message.createdAt.localeCompare(right.message.createdAt)
      })
      .slice(0, limit)
  }

  async contributeToConversation(attempt: ContributionAttempt) {
    return this.withScopeLock(attempt.scope, async () => {
      const existingMessage = attempt.idempotencyKey
        ? await this.ledger.findMessageByIdempotencyKey(
            attempt.idempotencyKey,
            this.scopeId,
            attempt.scope.conversationId,
            attempt.scope.threadId,
          )
        : null
      if (existingMessage) {
        const accepted: AcceptedContribution = {
          status: "accepted",
          revision: existingMessage.revision,
          message: existingMessage,
        }
        return accepted
      }

      const observation = await this.observeConversation(attempt.scope)
      if (
        observation.revision !== attempt.basedOnRevision ||
        (attempt.basedOnMessageId !== undefined &&
          attempt.basedOnMessageId !== observation.latestMessageId)
      ) {
        const stale: StaleContribution = {
          status: "stale",
          revision: observation.revision,
          latestMessageId: observation.latestMessageId,
        }
        return stale
      }

      const message = await this.ledger.appendMessage({
        scopeId: this.scopeId,
        conversationId: attempt.scope.conversationId,
        threadId: attempt.scope.threadId,
        sessionId: attempt.sessionId,
        idempotencyKey: attempt.idempotencyKey ?? null,
        author: attempt.author,
        audience: attempt.audience ?? null,
        body: attempt.body,
        createdAt: attempt.createdAt,
        mentionedIds: attempt.mentionedIds,
        relatedMessageId: attempt.relatedMessageId ?? null,
      })

      const accepted: AcceptedContribution = {
        status: "accepted",
        revision: message.revision,
        message,
      }
      return accepted
    })
  }

  async deferConversation(input: {
    scope: ConversationScope
    basedOnRevision: number
    participantId: string
    reason?: string | null
  }): Promise<DeferredContribution> {
    return {
      status: "deferred",
      revision: input.basedOnRevision,
      reason: input.reason ?? null,
    }
  }

  async postSystemMessage(input: {
    scope: ConversationScope
    sessionId: string
    author: ChatParticipantRef
    body: string
    systemEventKind: ChatSystemEventKind
    idempotencyKey?: string | null
    relatedMessageId?: string | null
  }): Promise<ChatMessage> {
    return this.ledger.appendMessage({
      scopeId: this.scopeId,
      conversationId: input.scope.conversationId,
      threadId: input.scope.threadId,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey ?? null,
      author: input.author,
      body: input.body,
      createdAt: nowIsoString(),
      relatedMessageId: input.relatedMessageId ?? null,
      messageKind: "system-event",
      systemEventKind: input.systemEventKind,
    })
  }

  private async withScopeLock<T>(scope: ConversationScope, task: () => Promise<T>): Promise<T> {
    const key = scopeKey(scope)
    const previous = this.scopeLocks.get(key) ?? Promise.resolve()
    let release = () => {}
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    this.scopeLocks.set(
      key,
      previous.then(() => next),
    )

    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.scopeLocks.get(key) === next) {
        this.scopeLocks.delete(key)
      }
    }
  }
}
