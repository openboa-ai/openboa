import { makeUuidV7 } from "../../foundation/ids.js"
import { nowIsoString } from "../../foundation/time.js"
import { resolveChatActorId } from "../actor-id.js"
import type { ConversationMessageSearchResult } from "../core/conversation-capability.js"
import { ConversationService } from "../core/conversation-service.js"
import { SharedChatLedger } from "../core/ledger.js"
import type {
  ChatConversation,
  ChatConversationAttachmentRecord,
  ChatConversationPostingPolicy,
  ChatConversationRecord,
  ChatConversationVisibility,
  ChatCursorRecord,
  ChatGrantBindingRecord,
  ChatLedgerEvent,
  ChatMessage,
  ChatMessageKind,
  ChatParticipantRecord,
  ChatParticipantRef,
  ChatRoleId,
  ChatRoomMembershipRecord,
  ChatRoomMembershipState,
  ChatSystemEventKind,
  ParticipantCapability,
} from "../core/model.js"
import {
  buildChatFollowedThreads,
  buildChatInbox,
  buildChatViewerRecents,
  type ChatFollowedThread,
  type ChatViewerRecentConversation,
  searchChatVisibleMessages,
  summarizeChatConversations,
} from "../projections/projections.js"
import type { ChatInboxEntry } from "../view-model.js"
import {
  type ChatScopeActionId,
  type ConversationActionId,
  evaluateChatAction,
  evaluateConversationAction,
  resolveChatRoleIds,
  resolveConversationRoleIds,
} from "./authorization.js"

type ConversationScopedChatEvent = Extract<ChatLedgerEvent, { conversationId: string }>
type ConversationGrantRoleId = Exclude<ChatRoleId, "chat_admin">

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function uniqueParticipants(participants: ChatParticipantRef[]): ChatParticipantRef[] {
  const byId = new Map<string, ChatParticipantRef>()
  for (const participant of participants) {
    if (!participant.id.trim()) {
      continue
    }
    byId.set(participant.id, participant)
  }
  return Array.from(byId.values())
}

function normalizeMassMention(body: string): boolean {
  return /(^|\s)@(?:channel|here|all)(?=\s|$)/u.test(body)
}

function describeConversationGrantAdded(subjectId: string, roleId: ConversationGrantRoleId) {
  if (roleId === "participant") {
    return `${subjectId} was invited to the room.`
  }
  if (roleId === "viewer") {
    return `${subjectId} can now view the room.`
  }
  return `${subjectId} can now manage the room.`
}

function describeConversationGrantRevoked(subjectId: string, roleId: ConversationGrantRoleId) {
  if (roleId === "participant") {
    return `Room invite for ${subjectId} was revoked.`
  }
  if (roleId === "viewer") {
    return `Viewer access for ${subjectId} was revoked.`
  }
  return `Room manager access for ${subjectId} was revoked.`
}

function isConversationGrantRoleId(roleId: ChatRoleId): roleId is ConversationGrantRoleId {
  return roleId !== "chat_admin"
}

export interface ChatCommandServiceDependencies {
  chatLedger?: SharedChatLedger
}

export interface CreateChannelInput {
  slug: string
  title: string
  createdById: string
  visibility?: ChatConversationVisibility
  postingPolicy?: ChatConversationPostingPolicy
  topic?: string | null
}

export interface EnsureDirectConversationInput {
  participants: ChatParticipantRef[]
  title?: string
}

export interface RegisterParticipantInput {
  participantId: string
  displayName?: string | null
  capabilities?: ParticipantCapability[]
}

export interface JoinConversationInput {
  conversationId: string
  participantId: string
}

export interface LeaveConversationInput {
  conversationId: string
  participantId: string
}

export interface RemoveConversationParticipantInput {
  conversationId: string
  actorId: string
  participantId: string
}

export interface GrantConversationRoleInput {
  conversationId: string
  subjectId: string
  roleId: Exclude<ChatRoleId, "chat_admin">
  grantedById?: string
}

export interface InviteParticipantInput {
  conversationId: string
  subjectId: string
  invitedById: string
}

export interface GrantViewerAccessInput {
  conversationId: string
  subjectId: string
  grantedById: string
}

export interface GrantChatRoleInput {
  subjectId: string
  roleId: "chat_admin"
  grantedById?: string
}

export interface BootstrapChatAdminInput {
  subjectId?: string
}

export interface UpdateConversationSettingsInput {
  conversationId: string
  updatedById: string
  title?: string
  topic?: string | null
  visibility?: ChatConversationVisibility
  postingPolicy?: ChatConversationPostingPolicy
}

export interface ArchiveConversationInput {
  conversationId: string
  archivedById: string
}

export interface ReadConversationMessagesInput {
  conversationId: string
  actorId: string
  threadId?: string | null
  beforeMessageId?: string | null
  authorId?: string | null
  messageKind?: ChatMessageKind | "all"
  limit?: number
}

export interface SearchConversationMessagesInput {
  conversationId: string
  actorId: string
  query: string
  threadId?: string | null
  authorId?: string | null
  messageKind?: ChatMessageKind | "all"
  limit?: number
}

export interface ReadConversationRosterInput {
  conversationId: string
  actorId: string
}

export interface ConversationRosterEntry {
  participantId: string
  displayName: string | null
  capabilities: ParticipantCapability[]
  conversationRoleIds: ChatRoleId[]
  chatRoleIds: ChatRoleId[]
  membershipState: ChatRoomMembershipState | null
  inConversation: boolean
  watchAttached: boolean | null
}

export interface ReadConversationGrantBindingsInput {
  conversationId: string
  actorId: string
  includeRevoked?: boolean
}

export interface ReadInboxInput {
  actorId: string
  limit?: number
}

export interface ReadFollowedThreadsInput {
  actorId: string
  limit?: number
}

export interface ReadConversationSummariesInput {
  actorId: string
  limit?: number
}

export interface ReadVisibleConversationsInput {
  actorId: string
}

export interface ReadConversationInput {
  conversationId: string
  actorId: string
}

export interface ResolveConversationRefInput {
  conversationRef: string
}

export interface ReadViewerRecentsInput {
  actorId: string
  limit?: number
}

export interface SearchVisibleMessagesInput {
  actorId: string
  query: string
  limit?: number
}

export interface ReadChatEventsInput {
  actorId: string
  conversationId?: string | null
  afterSequence?: number
  limit?: number
}

export interface RevokeConversationGrantBindingInput {
  conversationId: string
  bindingId: string
  actorId: string
}

export interface ReadConversationCursorInput {
  conversationId: string
  actorId: string
  threadId?: string | null
}

export interface MarkConversationReadInput {
  conversationId: string
  actorId: string
  threadId?: string | null
}

export interface ConversationCursorState {
  participantId: string
  conversationId: string
  threadId: string | null
  lastObservedSequence: number
  lastObservedScopeSequence: number
  lastObservedScopeRevision: number
  lastContributedSequence: number | null
  createdAt: string | null
  updatedAt: string | null
  hasPersistedCursor: boolean
}

export interface ReadThreadFollowStateInput {
  conversationId: string
  actorId: string
  threadId: string
}

