export type ChatParticipantKind = "participant" | "system"
export type ParticipantCapability = "chat-participant"
export type ConversationRevision = number

export interface ChatParticipantRef {
  kind: ChatParticipantKind
  id: string
  displayName?: string
}

export type ChatRoomKind = "channel" | "dm" | "group_dm"
export type ChatDirectConversationKind = Exclude<ChatRoomKind, "channel">
export type ChatConversationKind = ChatRoomKind | "thread"
export type ChatConversationSection = "channels" | "dms"
export type ChatDmGroup = "with-viewer" | "without-viewer"
export type ChatConversationVisibility = "public" | "private"
export type ChatConversationPostingPolicy = "open" | "restricted"
export type ChatConversationLifecycleState = "active" | "archived"
export type ChatConversationHistoryMode = "native" | "inherit_full"
export type ChatRoleId = "viewer" | "participant" | "room_manager" | "chat_admin"
export type ChatRoomMembershipState = "joined" | "left"
export type ChatGrantScopeKind = "chat" | "conversation"
export type ChatGrantBindingState = "active" | "revoked"
export type ChatMessageKind = "participant-message" | "system-event"
export const CHAT_REDACTED_MESSAGE_BODY = "[message redacted]"
export const CHAT_NATIVE_SYSTEM_EVENT_KINDS = [
  "participant-added",
  "participant-left",
  "room-grant-added",
  "room-grant-revoked",
  "room-renamed",
  "room-topic-changed",
  "room-posting-policy-changed",
  "room-archived",
] as const
export type ChatSystemEventKind = (typeof CHAT_NATIVE_SYSTEM_EVENT_KINDS)[number]

export interface ChatConversationRecord {
  eventType: "conversation.upserted"
  scopeId: string
  eventId: string
  sequence: number
  conversationId: string
  kind: ChatRoomKind
  section: ChatConversationSection
  slug: string | null
  title: string
  topic: string | null
  visibility: ChatConversationVisibility
  postingPolicy: ChatConversationPostingPolicy
  lifecycleState: ChatConversationLifecycleState
  participantIds: string[]
  predecessorConversationId: string | null
  lineageRootConversationId: string
  historyMode: ChatConversationHistoryMode
  createdAt: string
  updatedAt: string
}

export interface ChatConversation {
  conversationId: string
  kind: ChatRoomKind
  slug: string | null
  title: string
  topic: string | null
  visibility: ChatConversationVisibility
  postingPolicy: ChatConversationPostingPolicy
  lifecycleState: ChatConversationLifecycleState
  section: ChatConversationSection
  dmGroup: ChatDmGroup | null
  participantIds: string[]
  predecessorConversationId: string | null
  lineageRootConversationId: string
  historyMode: ChatConversationHistoryMode
  unreadCount: number
  mentionCount: number
  latestActivityAt: string | null
  latestMessagePreview: string
  messageCount: number
}

export interface ChatRoomMembership {
  conversationId: string
  participantId: string
  membershipState: ChatRoomMembershipState
}

export interface ChatRoomMembershipRecord {
  eventType: "conversation.membership.upserted"
  scopeId: string
  eventId: string
  sequence: number
  conversationId: string
  participantId: string
  membershipState: ChatRoomMembershipState
  createdAt: string
  updatedAt: string
}

export interface ChatRoomMembershipInput {
  scopeId?: string
  conversationId: string
  participantId: string
  membershipState?: ChatRoomMembershipState
  createdAt?: string
  updatedAt: string
}

export interface ChatGrantBinding {
  bindingId: string
  subjectId: string
  roleId: ChatRoleId
  scopeKind: ChatGrantScopeKind
  conversationId: string | null
  bindingState: ChatGrantBindingState
}

export interface ChatGrantBindingRecord {
  eventType: "authorization.grant-binding.upserted"
  scopeId: string
  eventId: string
  sequence: number
  bindingId: string
  subjectId: string
  roleId: ChatRoleId
  scopeKind: ChatGrantScopeKind
  conversationId: string | null
  bindingState: ChatGrantBindingState
  createdAt: string
  updatedAt: string
}

export interface ChatGrantBindingInput {
  scopeId?: string
  bindingId?: string
  subjectId: string
  roleId: ChatRoleId
  scopeKind: ChatGrantScopeKind
  conversationId?: string | null
  bindingState?: ChatGrantBindingState
  createdAt?: string
  updatedAt: string
}

