import { existsSync, renameSync } from "node:fs"
import { basename, join } from "node:path"
import { makeId, makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"
import type { TranscriptParticipantRef, TranscriptRecord } from "../transcript.js"
import type {
  ChatConversationAttachmentInput,
  ChatConversationAttachmentRecord,
  ChatConversationInput,
  ChatConversationRecord,
  ChatCursorInput,
  ChatCursorRecord,
  ChatGrantBindingInput,
  ChatGrantBindingRecord,
  ChatLedgerEvent,
  ChatMessageEditRecord,
  ChatMessageReaction,
  ChatMessageReactionRecord,
  ChatMessageRedactionRecord,
  ChatParticipantRecord,
  ChatParticipantRef,
  ChatParticipantUpsertInput,
  ChatRoomMembershipInput,
  ChatRoomMembershipRecord,
  ChatMessage as ModelChatMessage,
  ChatMessageInput as ModelChatMessageInput,
  ParticipantCapability,
} from "./model.js"
import {
  assertValidChatConversationShape,
  assertValidChatMessageInput,
  assertValidChatParticipantInput,
  CHAT_REDACTED_MESSAGE_BODY,
  chatConversationIdentity,
  chatConversationSection,
  defaultConversationHistoryMode,
  defaultConversationLifecycleState,
  defaultConversationPostingPolicy,
  defaultConversationVisibility,
  isChatLedgerEvent,
  isDirectConversationKind,
} from "./model.js"

export type ChatMessageInput = ModelChatMessageInput
export type ChatMessage = ModelChatMessage

export interface ChatConversationReplayScope {
  threadId: string | null
  latestScopeSequence: number
  messages: ChatMessage[]
  cursors: ChatCursorRecord[]
}

export interface ChatConversationReplayState {
  conversation: ChatConversationRecord | null
  participantIds: string[]
  memberships: ChatRoomMembershipRecord[]
  grantBindings: ChatGrantBindingRecord[]
  messages: ChatMessage[]
  cursors: ChatCursorRecord[]
  scopes: ChatConversationReplayScope[]
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function uniqueCapabilities(values: ParticipantCapability[]): ParticipantCapability[] {
  return Array.from(new Set(values.filter((value) => value === "chat-participant")))
}

function reactionParticipantKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

function attachmentScopeKey(conversationId: string, threadId: string | null): string {
  return `${conversationId}::${threadId ?? "root"}`
}

function mentionIdsFromBody(body: string): string[] {
  return Array.from(body.matchAll(/@([a-zA-Z0-9._-]+)/gu)).map((match) => match[1])
}

function membershipKey(conversationId: string, participantId: string): string {
  return `${conversationId}::${participantId}`
}

function cursorKey(conversationId: string, threadId: string | null, participantId: string): string {
  return `${conversationId}::${threadId ?? "root"}::${participantId}`
}

function messageScopeKey(conversationId: string, threadId: string | null): string {
  return `${conversationId}::${threadId ?? "root"}`
}

function hydrateConversationParticipants(
  record: ChatConversationRecord,
  memberships: Map<string, ChatRoomMembershipRecord> | undefined,
): string[] {
  if (!memberships || memberships.size === 0) {
    return unique(record.participantIds)
  }
  const joinedParticipantIds = Array.from(memberships.values())
    .filter((membership) => membership.membershipState === "joined")
    .map((membership) => membership.participantId)
  const joinedParticipantSet = new Set(joinedParticipantIds)
  return unique([
    ...record.participantIds.filter((participantId) => joinedParticipantSet.has(participantId)),
    ...joinedParticipantIds,
  ])
}

function transcriptRecipientForMessage(message: ChatMessage): TranscriptParticipantRef {
  if (message.audience?.kind === "participant") {
    return {
      kind: message.audience.kind,
      id: message.audience.id,
    }
  }

  return {
    kind: "room",
    id: "room",
  }
}

function normalizeLegacyChatEvent(event: ChatLedgerEvent): ChatLedgerEvent {
  const currentScopeId = Reflect.get(event, "scopeId")
  if (typeof currentScopeId === "string") {
    return event
  }

  const legacyScopeId = Reflect.get(event, "companyId")
  if (typeof legacyScopeId !== "string") {
    return event
  }

  const normalized = {
    ...event,
    scopeId: legacyScopeId,
  } as ChatLedgerEvent & { companyId?: string }
  delete normalized.companyId
  return normalized
}

export class SharedChatLedger {
  constructor(private readonly storageDir: string) {}

  private currentFilePath(): string {
    return join(this.storageDir, ".openboa", "runtime", "chat-ledger.jsonl")
  }

  private legacyFilePath(): string {
    return join(this.storageDir, ".openboa", "runtime", "company-ledger.jsonl")
  }

  filePath(): string {
    const currentPath = this.currentFilePath()
    if (existsSync(currentPath)) {
      return currentPath
    }
    const legacyPath = this.legacyFilePath()
    if (!existsSync(legacyPath)) {
      return currentPath
    }
    renameSync(legacyPath, currentPath)
    return currentPath
  }

  scopeId(): string {
    return basename(this.storageDir)
  }

  async listEvents(scopeId = this.scopeId()): Promise<ChatLedgerEvent[]> {
    const records = await readJsonl<unknown>(this.filePath())
    return records
      .filter(isChatLedgerEvent)
      .map(normalizeLegacyChatEvent)
      .filter((record) => record.scopeId === scopeId)
      .sort((left, right) => left.sequence - right.sequence)
  }

  async listConversationRecords(scopeId = this.scopeId()): Promise<ChatConversationRecord[]> {
    const events = await this.listEvents(scopeId)
    const latestById = new Map<string, ChatConversationRecord>()
    const latestMembershipsByConversation = new Map<string, Map<string, ChatRoomMembershipRecord>>()
    for (const event of events) {
      if (event.eventType === "conversation.upserted") {
        latestById.set(event.conversationId, event)
        continue
      }
      if (event.eventType !== "conversation.membership.upserted") {
        continue
      }
      const conversationMemberships =
        latestMembershipsByConversation.get(event.conversationId) ??
        new Map<string, ChatRoomMembershipRecord>()
      conversationMemberships.set(event.participantId, event)
      latestMembershipsByConversation.set(event.conversationId, conversationMemberships)
    }
    return Array.from(latestById.values())
      .map((record) => ({
        ...record,
        participantIds: hydrateConversationParticipants(
          record,
          latestMembershipsByConversation.get(record.conversationId),
        ),
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async getConversationById(
    conversationId: string,
    scopeId = this.scopeId(),
  ): Promise<ChatConversationRecord | null> {
    const records = await this.listConversationRecords(scopeId)
    return records.find((record) => record.conversationId === conversationId) ?? null
  }

  async findConversationBySlug(
    slug: string,
    scopeId = this.scopeId(),
  ): Promise<ChatConversationRecord | null> {
    const normalizedSlug = slug.trim()
    if (!normalizedSlug) {
      return null
    }
    const records = await this.listConversationRecords(scopeId)
    return (
      records.find(
        (record) => record.kind === "channel" && record.slug?.trim() === normalizedSlug,
      ) ?? null
    )
  }

  async findDirectConversationByParticipants(
    participantIds: string[],
    scopeId = this.scopeId(),
  ): Promise<ChatConversationRecord | null> {
    const normalizedParticipants = unique(participantIds).sort()
    if (normalizedParticipants.length < 2) {
      return null
    }
    const expectedIdentity = chatConversationIdentity({
      kind: normalizedParticipants.length === 2 ? "dm" : "group_dm",
      participantIds: normalizedParticipants,
    })
    const records = await this.listConversationRecords(scopeId)
    return (
      records.find((record) => {
        if (record.section !== "dms") {
          return false
        }
        return (
          chatConversationIdentity({
            kind: record.kind,
            participantIds: record.participantIds,
          }) === expectedIdentity
        )
      }) ?? null
    )
  }

  async ensureConversation(input: ChatConversationInput): Promise<ChatConversationRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const normalizedParticipants = unique(input.participantIds ?? [])
    const normalizedSlug = input.slug?.trim() || null
    const predecessorConversationId = input.predecessorConversationId?.trim() || null
    assertValidChatConversationShape({
      kind: input.kind,
      slug: normalizedSlug,
      participantIds: normalizedParticipants,
      predecessorConversationId,
      historyMode: input.historyMode,
    })
    const existing =
      input.kind === "channel" && normalizedSlug
        ? await this.findConversationBySlug(normalizedSlug, scopeId)
        : input.kind === "dm" || input.kind === "group_dm"
          ? await this.findDirectConversationByParticipants(normalizedParticipants, scopeId)
          : null

    if (existing) {
      return existing
    }

    const lineagePredecessor = await this.validateDirectConversationLineage({
      scopeId,
      kind: input.kind,
      participantIds: normalizedParticipants,
      predecessorConversationId,
      lineageRootConversationId: input.lineageRootConversationId ?? null,
      historyMode: input.historyMode,
      currentConversationId: null,
    })

    const events = await this.listEvents(scopeId)
    const createdAt = input.createdAt ?? input.updatedAt
    const record: ChatConversationRecord = {
      eventType: "conversation.upserted",
      scopeId,
      eventId: makeId("conv-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      conversationId: makeUuidV7(),
      kind: input.kind,
      section: chatConversationSection(input.kind),
      slug: normalizedSlug,
      title: input.title.trim(),
      topic: input.topic ?? null,
      visibility: input.visibility ?? defaultConversationVisibility(input.kind),
      postingPolicy: input.postingPolicy ?? defaultConversationPostingPolicy(),
      lifecycleState: input.lifecycleState ?? defaultConversationLifecycleState(),
      participantIds: normalizedParticipants,
      predecessorConversationId,
      lineageRootConversationId:
        lineagePredecessor?.lineageRootConversationId ||
        input.lineageRootConversationId?.trim() ||
        "",
      historyMode: input.historyMode ?? defaultConversationHistoryMode(predecessorConversationId),
      createdAt,
      updatedAt: input.updatedAt,
    }
    record.lineageRootConversationId ||= record.conversationId
    await appendJsonl(this.filePath(), record)
    await this.syncMembershipRecords({
      scopeId,
      conversationId: record.conversationId,
      previousParticipantIds: [],
      nextParticipantIds: normalizedParticipants,
      updatedAt: input.updatedAt,
    })
    return record
  }

  async updateConversation(
    conversationId: string,
    input: ChatConversationInput,
  ): Promise<ChatConversationRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const previous = await this.getConversationById(conversationId, scopeId)
    if (!previous) {
      throw new Error(`Conversation ${conversationId} was not found`)
    }
    if (input.kind !== previous.kind) {
      throw new Error("Room kind is immutable")
    }

    const events = await this.listEvents(scopeId)
    const normalizedParticipants = unique(input.participantIds ?? previous.participantIds)
    const predecessorConversationId =
      input.predecessorConversationId?.trim() || previous.predecessorConversationId?.trim() || null
    const normalizedSlug = input.slug?.trim() || previous.slug?.trim() || null
    const historyMode =
      input.historyMode ??
      previous.historyMode ??
      defaultConversationHistoryMode(predecessorConversationId)
    assertValidChatConversationShape({
      kind: previous.kind,
      slug: normalizedSlug,
      participantIds: normalizedParticipants,
      predecessorConversationId,
      historyMode,
    })
    if (isDirectConversationKind(previous.kind)) {
      const previousIdentity = chatConversationIdentity({
        kind: previous.kind,
        participantIds: previous.participantIds,
      })
      const nextIdentity = chatConversationIdentity({
        kind: previous.kind,
        participantIds: normalizedParticipants,
      })
      if (previousIdentity !== nextIdentity) {
        throw new Error("Direct room participant set is immutable")
      }
      if (
        predecessorConversationId !== previous.predecessorConversationId ||
        historyMode !== previous.historyMode ||
        (input.lineageRootConversationId?.trim() || previous.lineageRootConversationId) !==
          previous.lineageRootConversationId
      ) {
        throw new Error("Direct room lineage is immutable")
      }
    }
    const lineagePredecessor = await this.validateDirectConversationLineage({
      scopeId,
      kind: previous.kind,
      participantIds: normalizedParticipants,
      predecessorConversationId,
      lineageRootConversationId:
        input.lineageRootConversationId ?? previous.lineageRootConversationId ?? null,
      historyMode,
      currentConversationId: conversationId,
    })
    const record: ChatConversationRecord = {
      eventType: "conversation.upserted",
      scopeId,
      eventId: makeId("conv-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      conversationId,
      kind: previous.kind,
      section: chatConversationSection(previous.kind),
      slug: normalizedSlug,
      title: input.title.trim(),
      topic: input.topic ?? null,
      visibility:
        input.visibility ?? previous.visibility ?? defaultConversationVisibility(previous.kind),
      postingPolicy:
        input.postingPolicy ?? previous.postingPolicy ?? defaultConversationPostingPolicy(),
      lifecycleState:
        input.lifecycleState ?? previous.lifecycleState ?? defaultConversationLifecycleState(),
      participantIds: normalizedParticipants,
      predecessorConversationId,
      lineageRootConversationId:
        lineagePredecessor?.lineageRootConversationId ||
        previous.lineageRootConversationId ||
        conversationId,
      historyMode,
      createdAt: previous.createdAt,
      updatedAt: input.updatedAt,
    }
    await appendJsonl(this.filePath(), record)
    await this.syncMembershipRecords({
      scopeId,
      conversationId,
      previousParticipantIds: previous.participantIds,
      nextParticipantIds: normalizedParticipants,
      updatedAt: input.updatedAt,
    })
    return record
  }

  async listRoomMembershipRecords(
    scopeId = this.scopeId(),
    scope: {
      conversationId?: string
      participantId?: string
    } = {},
  ): Promise<ChatRoomMembershipRecord[]> {
    const events = await this.listEvents(scopeId)
    const latestByKey = new Map<string, ChatRoomMembershipRecord>()
    for (const event of events) {
      if (event.eventType !== "conversation.membership.upserted") {
        continue
      }
      if (scope.conversationId && event.conversationId !== scope.conversationId) {
        continue
      }
      if (scope.participantId && event.participantId !== scope.participantId) {
        continue
      }
      latestByKey.set(membershipKey(event.conversationId, event.participantId), event)
    }

    return Array.from(latestByKey.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  }

  async upsertRoomMembership(input: ChatRoomMembershipInput): Promise<ChatRoomMembershipRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const events = await this.listEvents(scopeId)
    const previous = (
      await this.listRoomMembershipRecords(scopeId, {
        conversationId: input.conversationId,
        participantId: input.participantId,
      })
    ).at(0)
    const record: ChatRoomMembershipRecord = {
      eventType: "conversation.membership.upserted",
      scopeId,
      eventId: makeId("membership-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      conversationId: input.conversationId,
      participantId: input.participantId,
      membershipState: input.membershipState ?? "joined",
      createdAt: input.createdAt ?? previous?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    }
    await appendJsonl(this.filePath(), record)
    return record
  }

  async listGrantBindings(
    scopeId = this.scopeId(),
    scope: {
      bindingId?: string
      subjectId?: string
      conversationId?: string | null
      scopeKind?: "chat" | "conversation"
    } = {},
  ): Promise<ChatGrantBindingRecord[]> {
    const events = await this.listEvents(scopeId)
    const latestById = new Map<string, ChatGrantBindingRecord>()
    for (const event of events) {
      if (event.eventType !== "authorization.grant-binding.upserted") {
        continue
      }
      if (scope.bindingId && event.bindingId !== scope.bindingId) {
        continue
      }
      if (scope.subjectId && event.subjectId !== scope.subjectId) {
        continue
      }
      if (scope.scopeKind && event.scopeKind !== scope.scopeKind) {
        continue
      }
      if (
        scope.conversationId !== undefined &&
        (event.conversationId ?? null) !== (scope.conversationId ?? null)
      ) {
        continue
      }
      latestById.set(event.bindingId, event)
    }

    return Array.from(latestById.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  }

  async getGrantBinding(
    bindingId: string,
    scopeId = this.scopeId(),
  ): Promise<ChatGrantBindingRecord | null> {
    const bindings = await this.listGrantBindings(scopeId, { bindingId })
    return bindings.at(0) ?? null
  }

  async createGrantBinding(input: ChatGrantBindingInput): Promise<ChatGrantBindingRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const events = await this.listEvents(scopeId)
    const previous = input.bindingId ? await this.getGrantBinding(input.bindingId, scopeId) : null
    const conversationId =
      input.scopeKind === "conversation" ? input.conversationId?.trim() || null : null

    if (input.scopeKind === "conversation" && !conversationId) {
      throw new Error("Conversation-scoped grants require a conversationId")
    }

    if (
      previous &&
      (previous.subjectId !== input.subjectId ||
        previous.roleId !== input.roleId ||
        previous.scopeKind !== input.scopeKind ||
        (previous.conversationId ?? null) !== conversationId)
    ) {
      throw new Error("Grant binding identity is immutable")
    }

    const record: ChatGrantBindingRecord = {
      eventType: "authorization.grant-binding.upserted",
      scopeId,
      eventId: makeId("grant-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      bindingId: input.bindingId ?? makeId("grant"),
      subjectId: input.subjectId,
      roleId: input.roleId,
      scopeKind: input.scopeKind,
      conversationId,
      bindingState: input.bindingState ?? "active",
      createdAt: input.createdAt ?? previous?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    }
    await appendJsonl(this.filePath(), record)
    return record
  }

  async revokeGrantBinding(
    bindingId: string,
    updatedAt: string,
    scopeId = this.scopeId(),
  ): Promise<ChatGrantBindingRecord> {
    const previous = await this.getGrantBinding(bindingId, scopeId)
    if (!previous) {
      throw new Error(`Grant binding ${bindingId} was not found`)
    }

    return this.createGrantBinding({
      scopeId,
      bindingId: previous.bindingId,
      subjectId: previous.subjectId,
      roleId: previous.roleId,
      scopeKind: previous.scopeKind,
      conversationId: previous.conversationId,
      bindingState: "revoked",
      createdAt: previous.createdAt,
      updatedAt,
    })
  }

  async listCursorRecords(
    scopeId = this.scopeId(),
    scope: {
      conversationId?: string
      threadId?: string | null
      participantId?: string
    } = {},
  ): Promise<ChatCursorRecord[]> {
    const events = await this.listEvents(scopeId)
    const latestByKey = new Map<string, ChatCursorRecord>()
    for (const event of events) {
      if (event.eventType !== "conversation.cursor.updated") {
        continue
      }
      if (scope.conversationId && event.conversationId !== scope.conversationId) {
        continue
      }
      if (scope.participantId && event.participantId !== scope.participantId) {
        continue
      }
      if (scope.threadId !== undefined && (event.threadId ?? null) !== (scope.threadId ?? null)) {
        continue
      }
      latestByKey.set(
        cursorKey(event.conversationId, event.threadId ?? null, event.participantId),
        event,
      )
    }

    return Array.from(latestByKey.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  }

  async upsertCursor(input: ChatCursorInput): Promise<ChatCursorRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    await this.validateThreadScope(scopeId, input.conversationId, input.threadId ?? null)
    const events = await this.listEvents(scopeId)
    const previous = (
      await this.listCursorRecords(scopeId, {
        conversationId: input.conversationId,
        threadId: input.threadId ?? null,
        participantId: input.participantId,
      })
    ).at(0)
    const record: ChatCursorRecord = {
      eventType: "conversation.cursor.updated",
      scopeId,
      eventId: makeId("cursor-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      participantId: input.participantId,
      conversationId: input.conversationId,
      threadId: input.threadId ?? null,
      lastObservedSequence: input.lastObservedSequence,
      lastObservedScopeSequence:
        input.lastObservedScopeSequence ??
        previous?.lastObservedScopeSequence ??
        input.lastObservedScopeRevision,
      lastObservedScopeRevision: input.lastObservedScopeRevision,
      lastContributedSequence:
        input.lastContributedSequence ?? previous?.lastContributedSequence ?? null,
      createdAt: input.createdAt ?? previous?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    }
    await appendJsonl(this.filePath(), record)
    return record
  }

  async listConversationAttachments(
    scopeId = this.scopeId(),
    scope?: {
      conversationId?: string
      threadId?: string | null
    },
  ): Promise<ChatConversationAttachmentRecord[]> {
    const events = await this.listEvents(scopeId)
    const latestByScopeAndParticipant = new Map<string, ChatConversationAttachmentRecord>()

    for (const event of events) {
      if (event.eventType !== "conversation.attachment.upserted") {
        continue
      }
      if (scope?.conversationId && event.conversationId !== scope.conversationId) {
        continue
      }
      if (scope && "threadId" in scope && (event.threadId ?? null) !== (scope.threadId ?? null)) {
        continue
      }
      latestByScopeAndParticipant.set(
        `${attachmentScopeKey(event.conversationId, event.threadId)}:${event.participantId}`,
        event,
      )
    }

    return Array.from(latestByScopeAndParticipant.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  }

  async upsertConversationAttachment(
    input: ChatConversationAttachmentInput,
  ): Promise<ChatConversationAttachmentRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    await this.validateThreadScope(scopeId, input.conversationId, input.threadId ?? null)
    const events = await this.listEvents(scopeId)
    const previous = (
      await this.listConversationAttachments(scopeId, {
        conversationId: input.conversationId,
        threadId: input.threadId ?? null,
      })
    ).find((record) => record.participantId === input.participantId)

    const record: ChatConversationAttachmentRecord = {
      eventType: "conversation.attachment.upserted",
      scopeId,
      eventId: makeId("attachment-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      conversationId: input.conversationId,
      threadId: input.threadId ?? null,
      participantId: input.participantId,
      attached: input.attached ?? true,
      createdAt: input.createdAt ?? previous?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    }
    await appendJsonl(this.filePath(), record)
    return record
  }

  async appendMessage(input: ChatMessageInput): Promise<ChatMessage> {
    const scopeId = input.scopeId ?? this.scopeId()
    assertValidChatMessageInput(input)
    await this.validateThreadScope(scopeId, input.conversationId, input.threadId ?? null)
    const messageKind = input.messageKind ?? "participant-message"
    const idempotencyKey = input.idempotencyKey?.trim() || null
    if (idempotencyKey) {
      const existing = await this.findMessageByIdempotencyKey(
        idempotencyKey,
        scopeId,
        input.conversationId,
        input.threadId ?? null,
      )
      if (existing) {
        return existing
      }
    }
    const systemEventKind = messageKind === "system-event" ? (input.systemEventKind ?? null) : null
    const events = await this.listEvents(scopeId)
    const scopeMessages = await this.listScopeMessages(scopeId, {
      conversationId: input.conversationId,
      threadId: input.threadId ?? null,
    })
    const scopedReplies =
      input.threadId == null
        ? scopeMessages.filter((event) => event.threadId === null)
        : scopeMessages.filter((event) => event.threadId === input.threadId)
    const nextScopeSequence = (scopedReplies.at(-1)?.scopeSequence ?? 0) + 1
    const sequence = (events.at(-1)?.sequence ?? 0) + 1
    const persisted: ChatMessage = {
      eventType: "message.posted",
      scopeId,
      messageId: makeId("msg"),
      eventId: "",
      sequence,
      scopeSequence: nextScopeSequence,
      revision: sequence,
      conversationId: input.conversationId,
      roomId: input.conversationId,
      threadId: input.threadId ?? null,
      sessionId: input.sessionId,
      author: input.author,
      audience: input.audience ?? null,
      content: input.body,
      body: input.body,
      idempotencyKey,
      createdAt: input.createdAt,
      editedAt: null,
      editedById: null,
      redactedAt: null,
      redactedById: null,
      mentionedIds: unique([...(input.mentionedIds ?? []), ...mentionIdsFromBody(input.body)]),
      reactions: [],
      relatedMessageId: input.relatedMessageId ?? null,
      messageKind,
      systemEventKind,
    }
    persisted.eventId = persisted.messageId
    await appendJsonl(this.filePath(), persisted)
    return persisted
  }

  async editMessage(input: {
    scopeId?: string
    messageId: string
    editor: ChatParticipantRef
    body: string
    createdAt: string
  }): Promise<ChatMessageEditRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const message = await this.findMessageById(input.messageId, scopeId)
    if (!message) {
      throw new Error(`Message ${input.messageId} was not found`)
    }

    const events = await this.listEvents(scopeId)
    const sequence = (events.at(-1)?.sequence ?? 0) + 1
    const body = input.body
    const persisted: ChatMessageEditRecord = {
      eventType: "message.edited",
      scopeId,
      eventId: makeId("message-edit"),
      sequence,
      scopeRevision: sequence,
      messageId: input.messageId,
      editor: input.editor,
      body,
      content: body,
      mentionedIds: mentionIdsFromBody(body),
      createdAt: input.createdAt,
    }
    await appendJsonl(this.filePath(), persisted)
    return persisted
  }

  async redactMessage(input: {
    scopeId?: string
    messageId: string
    redactor: ChatParticipantRef
    createdAt: string
  }): Promise<ChatMessageRedactionRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const message = await this.findMessageById(input.messageId, scopeId)
    if (!message) {
      throw new Error(`Message ${input.messageId} was not found`)
    }

    const events = await this.listEvents(scopeId)
    const sequence = (events.at(-1)?.sequence ?? 0) + 1
    const persisted: ChatMessageRedactionRecord = {
      eventType: "message.redacted",
      scopeId,
      eventId: makeId("message-redaction"),
      sequence,
      scopeRevision: sequence,
      messageId: input.messageId,
      redactor: input.redactor,
      createdAt: input.createdAt,
    }
    await appendJsonl(this.filePath(), persisted)
    return persisted
  }

  async setMessageReaction(input: {
    scopeId?: string
    messageId: string
    emoji: string
    participant: ChatParticipantRef
    active: boolean
    createdAt: string
  }): Promise<ChatMessageReactionRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const events = await this.listEvents(scopeId)
    const persisted: ChatMessageReactionRecord = {
      eventType: "message.reaction.set",
      scopeId,
      eventId: makeId("reaction"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      messageId: input.messageId,
      emoji: input.emoji,
      participant: input.participant,
      active: input.active,
      createdAt: input.createdAt,
    }
    await appendJsonl(this.filePath(), persisted)
    return persisted
  }

  async listParticipantRecords(scopeId = this.scopeId()): Promise<ChatParticipantRecord[]> {
    const events = await this.listEvents(scopeId)
    const latestById = new Map<string, ChatParticipantRecord>()
    for (const event of events) {
      if (event.eventType !== "participant.upserted") {
        continue
      }
      latestById.set(event.participantId, event)
    }
    return Array.from(latestById.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  }

  async getParticipantRecord(
    participantId: string,
    scopeId = this.scopeId(),
  ): Promise<ChatParticipantRecord | null> {
    const records = await this.listParticipantRecords(scopeId)
    return records.find((record) => record.participantId === participantId) ?? null
  }

  async upsertParticipant(input: ChatParticipantUpsertInput): Promise<ChatParticipantRecord> {
    const scopeId = input.scopeId ?? this.scopeId()
    const events = await this.listEvents(scopeId)
    const previous = await this.getParticipantRecord(input.participantId, scopeId)
    assertValidChatParticipantInput(input)
    const baseRecord = {
      eventType: "participant.upserted",
      scopeId,
      eventId: makeId("participant-event"),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      participantId: input.participantId,
      displayName: input.displayName ?? previous?.displayName ?? null,
      capabilities: uniqueCapabilities(input.capabilities ?? previous?.capabilities ?? []),
      createdAt: input.createdAt ?? previous?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    } as const
    const record: ChatParticipantRecord = {
      ...baseRecord,
    }
    await appendJsonl(this.filePath(), record)
    return record
  }

  async listMessages(scopeId = this.scopeId(), conversationId?: string): Promise<ChatMessage[]> {
    const events = await this.listEvents(scopeId)
    const messages = new Map<string, ChatMessage>()
    const reactionState = new Map<string, Map<string, Map<string, ChatParticipantRef>>>()

    for (const event of events) {
      if (event.eventType === "message.posted") {
        if (conversationId && event.conversationId !== conversationId) {
          continue
        }
        messages.set(event.messageId, {
          ...event,
          reactions: event.reactions ?? [],
        })
        continue
      }

      if (event.eventType === "message.edited") {
        const message = messages.get(event.messageId)
        if (!message || message.redactedAt) {
          continue
        }
        message.body = event.body
        message.content = event.content
        message.mentionedIds = unique(event.mentionedIds)
        message.editedAt = event.createdAt
        message.editedById = event.editor.id
        message.revision = Math.max(message.revision, event.scopeRevision)
        continue
      }

      if (event.eventType === "message.redacted") {
        const message = messages.get(event.messageId)
        if (!message) {
          continue
        }
        message.body = CHAT_REDACTED_MESSAGE_BODY
        message.content = CHAT_REDACTED_MESSAGE_BODY
        message.mentionedIds = []
        message.reactions = []
        message.redactedAt = event.createdAt
        message.redactedById = event.redactor.id
        message.revision = Math.max(message.revision, event.scopeRevision)
        reactionState.delete(event.messageId)
        continue
      }

      if (event.eventType !== "message.reaction.set") {
        continue
      }

      const message = messages.get(event.messageId)
      if (!message || message.redactedAt) {
        continue
      }

      const emojiReactions =
        reactionState.get(event.messageId) ?? new Map<string, Map<string, ChatParticipantRef>>()
      const participantsForEmoji =
        emojiReactions.get(event.emoji) ?? new Map<string, ChatParticipantRef>()
      const participantKey = reactionParticipantKey(event.participant.kind, event.participant.id)

      if (event.active) {
        participantsForEmoji.set(participantKey, event.participant)
      } else if (participantsForEmoji.has(participantKey)) {
        participantsForEmoji.delete(participantKey)
      }

      if (participantsForEmoji.size === 0) {
        emojiReactions.delete(event.emoji)
      } else {
        emojiReactions.set(event.emoji, participantsForEmoji)
      }

      if (emojiReactions.size === 0) {
        reactionState.delete(event.messageId)
      } else {
        reactionState.set(event.messageId, emojiReactions)
      }

      message.reactions = Array.from(emojiReactions.entries()).map(
        ([emoji, participants]): ChatMessageReaction => ({
          emoji,
          participantIds: Array.from(participants.values()).map((participant) => participant.id),
          count: participants.size,
        }),
      )
    }

    return Array.from(messages.values()).sort((left, right) => left.sequence - right.sequence)
  }

  async listScopeMessages(
    scopeId = this.scopeId(),
    scope: {
      conversationId: string
      threadId?: string | null
    },
  ): Promise<ChatMessage[]> {
    const conversationMessages = await this.listMessages(scopeId, scope.conversationId)
    const threadId = scope.threadId ?? null
    if (!threadId) {
      return conversationMessages
        .filter((message) => message.threadId === null)
        .sort(
          (left, right) =>
            left.scopeSequence - right.scopeSequence || left.sequence - right.sequence,
        )
    }

    const threadRoot = await this.validateThreadScope(scopeId, scope.conversationId, threadId)
    if (!threadRoot) {
      throw new Error(
        "Thread scope requires an existing top-level root message in the same conversation",
      )
    }
    const replies = conversationMessages
      .filter((message) => message.threadId === threadId)
      .sort(
        (left, right) => left.scopeSequence - right.scopeSequence || left.sequence - right.sequence,
      )

    return [threadRoot, ...replies]
  }

  async listJoinedParticipantIds(
    conversationId: string,
    scopeId = this.scopeId(),
  ): Promise<string[]> {
    const memberships = await this.listRoomMembershipRecords(scopeId, { conversationId })
    return memberships
      .filter((membership) => membership.membershipState === "joined")
      .map((membership) => membership.participantId)
  }

  async replayConversationState(
    conversationId: string,
    scopeId = this.scopeId(),
  ): Promise<ChatConversationReplayState> {
    const [conversation, memberships, grantBindings, cursors, messages] = await Promise.all([
      this.getConversationById(conversationId, scopeId),
      this.listRoomMembershipRecords(scopeId, { conversationId }),
      this.listGrantBindings(scopeId, { conversationId }),
      this.listCursorRecords(scopeId, { conversationId }),
      this.listMessages(scopeId, conversationId),
    ])
    const participantIds = conversation?.participantIds ?? []
    const scopeThreadIds = new Set<string | null>([
      null,
      ...messages.map((message) => message.threadId ?? null),
      ...cursors.map((cursor) => cursor.threadId ?? null),
    ])
    const scopes = Array.from(scopeThreadIds.values())
      .map((threadId) => {
        const scopeMessages = threadId
          ? messages
              .filter((message) => message.messageId === threadId || message.threadId === threadId)
              .sort((left, right) =>
                left.threadId === null && right.threadId !== null
                  ? -1
                  : right.threadId === null && left.threadId !== null
                    ? 1
                    : left.scopeSequence - right.scopeSequence || left.sequence - right.sequence,
              )
          : messages
              .filter((message) => message.threadId === null)
              .sort(
                (left, right) =>
                  left.scopeSequence - right.scopeSequence || left.sequence - right.sequence,
              )
        const scopeCursors = cursors
          .filter((cursor) => (cursor.threadId ?? null) === threadId)
          .sort((left, right) => left.participantId.localeCompare(right.participantId))
        const latestScopeSequence = threadId
          ? (scopeMessages.filter((message) => message.threadId === threadId).at(-1)
              ?.scopeSequence ?? 0)
          : (scopeMessages.at(-1)?.scopeSequence ?? 0)
        return {
          threadId,
          latestScopeSequence,
          messages: scopeMessages,
          cursors: scopeCursors,
        } satisfies ChatConversationReplayScope
      })
      .sort((left, right) => {
        if (left.threadId === null) {
          return -1
        }
        if (right.threadId === null) {
          return 1
        }
        return left.threadId.localeCompare(right.threadId)
      })

    return {
      conversation,
      participantIds,
      memberships,
      grantBindings,
      messages,
      cursors,
      scopes,
    }
  }

  async findMessageById(messageId: string, scopeId = this.scopeId()): Promise<ChatMessage | null> {
    const messages = await this.listMessages(scopeId)
    return messages.find((message) => message.messageId === messageId) ?? null
  }

  async findMessageByIdempotencyKey(
    idempotencyKey: string,
    scopeId = this.scopeId(),
    conversationId?: string,
    threadId?: string | null,
  ): Promise<ChatMessage | null> {
    const normalizedKey = idempotencyKey.trim()
    if (!normalizedKey) {
      return null
    }
    const messages = await this.listMessages(scopeId, conversationId)
    return (
      messages.find(
        (message) =>
          message.idempotencyKey === normalizedKey &&
          (conversationId
            ? messageScopeKey(message.conversationId, message.threadId ?? null) ===
              messageScopeKey(conversationId, threadId ?? null)
            : true),
      ) ?? null
    )
  }

  async listTranscript(
    scopeId = this.scopeId(),
    conversationId = "general",
  ): Promise<TranscriptRecord[]> {
    const messages = await this.listMessages(scopeId, conversationId)
    return messages
      .filter((message) => message.messageKind === "participant-message")
      .filter(
        (
          message,
        ): message is ChatMessage & {
          author: ChatMessage["author"] & { kind: "participant" }
        } => message.author.kind === "participant",
      )
      .map((message) => ({
        scopeId,
        conversationId,
        threadId: message.threadId ?? null,
        sessionId: message.sessionId,
        sender: {
          kind: message.author.kind,
          id: message.author.id,
        },
        recipient: transcriptRecipientForMessage(message),
        message: message.body,
        timestamp: message.createdAt,
      }))
  }

  private async validateDirectConversationLineage(input: {
    scopeId: string
    kind: ChatConversationInput["kind"]
    participantIds: string[]
    predecessorConversationId: string | null
    lineageRootConversationId?: string | null
    historyMode?: ChatConversationInput["historyMode"]
    currentConversationId: string | null
  }): Promise<ChatConversationRecord | null> {
    const predecessorConversationId = input.predecessorConversationId?.trim() || null
    const historyMode =
      input.historyMode ?? defaultConversationHistoryMode(predecessorConversationId)
    if (!predecessorConversationId) {
      return null
    }
    if (!isDirectConversationKind(input.kind)) {
      throw new Error("Only direct rooms can inherit history")
    }
    if (historyMode !== "inherit_full") {
      throw new Error("Inherited direct-room history requires inherit_full history mode")
    }

    const predecessor = await this.getConversationById(predecessorConversationId, input.scopeId)
    if (!predecessor) {
      throw new Error(`Predecessor conversation ${predecessorConversationId} was not found`)
    }
    if (input.currentConversationId && predecessor.conversationId === input.currentConversationId) {
      throw new Error("Conversation cannot inherit history from itself")
    }
    if (!isDirectConversationKind(predecessor.kind)) {
      throw new Error("Direct-room lineage requires a direct-room predecessor")
    }

    const previousParticipants = unique(predecessor.participantIds)
    const nextParticipants = unique(input.participantIds)
    const nextParticipantSet = new Set(nextParticipants)
    const isStrictSuperset =
      nextParticipants.length > previousParticipants.length &&
      previousParticipants.every((participantId) => nextParticipantSet.has(participantId))
    if (!isStrictSuperset) {
      throw new Error("Direct-room lineage requires a strict participant superset")
    }

    const expectedLineageRoot = predecessor.lineageRootConversationId || predecessor.conversationId
    const lineageRootConversationId = input.lineageRootConversationId?.trim() || null
    if (lineageRootConversationId && lineageRootConversationId !== expectedLineageRoot) {
      throw new Error("Lineage root must match the predecessor lineage root")
    }
    return predecessor
  }

  private async validateThreadScope(
    scopeId: string,
    conversationId: string,
    threadId: string | null,
  ): Promise<ChatMessage | null> {
    if (!threadId) {
      return null
    }

    const threadRoot = await this.findMessageById(threadId, scopeId)
    if (!threadRoot || threadRoot.conversationId !== conversationId) {
      throw new Error(
        "Thread scope requires an existing top-level root message in the same conversation",
      )
    }
    if (threadRoot.threadId !== null) {
      throw new Error("Threads cannot be nested under replies")
    }
    return threadRoot
  }

  private async syncMembershipRecords(input: {
    scopeId: string
    conversationId: string
    previousParticipantIds: string[]
    nextParticipantIds: string[]
    updatedAt: string
  }): Promise<void> {
    const previous = new Set(unique(input.previousParticipantIds))
    const next = new Set(unique(input.nextParticipantIds))
    const joined = Array.from(next).filter((participantId) => !previous.has(participantId))
    const left = Array.from(previous).filter((participantId) => !next.has(participantId))

    for (const participantId of joined) {
      await this.upsertRoomMembership({
        scopeId: input.scopeId,
        conversationId: input.conversationId,
        participantId,
        membershipState: "joined",
        updatedAt: input.updatedAt,
      })
    }

    for (const participantId of left) {
      await this.upsertRoomMembership({
        scopeId: input.scopeId,
        conversationId: input.conversationId,
        participantId,
        membershipState: "left",
        updatedAt: input.updatedAt,
      })
    }
  }
}