export interface ReadConversationThreadInput {
  conversationId: string
  actorId: string
  threadId: string
  beforeMessageId?: string | null
  authorId?: string | null
  messageKind?: ChatMessageKind | "all"
  limit?: number
}

export interface ConversationThreadView {
  conversationId: string
  threadId: string
  rootMessage: ChatMessage
  replies: ChatMessage[]
  followState: ConversationAttachmentState
  cursorState: ConversationCursorState
}

export interface SetThreadFollowStateInput {
  conversationId: string
  actorId: string
  threadId: string
  attached: boolean
}

export interface ReadConversationWatchStateInput {
  conversationId: string
  actorId: string
}

export interface SetConversationWatchStateInput {
  conversationId: string
  actorId: string
  attached: boolean
}

export interface ConversationAttachmentState {
  participantId: string
  conversationId: string
  threadId: string | null
  attached: boolean | null
  createdAt: string | null
  updatedAt: string | null
  hasPersistedAttachment: boolean
}

export interface PostConversationMessageInput {
  conversationId: string
  senderId: string
  senderKind?: ChatParticipantRef["kind"]
  body: string
  threadId?: string | null
  idempotencyKey?: string | null
  sessionId?: string
  audience?: ChatParticipantRef | null
  relatedMessageId?: string | null
}

export interface SetMessageReactionInput {
  conversationId: string
  actorId: string
  messageId: string
  emoji: string
  active: boolean
}

export interface EditConversationMessageInput {
  conversationId: string
  actorId: string
  messageId: string
  body: string
}

export interface RedactConversationMessageInput {
  conversationId: string
  actorId: string
  messageId: string
}

function normalizeCursorState(input: {
  participantId: string
  conversationId: string
  threadId: string | null
  record: ChatCursorRecord | null
}): ConversationCursorState {
  const record = input.record
  return {
    participantId: input.participantId,
    conversationId: input.conversationId,
    threadId: input.threadId,
    lastObservedSequence: record?.lastObservedSequence ?? 0,
    lastObservedScopeSequence: record?.lastObservedScopeSequence ?? 0,
    lastObservedScopeRevision: record?.lastObservedScopeRevision ?? 0,
    lastContributedSequence: record?.lastContributedSequence ?? null,
    createdAt: record?.createdAt ?? null,
    updatedAt: record?.updatedAt ?? null,
    hasPersistedCursor: record !== null,
  }
}

function normalizeAttachmentState(input: {
  participantId: string
  conversationId: string
  threadId: string | null
  record: ChatConversationAttachmentRecord | null
}): ConversationAttachmentState {
  const record = input.record
  return {
    participantId: input.participantId,
    conversationId: input.conversationId,
    threadId: input.threadId,
    attached: record?.attached ?? null,
    createdAt: record?.createdAt ?? null,
    updatedAt: record?.updatedAt ?? null,
    hasPersistedAttachment: record !== null,
  }
}

function latestScopeRevision(messages: ChatMessage[]): number {
  return messages.reduce((maxRevision, message) => Math.max(maxRevision, message.revision), 0)
}

function uniqueSortedIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )
}

export class ChatCommandService {
  private readonly chatLedger: SharedChatLedger

  constructor(storageDir: string, dependencies: ChatCommandServiceDependencies = {}) {
    this.chatLedger = dependencies.chatLedger ?? new SharedChatLedger(storageDir)
  }

  scopeId(): string {
    return this.chatLedger.scopeId()
  }

  async registerParticipant(input: RegisterParticipantInput): Promise<ChatParticipantRecord> {
    const normalizedParticipantId = input.participantId.trim()
    if (!normalizedParticipantId) {
      throw new Error("Participant id is required")
    }

    return this.upsertParticipant({
      participantId: normalizedParticipantId,
      displayName: input.displayName ?? normalizedParticipantId,
      capabilities: input.capabilities,
    })
  }

  async createChannel(input: CreateChannelInput): Promise<ChatConversationRecord> {
    const slug = input.slug.trim()
    const title = input.title.trim()
    if (!slug) {
      throw new Error("Channel slug is required")
    }
    if (!title) {
      throw new Error("Channel title is required")
    }
    const existing = await this.chatLedger.findConversationBySlug(slug, this.scopeId())
    if (existing) {
      throw new Error(`Channel ${slug} already exists`)
    }

    const updatedAt = nowIsoString()
    const conversation = await this.chatLedger.ensureConversation({
      scopeId: this.scopeId(),
      kind: "channel",
      slug,
      title,
      topic: input.topic ?? null,
      visibility: input.visibility,
      postingPolicy: input.postingPolicy,
      participantIds: [input.createdById],
      updatedAt,
    })

    await this.ensureGrantBinding({
      subjectId: input.createdById,
      roleId: "room_manager",
      scopeKind: "conversation",
      conversationId: conversation.conversationId,
      updatedAt,
    })

    return conversation
  }

  async ensureDirectConversation(
    input: EnsureDirectConversationInput,
  ): Promise<ChatConversationRecord> {
    const participants = uniqueParticipants(input.participants)
    if (participants.length < 2) {
      throw new Error("Direct conversations require at least two participants")
    }
    for (const participant of participants) {
      if (participant.kind === "system") {
        throw new Error("Direct conversations do not support system participants")
      }
    }

    const participantIds = participants.map((participant) => participant.id)
    const title =
      input.title?.trim() || participants.map((participant) => participant.id).join(", ")
    const updatedAt = nowIsoString()
    const conversation = await this.chatLedger.ensureConversation({
      scopeId: this.scopeId(),
      kind: participants.length === 2 ? "dm" : "group_dm",
      title,
      visibility: "private",
      postingPolicy: "open",
      participantIds,
      updatedAt,
    })

    for (const participant of participants) {
      await this.ensureGrantBinding({
        subjectId: participant.id,
        roleId: "participant",
        scopeKind: "conversation",
        conversationId: conversation.conversationId,
        updatedAt,
      })
      await this.ensureGrantBinding({
        subjectId: participant.id,
        roleId: "room_manager",
        scopeKind: "conversation",
        conversationId: conversation.conversationId,
        updatedAt,
      })
    }

    return conversation
  }