export interface ChatCursorRecord {
  eventType: "conversation.cursor.updated"
  scopeId: string
  eventId: string
  sequence: number
  participantId: string
  conversationId: string
  threadId: string | null
  lastObservedSequence: number
  lastObservedScopeSequence: number
  lastObservedScopeRevision: ConversationRevision
  lastContributedSequence: number | null
  createdAt: string
  updatedAt: string
}

export interface ChatCursorInput {
  scopeId?: string
  participantId: string
  conversationId: string
  threadId?: string | null
  lastObservedSequence: number
  lastObservedScopeSequence?: number
  lastObservedScopeRevision: ConversationRevision
  lastContributedSequence?: number | null
  createdAt?: string
  updatedAt: string
}

export interface ChatConversationAttachmentRecord {
  eventType: "conversation.attachment.upserted"
  scopeId: string
  eventId: string
  sequence: number
  conversationId: string
  threadId: string | null
  participantId: string
  attached: boolean
  createdAt: string
  updatedAt: string
}

export interface ChatConversationAttachmentInput {
  scopeId?: string
  conversationId: string
  threadId?: string | null
  participantId: string
  attached?: boolean
  createdAt?: string
  updatedAt: string
}

export interface ChatConversationInput {
  scopeId?: string
  kind: ChatRoomKind
  slug?: string | null
  title: string
  topic?: string | null
  visibility?: ChatConversationVisibility
  postingPolicy?: ChatConversationPostingPolicy
  lifecycleState?: ChatConversationLifecycleState
  participantIds?: string[]
  predecessorConversationId?: string | null
  lineageRootConversationId?: string | null
  historyMode?: ChatConversationHistoryMode
  createdAt?: string
  updatedAt: string
}

export interface ChatMessage {
  eventType: "message.posted"
  scopeId: string
  messageId: string
  eventId: string
  sequence: number
  scopeSequence: number
  revision: ConversationRevision
  conversationId: string
  roomId: string
  threadId: string | null
  sessionId: string
  author: ChatParticipantRef
  audience: ChatParticipantRef | null
  content: string
  body: string
  idempotencyKey: string | null
  createdAt: string
  editedAt: string | null
  editedById: string | null
  redactedAt: string | null
  redactedById: string | null
  mentionedIds: string[]
  reactions: ChatMessageReaction[]
  relatedMessageId: string | null
  messageKind: ChatMessageKind
  systemEventKind: ChatSystemEventKind | null
}

export interface ChatMessageReaction {
  emoji: string
  participantIds: string[]
  count: number
}

export interface ChatMessageInput {
  scopeId?: string
  conversationId: string
  threadId?: string | null
  sessionId: string
  idempotencyKey?: string | null
  author: ChatParticipantRef
  audience?: ChatParticipantRef | null
  body: string
  createdAt: string
  mentionedIds?: string[]
  relatedMessageId?: string | null
  messageKind?: ChatMessageKind
  systemEventKind?: ChatSystemEventKind | null
}

interface ChatBaseParticipantRecord {
  eventType: "participant.upserted"
  scopeId: string
  eventId: string
  sequence: number
  participantId: string
  displayName: string | null
  capabilities: ParticipantCapability[]
  createdAt: string
  updatedAt: string
}

export type ChatParticipantRecord = ChatBaseParticipantRecord

interface ChatBaseParticipantUpsertInput {
  scopeId?: string
  participantId: string
  displayName?: string | null
  capabilities?: ParticipantCapability[]
  createdAt?: string
  updatedAt: string
}

export type ChatParticipantUpsertInput = ChatBaseParticipantUpsertInput

export interface ChatMessageReactionRecord {
  eventType: "message.reaction.set"
  scopeId: string
  eventId: string
  sequence: number
  messageId: string
  emoji: string
  participant: ChatParticipantRef
  active: boolean
  createdAt: string
}

export interface ChatMessageEditRecord {
  eventType: "message.edited"
  scopeId: string
  eventId: string
  sequence: number
  scopeRevision: ConversationRevision
  messageId: string
  editor: ChatParticipantRef
  body: string
  content: string
  mentionedIds: string[]
  createdAt: string
}

export interface ChatMessageRedactionRecord {
  eventType: "message.redacted"
  scopeId: string
  eventId: string
  sequence: number
  scopeRevision: ConversationRevision
  messageId: string
  redactor: ChatParticipantRef
  createdAt: string
}

export type ChatLedgerEvent =
  | ChatConversationRecord
  | ChatRoomMembershipRecord
  | ChatGrantBindingRecord
  | ChatCursorRecord
  | ChatConversationAttachmentRecord
  | ChatMessage
  | ChatParticipantRecord
  | ChatMessageReactionRecord
  | ChatMessageEditRecord
  | ChatMessageRedactionRecord

const CHAT_LEDGER_EVENT_TYPE_SET = new Set<string>([
  "conversation.upserted",
  "conversation.membership.upserted",
  "authorization.grant-binding.upserted",
  "conversation.cursor.updated",
  "conversation.attachment.upserted",
  "message.posted",
  "participant.upserted",
  "message.reaction.set",
  "message.edited",
  "message.redacted",
])

export function isChatLedgerEvent(value: unknown): value is ChatLedgerEvent {
  if (!value || typeof value !== "object") {
    return false
  }
  const eventType = Reflect.get(value, "eventType")
  return typeof eventType === "string" && CHAT_LEDGER_EVENT_TYPE_SET.has(eventType)
}

const CHAT_NATIVE_SYSTEM_EVENT_KIND_SET = new Set<string>(CHAT_NATIVE_SYSTEM_EVENT_KINDS)

function uniqueNonBlankStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function isDirectConversationKind(kind: ChatRoomKind): kind is ChatDirectConversationKind {
  return kind === "dm" || kind === "group_dm"
}

export function chatConversationIdentity(input: {
  kind: ChatRoomKind
  slug?: string | null
  participantIds?: string[]
}): string {
  if (input.kind === "channel") {
    const slug = input.slug?.trim()
    if (!slug) {
      throw new Error("Channels require a slug")
    }
    return `channel:${slug}`
  }

  const participantIds = uniqueNonBlankStrings(input.participantIds ?? []).sort()
  return `${input.kind}:${participantIds.join(",")}`
}

export function assertValidChatConversationShape(input: {
  kind: ChatRoomKind
  slug?: string | null
  participantIds?: string[]
  predecessorConversationId?: string | null
  historyMode?: ChatConversationHistoryMode
}): void {
  const slug = input.slug?.trim() || null
  const participantIds = uniqueNonBlankStrings(input.participantIds ?? [])
  const predecessorConversationId = input.predecessorConversationId?.trim() || null
  const historyMode = input.historyMode ?? defaultConversationHistoryMode(predecessorConversationId)

  if (input.kind === "channel") {
    if (!slug) {
      throw new Error("Channels require a slug")
    }
  } else {
    if (slug) {
      throw new Error("Direct rooms do not support slugs")
    }
    if (input.kind === "dm" && participantIds.length !== 2) {
      throw new Error("DM rooms require exactly 2 unique participants")
    }
    if (input.kind === "group_dm" && participantIds.length < 3) {
      throw new Error("Group DM rooms require at least 3 unique participants")
    }
  }

  if (historyMode === "inherit_full" && !predecessorConversationId) {
    throw new Error("Inherited history requires a predecessor conversation")
  }
}

export function isChatSystemEventKind(value: string): value is ChatSystemEventKind {
  return CHAT_NATIVE_SYSTEM_EVENT_KIND_SET.has(value)
}

export function assertValidChatMessageInput(input: ChatMessageInput): void {
  const messageKind = input.messageKind ?? "participant-message"
  const systemEventKind = input.systemEventKind ?? null

  if (messageKind === "system-event") {
    if (!systemEventKind) {
      throw new Error("System events require an explicit chat-native systemEventKind")
    }
    if (!isChatSystemEventKind(systemEventKind)) {
      throw new Error("System events must use a chat-native room reality kind")
    }
    return
  }

  if (systemEventKind !== null) {
    throw new Error("Participant messages cannot set a systemEventKind")
  }
}

export function assertValidChatParticipantInput(input: ChatParticipantUpsertInput): void {
  const participantId = input.participantId.trim()
  if (!participantId) {
    throw new Error("Participants require a non-empty participantId")
  }
}

export function chatConversationSection(kind: ChatRoomKind): ChatConversationSection {
  return kind === "channel" ? "channels" : "dms"
}

export function defaultConversationVisibility(kind: ChatRoomKind): ChatConversationVisibility {
  return kind === "channel" ? "public" : "private"
}

export function defaultConversationPostingPolicy(): ChatConversationPostingPolicy {
  return "open"
}

export function defaultConversationLifecycleState(): ChatConversationLifecycleState {
  return "active"
}

export function defaultConversationHistoryMode(
  predecessorConversationId?: string | null,
): ChatConversationHistoryMode {
  return predecessorConversationId ? "inherit_full" : "native"
}