  async joinConversation(input: JoinConversationInput): Promise<ChatConversationRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.participantId, conversation, "room.join")

    if (conversation.participantIds.includes(input.participantId)) {
      return conversation
    }

    const updatedAt = nowIsoString()
    const updated = await this.chatLedger.updateConversation(conversation.conversationId, {
      scopeId: this.scopeId(),
      kind: conversation.kind,
      slug: conversation.slug,
      title: conversation.title,
      topic: conversation.topic,
      visibility: conversation.visibility,
      postingPolicy: conversation.postingPolicy,
      lifecycleState: conversation.lifecycleState,
      participantIds: uniqueIds([...conversation.participantIds, input.participantId]),
      predecessorConversationId: conversation.predecessorConversationId,
      lineageRootConversationId: conversation.lineageRootConversationId,
      historyMode: conversation.historyMode,
      updatedAt,
    })

    await this.ensureGrantBinding({
      subjectId: input.participantId,
      roleId: "participant",
      scopeKind: "conversation",
      conversationId: conversation.conversationId,
      updatedAt,
    })

    await this.postConversationSystemMessage({
      conversationId: conversation.conversationId,
      body: `${input.participantId} joined the room.`,
      systemEventKind: "participant-added",
    })

    return updated
  }

  async leaveConversation(input: LeaveConversationInput): Promise<ChatConversationRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.participantId, conversation, "room.leave")
    const updated = await this.removeParticipantFromConversation(
      conversation,
      input.participantId,
      "Cannot leave the room as the last room_manager",
    )
    await this.postConversationSystemMessage({
      conversationId: conversation.conversationId,
      body: `${input.participantId} left the room.`,
      systemEventKind: "participant-left",
    })
    return updated
  }

  async removeConversationParticipant(
    input: RemoveConversationParticipantInput,
  ): Promise<ChatConversationRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.membership.manage")
    if (!conversation.participantIds.includes(input.participantId)) {
      return conversation
    }

    const updated = await this.removeParticipantFromConversation(conversation, input.participantId)
    await this.postConversationSystemMessage({
      conversationId: conversation.conversationId,
      body: `${input.participantId} was removed from the room.`,
      systemEventKind: "participant-left",
    })
    return updated
  }

  async grantConversationRole(input: GrantConversationRoleInput): Promise<ChatGrantBindingRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    if (input.grantedById) {
      await this.assertConversationAction(input.grantedById, conversation, "room.grant.manage")
    }

    const grant = await this.ensureGrantBindingWithStatus({
      subjectId: input.subjectId,
      roleId: input.roleId,
      scopeKind: "conversation",
      conversationId: input.conversationId,
      updatedAt: nowIsoString(),
    })
    if (grant.created) {
      await this.postConversationSystemMessage({
        conversationId: conversation.conversationId,
        body: describeConversationGrantAdded(input.subjectId, input.roleId),
        systemEventKind: "room-grant-added",
      })
    }
    return grant.binding
  }

  async inviteParticipant(input: InviteParticipantInput): Promise<ChatGrantBindingRecord> {
    return this.grantConversationRole({
      conversationId: input.conversationId,
      subjectId: input.subjectId,
      roleId: "participant",
      grantedById: input.invitedById,
    })
  }

  async grantViewerAccess(input: GrantViewerAccessInput): Promise<ChatGrantBindingRecord> {
    return this.grantConversationRole({
      conversationId: input.conversationId,
      subjectId: input.subjectId,
      roleId: "viewer",
      grantedById: input.grantedById,
    })
  }

  async grantChatRole(input: GrantChatRoleInput): Promise<ChatGrantBindingRecord> {
    if (input.grantedById) {
      await this.assertChatAction(input.grantedById, "chat.grant.manage")
    }

    return this.ensureGrantBinding({
      subjectId: input.subjectId,
      roleId: input.roleId,
      scopeKind: "chat",
      conversationId: null,
      updatedAt: nowIsoString(),
    })
  }

  async bootstrapChatAdmin(input: BootstrapChatAdminInput = {}): Promise<ChatGrantBindingRecord> {
    const subjectId = input.subjectId?.trim() || resolveChatActorId()
    const existingAdmins = await this.chatLedger.listGrantBindings(this.scopeId(), {
      scopeKind: "chat",
    })
    const activeAdmins = existingAdmins.filter(
      (binding) => binding.bindingState === "active" && binding.roleId === "chat_admin",
    )
    const existingForSubject = activeAdmins.find((binding) => binding.subjectId === subjectId)
    if (existingForSubject) {
      return existingForSubject
    }
    if (activeAdmins.length > 0) {
      throw new Error("Chat admin has already been bootstrapped")
    }

    return this.ensureGrantBinding({
      subjectId,
      roleId: "chat_admin",
      scopeKind: "chat",
      conversationId: null,
      updatedAt: nowIsoString(),
    })
  }

  async revokeGrantBinding(
    bindingId: string,
    revokedById?: string,
  ): Promise<ChatGrantBindingRecord> {
    const binding = await this.chatLedger.getGrantBinding(bindingId, this.scopeId())
    if (!binding) {
      throw new Error(`Grant binding ${bindingId} was not found`)
    }

    if (revokedById) {
      if (binding.scopeKind === "conversation" && binding.conversationId) {
        const conversation = await this.requireConversation(binding.conversationId)
        await this.assertConversationAction(revokedById, conversation, "room.grant.manage")
      } else {
        await this.assertChatAction(revokedById, "chat.grant.manage")
      }
    }

    const revoked = await this.chatLedger.revokeGrantBinding(
      bindingId,
      nowIsoString(),
      this.scopeId(),
    )
    if (
      binding.bindingState === "active" &&
      binding.scopeKind === "conversation" &&
      binding.conversationId &&
      isConversationGrantRoleId(binding.roleId)
    ) {
      await this.postConversationSystemMessage({
        conversationId: binding.conversationId,
        body: describeConversationGrantRevoked(binding.subjectId, binding.roleId),
        systemEventKind: "room-grant-revoked",
      })
    }
    return revoked
  }

  async updateConversationSettings(
    input: UpdateConversationSettingsInput,
  ): Promise<ChatConversationRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.updatedById, conversation, "room.settings.update")
    const nextTitle = input.title?.trim() || conversation.title
    const nextTopic = input.topic ?? conversation.topic
    const nextVisibility = input.visibility ?? conversation.visibility
    const nextPostingPolicy = input.postingPolicy ?? conversation.postingPolicy
    const titleChanged = nextTitle !== conversation.title
    const topicChanged = nextTopic !== conversation.topic
    const postingPolicyChanged = nextPostingPolicy !== conversation.postingPolicy
    const visibilityChanged = nextVisibility !== conversation.visibility
    if (!titleChanged && !topicChanged && !postingPolicyChanged && !visibilityChanged) {
      return conversation
    }

    const updated = await this.chatLedger.updateConversation(conversation.conversationId, {
      scopeId: this.scopeId(),
      kind: conversation.kind,
      slug: conversation.slug,
      title: nextTitle,
      topic: nextTopic,
      visibility: nextVisibility,
      postingPolicy: nextPostingPolicy,
      lifecycleState: conversation.lifecycleState,
      participantIds: conversation.participantIds,
      predecessorConversationId: conversation.predecessorConversationId,
      lineageRootConversationId: conversation.lineageRootConversationId,
      historyMode: conversation.historyMode,
      updatedAt: nowIsoString(),
    })
    if (titleChanged) {
      await this.postConversationSystemMessage({
        conversationId: conversation.conversationId,
        body: `Room renamed to "${updated.title}".`,
        systemEventKind: "room-renamed",
      })
    }
    if (topicChanged) {
      await this.postConversationSystemMessage({
        conversationId: conversation.conversationId,
        body:
          updated.topic === null ? "Room topic cleared." : `Room topic set to "${updated.topic}".`,
        systemEventKind: "room-topic-changed",
      })
    }
    if (postingPolicyChanged) {
      await this.postConversationSystemMessage({
        conversationId: conversation.conversationId,
        body: `Room posting policy changed to ${updated.postingPolicy}.`,
        systemEventKind: "room-posting-policy-changed",
      })
    }
    return updated
  }

  async archiveConversation(input: ArchiveConversationInput): Promise<ChatConversationRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.archivedById, conversation, "room.archive")
    if (conversation.lifecycleState === "archived") {
      return conversation
    }

    const archived = await this.chatLedger.updateConversation(conversation.conversationId, {
      scopeId: this.scopeId(),
      kind: conversation.kind,
      slug: conversation.slug,
      title: conversation.title,
      topic: conversation.topic,
      visibility: conversation.visibility,
      postingPolicy: conversation.postingPolicy,
      lifecycleState: "archived",
      participantIds: conversation.participantIds,
      predecessorConversationId: conversation.predecessorConversationId,
      lineageRootConversationId: conversation.lineageRootConversationId,
      historyMode: conversation.historyMode,
      updatedAt: nowIsoString(),
    })
    await this.postConversationSystemMessage({
      conversationId: conversation.conversationId,
      body: "Room archived.",
      systemEventKind: "room-archived",
    })
    return archived
  }

  async readVisibleConversations(
    input: ReadVisibleConversationsInput,
  ): Promise<ChatConversationRecord[]> {
    const access = await this.readConversationAccessState(input.actorId)
    return access.conversationRecords.filter((conversation) =>
      this.canReadConversation(access.viewerId, conversation, access),
    )
  }

  async readConversation(input: ReadConversationInput): Promise<ChatConversationRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    return conversation
  }

  async resolveConversationRef(
    input: ResolveConversationRefInput,
  ): Promise<ChatConversationRecord> {
    const normalizedRef = input.conversationRef.trim()
    if (!normalizedRef) {
      throw new Error("chat command requires --conversation <conversation-id|slug>")
    }

    const byId = await this.chatLedger.getConversationById(normalizedRef, this.scopeId())
    if (byId) {
      return byId
    }

    const bySlug = await this.chatLedger.findConversationBySlug(normalizedRef, this.scopeId())
    if (bySlug) {
      return bySlug
    }

    throw new Error(`Conversation ${normalizedRef} was not found`)
  }

  async readConversationMessages(input: ReadConversationMessagesInput): Promise<ChatMessage[]> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    return this.makeConversationService().listConversationMessages(
      {
        conversationId: conversation.conversationId,
        threadId: input.threadId ?? null,
      },
      {
        beforeMessageId: input.beforeMessageId ?? null,
        authorId: input.authorId ?? null,
        messageKind: input.messageKind ?? "all",
        limit: input.limit,
      },
    )
  }

  async searchConversationMessages(
    input: SearchConversationMessagesInput,
  ): Promise<ConversationMessageSearchResult[]> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    return this.makeConversationService().searchConversationMessages(
      {
        conversationId: conversation.conversationId,
        threadId: input.threadId ?? null,
      },
      {
        query: input.query,
        authorId: input.authorId ?? null,
        messageKind: input.messageKind ?? "all",
        limit: input.limit,
      },
    )
  }

  async readConversationRoster(
    input: ReadConversationRosterInput,
  ): Promise<ConversationRosterEntry[]> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")

    const [conversationBindings, chatBindings, memberships, attachments, participantRecords] =
      await Promise.all([
        this.chatLedger.listGrantBindings(this.scopeId(), {
          conversationId: conversation.conversationId,
        }),
        this.chatLedger.listGrantBindings(this.scopeId(), {
          scopeKind: "chat",
        }),
        this.chatLedger.listRoomMembershipRecords(this.scopeId(), {
          conversationId: conversation.conversationId,
        }),
        this.chatLedger.listConversationAttachments(this.scopeId(), {
          conversationId: conversation.conversationId,
          threadId: null,
        }),
        this.chatLedger.listParticipantRecords(this.scopeId()),
      ])

    const activeConversationBindings = conversationBindings.filter(
      (binding) => binding.bindingState === "active",
    )
    const activeAttachments = attachments.filter((attachment) => attachment.attached)
    const participantRecordsById = new Map(
      participantRecords.map((record) => [record.participantId, record] as const),
    )
    const membershipsByParticipantId = new Map(
      memberships.map((membership) => [membership.participantId, membership] as const),
    )
    const attachmentsByParticipantId = new Map(
      attachments.map((attachment) => [attachment.participantId, attachment] as const),
    )
    const conversationBindingsByParticipantId = this.groupBindingsBySubject(
      activeConversationBindings,
    )
    const chatBindingsByParticipantId = this.groupBindingsBySubject(chatBindings)
    const remainingParticipantIds = uniqueSortedIds([
      ...activeConversationBindings.map((binding) => binding.subjectId),
      ...activeAttachments.map((attachment) => attachment.participantId),
    ]).filter((participantId) => !conversation.participantIds.includes(participantId))

    return [...conversation.participantIds, ...remainingParticipantIds].map((participantId) =>
      this.toConversationRosterEntry({
        participantId,
        participant: participantRecordsById.get(participantId) ?? null,
        conversationBindings: conversationBindingsByParticipantId.get(participantId) ?? [],
        chatBindings: chatBindingsByParticipantId.get(participantId) ?? [],
        membership: membershipsByParticipantId.get(participantId) ?? null,
        attachment: attachmentsByParticipantId.get(participantId) ?? null,
        inConversation: conversation.participantIds.includes(participantId),
        conversationId: conversation.conversationId,
      }),
    )
  }

  async readConversationGrantBindings(
    input: ReadConversationGrantBindingsInput,
  ): Promise<ChatGrantBindingRecord[]> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.grant.manage")
    const bindings = await this.chatLedger.listGrantBindings(this.scopeId(), {
      conversationId: conversation.conversationId,
    })
    return input.includeRevoked
      ? bindings
      : bindings.filter((binding) => binding.bindingState === "active")
  }

  async readInbox(input: ReadInboxInput): Promise<ChatInboxEntry[]> {
    const projection = await this.readAttentionProjection(input.actorId)
    const inbox = buildChatInbox({
      viewerId: projection.viewerId,
      messages: projection.messages,
      conversations: projection.conversations,
      cursorRecords: projection.cursorRecords,
      membershipRecords: projection.membershipRecords,
    })
    return input.limit ? inbox.slice(0, input.limit) : inbox
  }

  async readFollowedThreads(input: ReadFollowedThreadsInput): Promise<ChatFollowedThread[]> {
    const projection = await this.readAttentionProjection(input.actorId)
    const followedThreads = buildChatFollowedThreads({
      viewerId: projection.viewerId,
      conversationRecords: projection.conversationRecords,
      messages: projection.messages,
      membershipRecords: projection.membershipRecords,
      cursorRecords: projection.cursorRecords,
      attachmentRecords: projection.attachmentRecords,
    })
    return input.limit ? followedThreads.slice(0, input.limit) : followedThreads
  }

  async readConversationSummaries(
    input: ReadConversationSummariesInput,
  ): Promise<ChatConversation[]> {
    const projection = await this.readAttentionProjection(input.actorId)
    const membershipsByConversationId = new Map(
      projection.membershipRecords
        .filter((membership) => membership.participantId === projection.viewerId)
        .map((membership) => [membership.conversationId, membership] as const),
    )
    const viewerBindings = projection.grantBindings.filter(
      (binding) => binding.subjectId === projection.viewerId,
    )
    const summaries = projection.conversations.filter((conversation) => {
      const record = projection.conversationRecordsById.get(conversation.conversationId) ?? null
      if (!record) {
        return false
      }
      return evaluateConversationAction({
        room: record,
        actorId: projection.viewerId,
        bindings: viewerBindings,
        membership: membershipsByConversationId.get(conversation.conversationId) ?? null,
        action: "room.read",
      }).allowed
    })
    return input.limit ? summaries.slice(0, input.limit) : summaries
  }

  async readViewerRecents(input: ReadViewerRecentsInput): Promise<ChatViewerRecentConversation[]> {
    const projection = await this.readAttentionProjection(input.actorId)
    const viewerRecents = buildChatViewerRecents({
      viewerId: projection.viewerId,
      conversations: projection.conversations,
      conversationRecords: projection.conversationRecords,
      membershipRecords: projection.membershipRecords,
      grantBindings: projection.grantBindings,
      attachmentRecords: projection.attachmentRecords,
    })
    return input.limit ? viewerRecents.slice(0, input.limit) : viewerRecents
  }

  async searchVisibleMessages(input: SearchVisibleMessagesInput) {
    const viewerId = resolveChatActorId(input.actorId)
    const [conversationRecords, messages, membershipRecords, grantBindings] = await Promise.all([
      this.chatLedger.listConversationRecords(this.scopeId()),
      this.chatLedger.listMessages(this.scopeId()),
      this.chatLedger.listRoomMembershipRecords(this.scopeId()),
      this.chatLedger.listGrantBindings(this.scopeId()),
    ])

    return searchChatVisibleMessages({
      viewerId,
      query: input.query,
      conversationRecords,
      messages,
      membershipRecords,
      grantBindings,
      limit: input.limit,
    })
  }

  async readChatEvents(input: ReadChatEventsInput): Promise<ConversationScopedChatEvent[]> {
    const afterSequence = Math.max(0, input.afterSequence ?? 0)
    const access = await this.readConversationAccessState(input.actorId)
    const readableConversationIds =
      input.conversationId != null
        ? (() => {
            const conversation = access.conversationRecords.find(
              (record) => record.conversationId === input.conversationId,
            )
            if (!conversation) {
              throw new Error(`Conversation ${input.conversationId} was not found`)
            }
            if (!this.canReadConversation(access.viewerId, conversation, access)) {
              throw new Error("Private rooms require an explicit grant")
            }
            return new Set([conversation.conversationId])
          })()
        : new Set(
            access.conversationRecords
              .filter((conversation) =>
                this.canReadConversation(access.viewerId, conversation, access),
              )
              .map((conversation) => conversation.conversationId),
          )

    const events = (await this.chatLedger.listEvents())
      .filter(isConversationScopedChatEvent)
      .filter((event) => readableConversationIds.has(event.conversationId))
      .filter((event) => event.sequence > afterSequence)

    return input.limit ? events.slice(0, input.limit) : events
  }

  async revokeConversationGrantBinding(
    input: RevokeConversationGrantBindingInput,
  ): Promise<ChatGrantBindingRecord> {
    const conversation = await this.requireConversation(input.conversationId)
    const binding = await this.chatLedger.getGrantBinding(input.bindingId, this.scopeId())
    if (!binding) {
      throw new Error(`Grant binding ${input.bindingId} was not found`)
    }
    if (
      binding.scopeKind !== "conversation" ||
      binding.conversationId !== conversation.conversationId
    ) {
      throw new Error("Grant binding does not belong to the conversation")
    }
    if (binding.bindingState === "revoked") {
      return binding
    }
    return this.revokeGrantBinding(binding.bindingId, input.actorId)
  }

  async readConversationCursor(
    input: ReadConversationCursorInput,
  ): Promise<ConversationCursorState> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    const threadId = input.threadId ?? null
    const cursor = await this.getCursorRecord(conversation.conversationId, threadId, input.actorId)
    return normalizeCursorState({
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId,
      record: cursor,
    })
  }

  async readConversationThread(
    input: ReadConversationThreadInput,
  ): Promise<ConversationThreadView> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    const rootMessage = await this.requireThreadRoot(conversation.conversationId, input.threadId)
    const scopedMessages = await this.readConversationMessages({
      conversationId: conversation.conversationId,
      actorId: input.actorId,
      threadId: input.threadId,
      beforeMessageId: input.beforeMessageId ?? null,
      authorId: input.authorId ?? null,
      messageKind: input.messageKind ?? "all",
      limit: input.limit,
    })
    const replies = scopedMessages.filter((message) => message.messageId !== rootMessage.messageId)
    const [followState, cursorState] = await Promise.all([
      this.readThreadFollowState({
        conversationId: conversation.conversationId,
        actorId: input.actorId,
        threadId: input.threadId,
      }),
      this.readConversationCursor({
        conversationId: conversation.conversationId,
        actorId: input.actorId,
        threadId: input.threadId,
      }),
    ])

    return {
      conversationId: conversation.conversationId,
      threadId: input.threadId,
      rootMessage,
      replies,
      followState,
      cursorState,
    }
  }

  async markConversationRead(input: MarkConversationReadInput): Promise<ConversationCursorState> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")

    const threadId = input.threadId ?? null
    const existing = await this.getCursorRecord(
      conversation.conversationId,
      threadId,
      input.actorId,
    )
    const scopeMessages = await this.chatLedger.listScopeMessages(this.scopeId(), {
      conversationId: conversation.conversationId,
      threadId,
    })
    const observedMessages =
      threadId === null
        ? scopeMessages.filter((message) => message.threadId === null)
        : scopeMessages.filter((message) => message.threadId === threadId)
    const scopeRevisionMessages = threadId === null ? observedMessages : scopeMessages
    const latestObserved = observedMessages.at(-1) ?? null
    const lastObservedSequence = latestObserved?.sequence ?? 0
    const lastObservedScopeSequence = latestObserved?.scopeSequence ?? 0
    const lastObservedScopeRevision = latestScopeRevision(scopeRevisionMessages)

    if (
      existing &&
      existing.lastObservedSequence === lastObservedSequence &&
      existing.lastObservedScopeSequence === lastObservedScopeSequence &&
      existing.lastObservedScopeRevision === lastObservedScopeRevision
    ) {
      return normalizeCursorState({
        participantId: input.actorId,
        conversationId: conversation.conversationId,
        threadId,
        record: existing,
      })
    }

    const updated = await this.chatLedger.upsertCursor({
      scopeId: this.scopeId(),
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId,
      lastObservedSequence,
      lastObservedScopeSequence,
      lastObservedScopeRevision,
      updatedAt: nowIsoString(),
    })
    return normalizeCursorState({
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId,
      record: updated,
    })
  }

  async readConversationWatchState(
    input: ReadConversationWatchStateInput,
  ): Promise<ConversationAttachmentState> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    const attachment = await this.getAttachmentRecord(
      conversation.conversationId,
      null,
      input.actorId,
    )
    return normalizeAttachmentState({
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId: null,
      record: attachment,
    })
  }

  async setConversationWatchState(
    input: SetConversationWatchStateInput,
  ): Promise<ConversationAttachmentState> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")

    const existing = await this.getAttachmentRecord(
      conversation.conversationId,
      null,
      input.actorId,
    )
    if (existing?.attached === input.attached) {
      return normalizeAttachmentState({
        participantId: input.actorId,
        conversationId: conversation.conversationId,
        threadId: null,
        record: existing,
      })
    }

    const updated = await this.chatLedger.upsertConversationAttachment({
      scopeId: this.scopeId(),
      conversationId: conversation.conversationId,
      threadId: null,
      participantId: input.actorId,
      attached: input.attached,
      updatedAt: nowIsoString(),
    })
    return normalizeAttachmentState({
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId: null,
      record: updated,
    })
  }

  async readThreadFollowState(
    input: ReadThreadFollowStateInput,
  ): Promise<ConversationAttachmentState> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")
    const attachment = await this.getAttachmentRecord(
      conversation.conversationId,
      input.threadId,
      input.actorId,
    )
    return normalizeAttachmentState({
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId: input.threadId,
      record: attachment,
    })
  }

  async setThreadFollowState(
    input: SetThreadFollowStateInput,
  ): Promise<ConversationAttachmentState> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "room.read")

    const existing = await this.getAttachmentRecord(
      conversation.conversationId,
      input.threadId,
      input.actorId,
    )
    if (existing?.attached === input.attached) {
      return normalizeAttachmentState({
        participantId: input.actorId,
        conversationId: conversation.conversationId,
        threadId: input.threadId,
        record: existing,
      })
    }

    const updated = await this.chatLedger.upsertConversationAttachment({
      scopeId: this.scopeId(),
      conversationId: conversation.conversationId,
      threadId: input.threadId,
      participantId: input.actorId,
      attached: input.attached,
      updatedAt: nowIsoString(),
    })
    return normalizeAttachmentState({
      participantId: input.actorId,
      conversationId: conversation.conversationId,
      threadId: input.threadId,
      record: updated,
    })
  }

  async setMessageReaction(input: SetMessageReactionInput): Promise<ChatMessage> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "message.react")
    const emoji = input.emoji.trim()
    if (!emoji) {
      throw new Error("Reaction emoji is required")
    }

    const message = await this.chatLedger.findMessageById(input.messageId, this.scopeId())
    if (!message || message.conversationId !== conversation.conversationId) {
      throw new Error(`Message ${input.messageId} was not found in the conversation`)
    }
    if (message.redactedAt) {
      throw new Error("Redacted messages cannot be mutated")
    }

    const existingReaction = message.reactions.find((reaction) => reaction.emoji === emoji) ?? null
    const hasReaction = existingReaction?.participantIds.includes(input.actorId) ?? false
    if (hasReaction === input.active) {
      return message
    }

    await this.chatLedger.setMessageReaction({
      scopeId: this.scopeId(),
      messageId: message.messageId,
      emoji,
      participant: {
        kind: "participant",
        id: input.actorId,
      },
      active: input.active,
      createdAt: nowIsoString(),
    })

    const updated = await this.chatLedger.findMessageById(message.messageId, this.scopeId())
    if (!updated) {
      throw new Error(`Message ${input.messageId} disappeared after reaction update`)
    }
    return updated
  }

  async editMessage(input: EditConversationMessageInput): Promise<ChatMessage> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "message.edit")
    const body = input.body
    if (!body.trim()) {
      throw new Error("Edited message body is required")
    }

    const message = await this.chatLedger.findMessageById(input.messageId, this.scopeId())
    if (!message || message.conversationId !== conversation.conversationId) {
      throw new Error(`Message ${input.messageId} was not found in the conversation`)
    }
    if (message.messageKind !== "participant-message") {
      throw new Error("Only participant messages can be edited")
    }
    if (message.redactedAt) {
      throw new Error("Redacted messages cannot be edited")
    }
    if (message.author.id !== input.actorId) {
      throw new Error("Only the original author can edit this message")
    }
    if (message.body === body) {
      return message
    }

    await this.chatLedger.editMessage({
      scopeId: this.scopeId(),
      messageId: message.messageId,
      editor: { kind: "participant", id: input.actorId },
      body,
      createdAt: nowIsoString(),
    })

    const updated = await this.chatLedger.findMessageById(message.messageId, this.scopeId())
    if (!updated) {
      throw new Error(`Message ${input.messageId} disappeared after edit`)
    }
    return updated
  }

  async redactMessage(input: RedactConversationMessageInput): Promise<ChatMessage> {
    const conversation = await this.requireConversation(input.conversationId)
    await this.assertConversationAction(input.actorId, conversation, "message.redact")

    const message = await this.chatLedger.findMessageById(input.messageId, this.scopeId())
    if (!message || message.conversationId !== conversation.conversationId) {
      throw new Error(`Message ${input.messageId} was not found in the conversation`)
    }
    if (message.messageKind !== "participant-message") {
      throw new Error("Only participant messages can be redacted")
    }
    if (message.redactedAt) {
      return message
    }

    const canModerate = await this.hasManagerAuthority(input.actorId, conversation)
    if (message.author.id !== input.actorId && !canModerate) {
      throw new Error("Only the author or a room manager can redact this message")
    }

    await this.chatLedger.redactMessage({
      scopeId: this.scopeId(),
      messageId: message.messageId,
      redactor: { kind: "participant", id: input.actorId },
      createdAt: nowIsoString(),
    })

    const updated = await this.chatLedger.findMessageById(message.messageId, this.scopeId())
    if (!updated) {
      throw new Error(`Message ${input.messageId} disappeared after redaction`)
    }
    return updated
  }

  async postMessage(input: PostConversationMessageInput): Promise<ChatMessage> {
    const conversation = await this.requireConversation(input.conversationId)
    const hasMassMention = normalizeMassMention(input.body)
    const senderKind = input.senderKind ?? "participant"

    if (hasMassMention && input.threadId) {
      throw new Error("Mass mention is only allowed in room mainline")
    }
    if (hasMassMention) {
      await this.assertConversationAction(input.senderId, conversation, "message.mass_mention")
    }
    await this.assertConversationAction(input.senderId, conversation, "message.create")
    if (input.audience && input.audience.kind !== "participant") {
      throw new Error("Message audience must be a participant")
    }
    if (input.audience) {
      const observation = await this.makeConversationService().observeConversation({
        conversationId: conversation.conversationId,
        threadId: input.threadId ?? null,
      })
      if (!observation.visibleParticipantIds.includes(input.audience.id)) {
        throw new Error("Audience participant is not visible in the conversation scope")
      }
    }

    return this.chatLedger.appendMessage({
      scopeId: this.scopeId(),
      conversationId: input.conversationId,
      threadId: input.threadId ?? null,
      sessionId: input.sessionId ?? makeUuidV7(),
      idempotencyKey: input.idempotencyKey ?? null,
      author: {
        kind: senderKind,
        id: input.senderId,
      },
      audience: input.audience ?? null,
      body: input.body,
      createdAt: nowIsoString(),
      relatedMessageId: input.relatedMessageId ?? null,
    })
  }

  private async requireConversation(conversationId: string): Promise<ChatConversationRecord> {
    const conversation = await this.chatLedger.getConversationById(conversationId, this.scopeId())
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} was not found`)
    }
    return conversation
  }

  private async requireThreadRoot(conversationId: string, threadId: string): Promise<ChatMessage> {
    const rootMessage = await this.chatLedger.findMessageById(threadId, this.scopeId())
    if (
      !rootMessage ||
      rootMessage.conversationId !== conversationId ||
      rootMessage.threadId !== null
    ) {
      throw new Error(
        "Thread scope requires an existing top-level root message in the same conversation",
      )
    }
    return rootMessage
  }

  private async getMembership(
    conversationId: string,
    participantId: string,
  ): Promise<ChatRoomMembershipRecord | null> {
    const memberships = await this.chatLedger.listRoomMembershipRecords(this.scopeId(), {
      conversationId,
      participantId,
    })
    return memberships.at(0) ?? null
  }

  private async getBindingsForSubject(subjectId: string): Promise<ChatGrantBindingRecord[]> {
    return this.chatLedger.listGrantBindings(this.scopeId(), { subjectId })
  }

  private async getCursorRecord(
    conversationId: string,
    threadId: string | null,
    participantId: string,
  ): Promise<ChatCursorRecord | null> {
    const records = await this.chatLedger.listCursorRecords(this.scopeId(), {
      conversationId,
      threadId,
      participantId,
    })
    return records.at(0) ?? null
  }

  private async getAttachmentRecord(
    conversationId: string,
    threadId: string | null,
    participantId: string,
  ): Promise<ChatConversationAttachmentRecord | null> {
    const records = await this.chatLedger.listConversationAttachments(this.scopeId(), {
      conversationId,
      threadId,
    })
    return records.find((record) => record.participantId === participantId) ?? null
  }

  private async evaluateConversationPermission(
    actorId: string,
    conversation: ChatConversationRecord,
    action: ConversationActionId,
  ) {
    const [bindings, membership] = await Promise.all([
      this.getBindingsForSubject(actorId),
      this.getMembership(conversation.conversationId, actorId),
    ])
    return evaluateConversationAction({
      room: conversation,
      actorId,
      bindings,
      membership,
      action,
    })
  }

  private async assertConversationAction(
    actorId: string,
    conversation: ChatConversationRecord,
    action: ConversationActionId,
  ): Promise<void> {
    const decision = await this.evaluateConversationPermission(actorId, conversation, action)
    if (!decision.allowed) {
      throw new Error(decision.reason)
    }
  }

  private async assertChatAction(actorId: string, action: ChatScopeActionId): Promise<void> {
    const bindings = await this.chatLedger.listGrantBindings(this.scopeId(), {
      subjectId: actorId,
      scopeKind: "chat",
    })
    const decision = evaluateChatAction({
      actorId,
      bindings,
      action,
    })
    if (!decision.allowed) {
      throw new Error(decision.reason)
    }
  }

  private async upsertParticipant(input: {
    participantId: string
    displayName: string
    capabilities?: ParticipantCapability[]
  }): Promise<ChatParticipantRecord> {
    const capabilities = Array.from(
      new Set((input.capabilities ?? ["chat-participant"]).filter(Boolean)),
    ) as ParticipantCapability[]
    const existing = await this.chatLedger.getParticipantRecord(input.participantId, this.scopeId())
    if (
      existing &&
      existing.displayName === input.displayName &&
      existing.capabilities.length === capabilities.length &&
      existing.capabilities.every((capability) => capabilities.includes(capability))
    ) {
      return existing
    }

    return this.chatLedger.upsertParticipant({
      scopeId: this.scopeId(),
      participantId: input.participantId,
      displayName: input.displayName,
      capabilities,
      updatedAt: nowIsoString(),
    })
  }

  private async readAttentionProjection(actorId: string): Promise<{
    viewerId: string
    conversationRecords: ChatConversationRecord[]
    conversationRecordsById: Map<string, ChatConversationRecord>
    conversations: ReturnType<typeof summarizeChatConversations>
    messages: ChatMessage[]
    membershipRecords: ChatRoomMembershipRecord[]
    cursorRecords: ChatCursorRecord[]
    attachmentRecords: ChatConversationAttachmentRecord[]
    grantBindings: ChatGrantBindingRecord[]
  }> {
    const viewerId = resolveChatActorId(actorId)
    const [
      conversationRecords,
      messages,
      membershipRecords,
      cursorRecords,
      attachmentRecords,
      grantBindings,
    ] = await Promise.all([
      this.chatLedger.listConversationRecords(this.scopeId()),
      this.chatLedger.listMessages(this.scopeId()),
      this.chatLedger.listRoomMembershipRecords(this.scopeId()),
      this.chatLedger.listCursorRecords(this.scopeId()),
      this.chatLedger.listConversationAttachments(this.scopeId()),
      this.chatLedger.listGrantBindings(this.scopeId()),
    ])
    const conversations = summarizeChatConversations({
      conversationRecords,
      messages,
      cursorRecords,
      membershipRecords,
      viewerId,
    })

    return {
      viewerId,
      conversationRecords,
      conversationRecordsById: new Map(
        conversationRecords.map((record) => [record.conversationId, record] as const),
      ),
      conversations,
      messages,
      membershipRecords,
      cursorRecords,
      attachmentRecords,
      grantBindings,
    }
  }

  private async readConversationAccessState(actorId: string): Promise<{
    viewerId: string
    conversationRecords: ChatConversationRecord[]
    chatBindings: ChatGrantBindingRecord[]
    conversationBindingsById: Map<string, ChatGrantBindingRecord[]>
    membershipsByConversationId: Map<string, ChatRoomMembershipRecord>
  }> {
    const viewerId = resolveChatActorId(actorId)
    const [conversationRecords, bindings, memberships] = await Promise.all([
      this.chatLedger.listConversationRecords(this.scopeId()),
      this.chatLedger.listGrantBindings(this.scopeId(), {
        subjectId: viewerId,
      }),
      this.chatLedger.listRoomMembershipRecords(this.scopeId(), {
        participantId: viewerId,
      }),
    ])
    const chatBindings: ChatGrantBindingRecord[] = []
    const conversationBindingsById = new Map<string, ChatGrantBindingRecord[]>()

    for (const binding of bindings) {
      if (binding.bindingState !== "active") {
        continue
      }
      if (binding.scopeKind === "chat") {
        chatBindings.push(binding)
        continue
      }
      if (!binding.conversationId) {
        continue
      }
      const bucket = conversationBindingsById.get(binding.conversationId)
      if (bucket) {
        bucket.push(binding)
        continue
      }
      conversationBindingsById.set(binding.conversationId, [binding])
    }

    return {
      viewerId,
      conversationRecords,
      chatBindings,
      conversationBindingsById,
      membershipsByConversationId: new Map(
        memberships.map((membership) => [membership.conversationId, membership] as const),
      ),
    }
  }

  private canReadConversation(
    actorId: string,
    conversation: ChatConversationRecord,
    access: {
      chatBindings: ChatGrantBindingRecord[]
      conversationBindingsById: Map<string, ChatGrantBindingRecord[]>
      membershipsByConversationId: Map<string, ChatRoomMembershipRecord>
    },
  ): boolean {
    return evaluateConversationAction({
      room: conversation,
      actorId,
      bindings: [
        ...access.chatBindings,
        ...(access.conversationBindingsById.get(conversation.conversationId) ?? []),
      ],
      membership: access.membershipsByConversationId.get(conversation.conversationId) ?? null,
      action: "room.read",
    }).allowed
  }

  private groupBindingsBySubject(
    bindings: ChatGrantBindingRecord[],
  ): Map<string, ChatGrantBindingRecord[]> {
    const grouped = new Map<string, ChatGrantBindingRecord[]>()
    for (const binding of bindings) {
      const bucket = grouped.get(binding.subjectId)
      if (bucket) {
        bucket.push(binding)
        continue
      }
      grouped.set(binding.subjectId, [binding])
    }
    return grouped
  }

  private toConversationRosterEntry(input: {
    participantId: string
    participant: ChatParticipantRecord | null
    conversationBindings: ChatGrantBindingRecord[]
    chatBindings: ChatGrantBindingRecord[]
    membership: ChatRoomMembershipRecord | null
    attachment: ChatConversationAttachmentRecord | null
    inConversation: boolean
    conversationId: string
  }): ConversationRosterEntry {
    return {
      participantId: input.participantId,
      displayName: input.participant?.displayName ?? null,
      capabilities: input.participant?.capabilities ?? [],
      conversationRoleIds: resolveConversationRoleIds(
        input.conversationBindings,
        input.conversationId,
      ),
      chatRoleIds: resolveChatRoleIds(input.chatBindings),
      membershipState: input.membership?.membershipState ?? null,
      inConversation: input.inConversation,
      watchAttached: input.attachment?.attached ?? null,
    }
  }

  private async ensureGrantBinding(input: {
    subjectId: string
    roleId: ChatRoleId
    scopeKind: "chat" | "conversation"
    conversationId: string | null
    updatedAt: string
  }): Promise<ChatGrantBindingRecord> {
    return (await this.ensureGrantBindingWithStatus(input)).binding
  }

  private async ensureGrantBindingWithStatus(input: {
    subjectId: string
    roleId: ChatRoleId
    scopeKind: "chat" | "conversation"
    conversationId: string | null
    updatedAt: string
  }): Promise<{ binding: ChatGrantBindingRecord; created: boolean }> {
    const bindings = await this.chatLedger.listGrantBindings(this.scopeId(), {
      subjectId: input.subjectId,
      ...(input.scopeKind === "conversation"
        ? { conversationId: input.conversationId }
        : { scopeKind: "chat" }),
    })
    const existing = bindings.find(
      (binding) =>
        binding.bindingState === "active" &&
        binding.roleId === input.roleId &&
        binding.scopeKind === input.scopeKind &&
        (binding.conversationId ?? null) === input.conversationId,
    )
    if (existing) {
      return { binding: existing, created: false }
    }

    return {
      binding: await this.chatLedger.createGrantBinding({
        scopeId: this.scopeId(),
        subjectId: input.subjectId,
        roleId: input.roleId,
        scopeKind: input.scopeKind,
        conversationId: input.conversationId,
        updatedAt: input.updatedAt,
      }),
      created: true,
    }
  }

  private async revokeConversationRoles(
    conversationId: string,
    subjectId: string,
    roleIds: ChatRoleId[],
  ): Promise<void> {
    const bindings = await this.chatLedger.listGrantBindings(this.scopeId(), {
      subjectId,
      conversationId,
    })
    for (const binding of bindings) {
      if (binding.bindingState !== "active" || !roleIds.includes(binding.roleId)) {
        continue
      }
      await this.chatLedger.revokeGrantBinding(binding.bindingId, nowIsoString(), this.scopeId())
    }
  }

  private async hasManagerAuthority(
    subjectId: string,
    conversation: ChatConversationRecord,
  ): Promise<boolean> {
    const decision = await this.evaluateConversationPermission(
      subjectId,
      conversation,
      "room.grant.manage",
    )
    return decision.allowed
  }

  private async listJoinedManagerIds(
    conversation: ChatConversationRecord,
    excludingParticipantId?: string,
  ): Promise<string[]> {
    const joinedParticipantIds = await this.chatLedger.listJoinedParticipantIds(
      conversation.conversationId,
      this.scopeId(),
    )
    const managerIds: string[] = []
    for (const participantId of joinedParticipantIds) {
      if (participantId === excludingParticipantId) {
        continue
      }
      if (await this.hasManagerAuthority(participantId, conversation)) {
        managerIds.push(participantId)
      }
    }
    return managerIds
  }

  private async removeParticipantFromConversation(
    conversation: ChatConversationRecord,
    participantId: string,
    lastManagerErrorMessage = "Cannot remove the last room_manager from the room",
  ): Promise<ChatConversationRecord> {
    const joinedParticipantIds = await this.chatLedger.listJoinedParticipantIds(
      conversation.conversationId,
      this.scopeId(),
    )
    const remainingParticipantIds = conversation.participantIds.filter(
      (candidateId) => candidateId !== participantId,
    )

    if (joinedParticipantIds.includes(participantId) && remainingParticipantIds.length > 0) {
      const otherManagerIds = await this.listJoinedManagerIds(conversation, participantId)
      if (
        otherManagerIds.length === 0 &&
        (await this.hasManagerAuthority(participantId, conversation))
      ) {
        throw new Error(lastManagerErrorMessage)
      }
    }

    const updatedAt = nowIsoString()
    const updated = await this.chatLedger.updateConversation(conversation.conversationId, {
      scopeId: this.scopeId(),
      kind: conversation.kind,
      slug: conversation.slug,
      title: conversation.title,
      topic: conversation.topic,
      visibility: conversation.visibility,
      postingPolicy: conversation.postingPolicy,
      lifecycleState: conversation.lifecycleState,
      participantIds: remainingParticipantIds,
      predecessorConversationId: conversation.predecessorConversationId,
      lineageRootConversationId: conversation.lineageRootConversationId,
      historyMode: conversation.historyMode,
      updatedAt,
    })

    await this.revokeConversationRoles(conversation.conversationId, participantId, [
      "participant",
      "room_manager",
    ])

    return updated
  }

  private async postConversationSystemMessage(input: {
    conversationId: string
    body: string
    systemEventKind: ChatSystemEventKind
  }): Promise<void> {
    await this.makeConversationService().postSystemMessage({
      scope: {
        conversationId: input.conversationId,
        threadId: null,
      },
      sessionId: `chat-system:${input.systemEventKind}:${makeUuidV7()}`,
      author: { kind: "system", id: "chat" },
      body: input.body,
      systemEventKind: input.systemEventKind,
    })
  }

  private makeConversationService(): ConversationService {
    return new ConversationService(this.scopeId(), this.chatLedger)
  }
}

function isConversationScopedChatEvent(
  event: ChatLedgerEvent,
): event is ConversationScopedChatEvent {
  return "conversationId" in event
}
