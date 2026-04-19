import { resolveChatActorId } from "../actor-id.js"
import type {
  ChatConversation,
  ChatConversationAttachmentRecord,
  ChatConversationHistoryMode,
  ChatConversationRecord,
  ChatCursorRecord,
  ChatDmGroup,
  ChatGrantBindingRecord,
  ChatMessage,
  ChatRoomMembershipRecord,
} from "../core/model.js"
import {
  defaultConversationHistoryMode,
  defaultConversationLifecycleState,
  defaultConversationPostingPolicy,
  defaultConversationVisibility,
} from "../core/model.js"
import { evaluateConversationAction } from "../policy/authorization.js"
import type { ChatInboxEntry, ChatProjectedMessage } from "../view-model.js"

export interface ChatConversationProjection {
  conversationMessages: ChatMessage[]
  mainTranscript: ChatProjectedMessage[]
  activeThreadRoot: ChatProjectedMessage | null
  activeThreadMessages: ChatProjectedMessage[]
}

export interface ChatFollowedThread {
  conversationId: string
  conversationTitle: string
  threadRootMessageId: string
  threadRootPreview: string
  latestReplyAt: string | null
  latestReplyPreview: string | null
  unreadReplyCount: number
  unreadMentionCount: number
}

export interface ChatViewerRecentConversation {
  conversationId: string
  title: string
  kind: ChatConversation["kind"]
  observedAt: string
  latestActivityAt: string | null
  latestMessagePreview: string
}

export interface ChatSearchResult {
  messageId: string
  sourceConversationId: string
  openConversationId: string
  openMode: "joined" | "viewer"
  threadId: string | null
  conversationTitle: string
  preview: string
  createdAt: string
  score: number
}

interface LineageConversationRef {
  predecessorConversationId: string | null
  historyMode: ChatConversationHistoryMode
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function summarizeText(value: string, maxLength = 72): string {
  const normalized = value.replace(/\s+/gu, " ").trim()
  if (!normalized) {
    return "Untitled conversation"
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized
}

function directConversationKind(participantIds: string[]): "dm" | "group_dm" {
  const participants = unique(participantIds)
  return participants.length > 2 ? "group_dm" : "dm"
}

function directConversationGroup(participantIds: string[], viewerId: string): ChatDmGroup {
  const participants = unique(participantIds)
  return participants.includes(viewerId) ? "with-viewer" : "without-viewer"
}

function lineageConversationIds<T extends LineageConversationRef>(
  conversationId: string,
  recordsById: Map<string, T>,
): string[] {
  const orderedIds: string[] = []
  const seen = new Set<string>()
  let currentId: string | null = conversationId

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    orderedIds.unshift(currentId)
    const current: T | null = recordsById.get(currentId) ?? null
    if (!current || current.historyMode !== "inherit_full") {
      break
    }
    currentId = current.predecessorConversationId
  }

  return orderedIds
}

function cursorScopeKey(conversationId: string, threadId: string | null): string {
  return `${conversationId}::${threadId ?? "root"}`
}

function attachmentScopeKey(conversationId: string, threadId: string | null): string {
  return `${conversationId}::${threadId ?? "root"}`
}

function buildViewerCursorMap(
  cursorRecords: ChatCursorRecord[],
  viewerId: string,
): Map<string, ChatCursorRecord> {
  return new Map(
    cursorRecords
      .filter((cursor) => cursor.participantId === viewerId)
      .map(
        (cursor) =>
          [cursorScopeKey(cursor.conversationId, cursor.threadId ?? null), cursor] as const,
      ),
  )
}

function buildViewerAttachmentMap(
  attachmentRecords: ChatConversationAttachmentRecord[],
  viewerId: string,
): Map<string, ChatConversationAttachmentRecord> {
  return new Map(
    attachmentRecords
      .filter((record) => record.participantId === viewerId)
      .map(
        (record) =>
          [attachmentScopeKey(record.conversationId, record.threadId ?? null), record] as const,
      ),
  )
}

function lastObservedScopeSequence(
  viewerCursorMap: Map<string, ChatCursorRecord>,
  conversationId: string,
  threadId: string | null,
): number {
  return (
    viewerCursorMap.get(cursorScopeKey(conversationId, threadId))?.lastObservedScopeSequence ?? 0
  )
}

function joinedConversationIds(
  membershipRecords: ChatRoomMembershipRecord[],
  viewerId: string,
): Set<string> {
  return new Set(
    membershipRecords
      .filter(
        (membership) =>
          membership.participantId === viewerId && membership.membershipState === "joined",
      )
      .map((membership) => membership.conversationId),
  )
}

function membershipByConversationId(
  membershipRecords: ChatRoomMembershipRecord[],
  viewerId: string,
): Map<string, ChatRoomMembershipRecord> {
  return new Map(
    membershipRecords
      .filter((membership) => membership.participantId === viewerId)
      .map((membership) => [membership.conversationId, membership] as const),
  )
}

function normalizeSearchQuery(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
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

function isUnreadMessageForViewer(
  message: ChatMessage,
  viewerId: string,
  viewerCursorMap: Map<string, ChatCursorRecord>,
): boolean {
  if (message.author.kind === "system" || message.author.id === viewerId) {
    return false
  }
  return (
    message.scopeSequence >
    lastObservedScopeSequence(viewerCursorMap, message.conversationId, message.threadId ?? null)
  )
}

function canReadConversation(input: {
  viewerId: string
  conversation: ChatConversationRecord
  grantBindings: ChatGrantBindingRecord[]
  membership: ChatRoomMembershipRecord | null
}): boolean {
  return evaluateConversationAction({
    room: input.conversation,
    actorId: input.viewerId,
    bindings: input.grantBindings.filter((binding) => binding.subjectId === input.viewerId),
    membership: input.membership,
    action: "room.read",
  }).allowed
}

function followStateForThread(input: {
  viewerId: string
  conversationId: string
  threadRoot: ChatMessage
  replies: ChatMessage[]
  viewerIsJoined: boolean
  viewerAttachmentMap: Map<string, ChatConversationAttachmentRecord>
}): boolean {
  if (!input.viewerIsJoined || input.replies.length === 0) {
    return false
  }

  const explicitAttachment =
    input.viewerAttachmentMap.get(
      attachmentScopeKey(input.conversationId, input.threadRoot.messageId),
    ) ?? null
  if (explicitAttachment && !explicitAttachment.attached) {
    return false
  }
  if (explicitAttachment?.attached) {
    return true
  }

  if (input.threadRoot.author.kind !== "system" && input.threadRoot.author.id === input.viewerId) {
    return true
  }

  return input.replies.some(
    (reply) =>
      (reply.author.kind !== "system" && reply.author.id === input.viewerId) ||
      reply.mentionedIds.includes(input.viewerId),
  )
}

function candidateSearchPriority(candidate: {
  openMode: "joined" | "viewer"
  lineageDepth: number
  createdAt: string
}): [number, number, string] {
  return [candidate.openMode === "joined" ? 1 : 0, candidate.lineageDepth, candidate.createdAt]
}

function isBetterSearchCandidate(
  candidate: {
    openMode: "joined" | "viewer"
    lineageDepth: number
    createdAt: string
  },
  current: {
    openMode: "joined" | "viewer"
    lineageDepth: number
    createdAt: string
  },
): boolean {
  const [candidateMode, candidateDepth, candidateCreatedAt] = candidateSearchPriority(candidate)
  const [currentMode, currentDepth, currentCreatedAt] = candidateSearchPriority(current)
  if (candidateMode !== currentMode) {
    return candidateMode > currentMode
  }
  if (candidateDepth !== currentDepth) {
    return candidateDepth > currentDepth
  }
  return candidateCreatedAt > currentCreatedAt
}

export function summarizeChatConversations(input: {
  conversationRecords: ChatConversationRecord[]
  messages: ChatMessage[]
  cursorRecords?: ChatCursorRecord[]
  membershipRecords?: ChatRoomMembershipRecord[]
  viewerId?: string
}): ChatConversation[] {
  const viewerId = resolveChatActorId(input.viewerId)
  const viewerCursorMap = buildViewerCursorMap(input.cursorRecords ?? [], viewerId)
  const joinedConversationIdSet = joinedConversationIds(input.membershipRecords ?? [], viewerId)
  const recordsById = new Map(
    input.conversationRecords.map((record) => [record.conversationId, record] as const),
  )
  const grouped = new Map<string, ChatMessage[]>()

  for (const message of input.messages) {
    const bucket = grouped.get(message.conversationId)
    if (bucket) {
      bucket.push(message)
    } else {
      grouped.set(message.conversationId, [message])
    }
  }

  for (const record of input.conversationRecords) {
    if (!grouped.has(record.conversationId)) {
      grouped.set(record.conversationId, [])
    }
  }

  return Array.from(grouped.entries())
    .map(([conversationId, conversationMessages]) => {
      const record = recordsById.get(conversationId) ?? null
      const lineageIds = record
        ? lineageConversationIds(conversationId, recordsById)
        : [conversationId]
      const effectiveConversationMessages = record
        ? input.messages.filter((message) => lineageIds.includes(message.conversationId))
        : conversationMessages
      const unreadMainlineMessages = joinedConversationIdSet.has(conversationId)
        ? effectiveConversationMessages.filter(
            (message) =>
              message.threadId === null &&
              isUnreadMessageForViewer(message, viewerId, viewerCursorMap),
          )
        : []
      const latest = effectiveConversationMessages.at(-1) ?? null
      const participantIds =
        record != null
          ? [...record.participantIds]
          : unique(
              conversationMessages.flatMap((message) => [
                message.author.kind === "system" ? "" : message.author.id,
                message.audience?.kind === "participant" ? message.audience.id : "",
              ]),
            )
      const kind =
        record?.kind ??
        (participantIds.length > 0 ? directConversationKind(participantIds) : "channel")
      const isDirect = kind !== "channel"
      const title =
        record?.title ??
        (isDirect
          ? participantIds.length <= 1
            ? (participantIds[0] ?? conversationId)
            : participantIds.join(" + ")
          : conversationId)

      return {
        conversationId,
        kind,
        slug: record?.slug ?? null,
        title,
        topic: record?.topic ?? null,
        visibility:
          record?.visibility ?? defaultConversationVisibility(record?.kind ?? kind ?? "channel"),
        postingPolicy: record?.postingPolicy ?? defaultConversationPostingPolicy(),
        lifecycleState: record?.lifecycleState ?? defaultConversationLifecycleState(),
        section: record?.section ?? (isDirect ? "dms" : "channels"),
        dmGroup: isDirect ? directConversationGroup(participantIds, viewerId) : null,
        participantIds,
        predecessorConversationId: record?.predecessorConversationId ?? null,
        lineageRootConversationId: record?.lineageRootConversationId ?? conversationId,
        historyMode:
          record?.historyMode ??
          defaultConversationHistoryMode(record?.predecessorConversationId ?? null),
        unreadCount: unreadMainlineMessages.length,
        mentionCount: unreadMainlineMessages.filter((message) =>
          message.mentionedIds.includes(viewerId),
        ).length,
        latestActivityAt: latest?.createdAt ?? null,
        latestMessagePreview: latest?.body ?? "No activity yet.",
        messageCount: effectiveConversationMessages.length,
      } satisfies ChatConversation
    })
    .sort((left, right) => {
      const timeCompare = (right.latestActivityAt ?? "").localeCompare(left.latestActivityAt ?? "")
      if (timeCompare !== 0) {
        return timeCompare
      }
      if (left.section !== right.section) {
        return left.section === "channels" ? -1 : 1
      }
      return left.title.localeCompare(right.title)
    })
}

export function decorateTranscript(messages: ChatMessage[]): ChatProjectedMessage[] {
  return messages.map((message) => ({
    ...message,
  }))
}

export function decorateMessagesWithThreadSummaries(
  mainTranscript: ChatMessage[],
  conversationMessages: ChatMessage[],
): ChatProjectedMessage[] {
  return decorateTranscript(mainTranscript).map((message) => {
    const replies = conversationMessages.filter(
      (candidate) => candidate.threadId === message.messageId,
    )
    const latestReply = replies.at(-1) ?? null
    return {
      ...message,
      threadReplyCount: replies.length,
      threadPreview: latestReply ? summarizeText(latestReply.body, 84) : null,
      threadPreviewAuthorId: latestReply?.author.id ?? null,
      threadLastReplyAt: latestReply?.createdAt ?? null,
    }
  })
}

export function buildChatInbox(input: {
  viewerId: string
  messages: ChatMessage[]
  conversations: ChatConversation[]
  cursorRecords?: ChatCursorRecord[]
  membershipRecords?: ChatRoomMembershipRecord[]
}): ChatInboxEntry[] {
  const viewerId = resolveChatActorId(input.viewerId)
  const titleByConversationId = new Map(
    input.conversations.map((conversation) => [conversation.conversationId, conversation.title]),
  )
  const conversationsById = new Map(
    input.conversations.map((conversation) => [conversation.conversationId, conversation] as const),
  )
  const viewerCursorMap = buildViewerCursorMap(input.cursorRecords ?? [], viewerId)
  const joinedConversationIdSet = joinedConversationIds(input.membershipRecords ?? [], viewerId)
  const mentionEntries = input.messages
    .filter((message) => {
      const conversation = conversationsById.get(message.conversationId)
      if (!conversation || conversation.kind !== "channel") {
        return false
      }
      if (!joinedConversationIdSet.has(conversation.conversationId)) {
        return false
      }
      if (!message.mentionedIds.includes(viewerId)) {
        return false
      }
      return isUnreadMessageForViewer(message, viewerId, viewerCursorMap)
    })
    .map((message) => ({
      entryId: `mention:${message.messageId}`,
      kind: "mention" as const,
      title: `Mention in ${titleByConversationId.get(message.conversationId) ?? "chat"}`,
      preview: summarizeText(message.body, 96),
      conversationId: message.conversationId,
      messageId: message.messageId,
      createdAt: message.createdAt,
    }))
  const directEntries: ChatInboxEntry[] = []
  for (const conversation of input.conversations) {
    if (
      conversation.kind === "channel" ||
      !joinedConversationIdSet.has(conversation.conversationId) ||
      conversation.unreadCount <= 0
    ) {
      continue
    }
    const lineageIds = lineageConversationIds(conversation.conversationId, conversationsById)
    const latestUnreadMessage =
      input.messages
        .filter(
          (message) =>
            message.threadId === null &&
            lineageIds.includes(message.conversationId) &&
            isUnreadMessageForViewer(message, viewerId, viewerCursorMap),
        )
        .at(-1) ?? null
    if (!latestUnreadMessage) {
      continue
    }
    directEntries.push({
      entryId: `direct:${conversation.conversationId}`,
      kind: "direct",
      title: conversation.title,
      preview: summarizeText(latestUnreadMessage.body, 96),
      conversationId: conversation.conversationId,
      messageId: latestUnreadMessage.messageId,
      createdAt: latestUnreadMessage.createdAt,
    })
  }

  return [...directEntries, ...mentionEntries].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )
}

export function buildChatFollowedThreads(input: {
  viewerId: string
  conversationRecords: ChatConversationRecord[]
  messages: ChatMessage[]
  membershipRecords: ChatRoomMembershipRecord[]
  cursorRecords: ChatCursorRecord[]
  attachmentRecords: ChatConversationAttachmentRecord[]
}): ChatFollowedThread[] {
  const viewerId = resolveChatActorId(input.viewerId)
  const conversationById = new Map(
    input.conversationRecords.map(
      (conversation) => [conversation.conversationId, conversation] as const,
    ),
  )
  const joinedConversationIdSet = joinedConversationIds(input.membershipRecords, viewerId)
  const viewerCursorMap = buildViewerCursorMap(input.cursorRecords, viewerId)
  const viewerAttachmentMap = buildViewerAttachmentMap(input.attachmentRecords, viewerId)
  const results: ChatFollowedThread[] = []

  for (const threadRoot of input.messages.filter((message) => message.threadId === null)) {
    const conversation = conversationById.get(threadRoot.conversationId)
    if (!conversation) {
      continue
    }
    const replies = input.messages
      .filter(
        (message) =>
          message.conversationId === threadRoot.conversationId &&
          message.threadId === threadRoot.messageId,
      )
      .sort(
        (left, right) => left.scopeSequence - right.scopeSequence || left.sequence - right.sequence,
      )
    if (
      !followStateForThread({
        viewerId,
        conversationId: threadRoot.conversationId,
        threadRoot,
        replies,
        viewerIsJoined: joinedConversationIdSet.has(threadRoot.conversationId),
        viewerAttachmentMap,
      })
    ) {
      continue
    }

    const unreadReplies = replies.filter((reply) =>
      isUnreadMessageForViewer(reply, viewerId, viewerCursorMap),
    )
    const latestReply = replies.at(-1) ?? null

    results.push({
      conversationId: threadRoot.conversationId,
      conversationTitle: conversation.title,
      threadRootMessageId: threadRoot.messageId,
      threadRootPreview: summarizeText(threadRoot.body, 96),
      latestReplyAt: latestReply?.createdAt ?? null,
      latestReplyPreview: latestReply ? summarizeText(latestReply.body, 96) : null,
      unreadReplyCount: unreadReplies.length,
      unreadMentionCount: unreadReplies.filter((reply) => reply.mentionedIds.includes(viewerId))
        .length,
    })
  }

  return results.sort((left, right) => {
    const activityCompare = (right.latestReplyAt ?? "").localeCompare(left.latestReplyAt ?? "")
    if (activityCompare !== 0) {
      return activityCompare
    }
    return left.threadRootMessageId.localeCompare(right.threadRootMessageId)
  })
}

export function buildChatViewerRecents(input: {
  viewerId: string
  conversations: ChatConversation[]
  conversationRecords: ChatConversationRecord[]
  membershipRecords: ChatRoomMembershipRecord[]
  grantBindings: ChatGrantBindingRecord[]
  attachmentRecords: ChatConversationAttachmentRecord[]
}): ChatViewerRecentConversation[] {
  const viewerId = resolveChatActorId(input.viewerId)
  const membershipMap = membershipByConversationId(input.membershipRecords, viewerId)
  const conversationById = new Map(
    input.conversations.map((conversation) => [conversation.conversationId, conversation] as const),
  )
  const recordById = new Map(
    input.conversationRecords.map((record) => [record.conversationId, record] as const),
  )

  return input.attachmentRecords
    .filter((record) => record.participantId === viewerId)
    .filter((record) => record.threadId === null && record.attached)
    .filter(
      (record) =>
        !joinedConversationIds(input.membershipRecords, viewerId).has(record.conversationId),
    )
    .filter((record) => {
      const conversation = recordById.get(record.conversationId)
      if (!conversation) {
        return false
      }
      return canReadConversation({
        viewerId,
        conversation,
        grantBindings: input.grantBindings,
        membership: membershipMap.get(record.conversationId) ?? null,
      })
    })
    .map((record) => {
      const conversation = conversationById.get(record.conversationId)
      const fallbackConversation = recordById.get(record.conversationId)
      if (!conversation || !fallbackConversation) {
        return null
      }
      return {
        conversationId: conversation.conversationId,
        title: conversation.title,
        kind: conversation.kind,
        observedAt: record.updatedAt,
        latestActivityAt: conversation.latestActivityAt,
        latestMessagePreview: conversation.latestMessagePreview,
      } satisfies ChatViewerRecentConversation
    })
    .filter((conversation): conversation is ChatViewerRecentConversation => conversation != null)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
}

export function searchChatVisibleMessages(input: {
  viewerId: string
  query: string
  conversationRecords: ChatConversationRecord[]
  messages: ChatMessage[]
  membershipRecords: ChatRoomMembershipRecord[]
  grantBindings: ChatGrantBindingRecord[]
  limit?: number
}): ChatSearchResult[] {
  const viewerId = resolveChatActorId(input.viewerId)
  const terms = normalizeSearchQuery(input.query)
  if (terms.length === 0) {
    return []
  }

  const limit = Math.max(1, input.limit ?? 20)
  const membershipMap = membershipByConversationId(input.membershipRecords, viewerId)
  const joinedConversationIdSet = joinedConversationIds(input.membershipRecords, viewerId)
  const recordsById = new Map(
    input.conversationRecords.map((record) => [record.conversationId, record] as const),
  )
  const candidatesByMessageId = new Map<string, ChatSearchResult & { lineageDepth: number }>()

  for (const conversation of input.conversationRecords) {
    if (
      !canReadConversation({
        viewerId,
        conversation,
        grantBindings: input.grantBindings,
        membership: membershipMap.get(conversation.conversationId) ?? null,
      })
    ) {
      continue
    }

    const lineageIds = lineageConversationIds(conversation.conversationId, recordsById)
    const openMode: "joined" | "viewer" = joinedConversationIdSet.has(conversation.conversationId)
      ? "joined"
      : "viewer"
    const lineageDepth = lineageIds.length

    for (const message of input.messages) {
      if (!lineageIds.includes(message.conversationId)) {
        continue
      }
      const score = scoreSearchResult(message, terms)
      if (score <= 0) {
        continue
      }

      const candidate = {
        messageId: message.messageId,
        sourceConversationId: message.conversationId,
        openConversationId: conversation.conversationId,
        openMode,
        threadId: message.threadId,
        conversationTitle: conversation.title,
        preview: summarizeText(message.body, 96),
        createdAt: message.createdAt,
        score,
        lineageDepth,
      }
      const current = candidatesByMessageId.get(message.messageId)
      if (
        !current ||
        score > current.score ||
        (score === current.score &&
          isBetterSearchCandidate(
            {
              openMode: candidate.openMode,
              lineageDepth: candidate.lineageDepth,
              createdAt: candidate.createdAt,
            },
            {
              openMode: current.openMode,
              lineageDepth: current.lineageDepth,
              createdAt: current.createdAt,
            },
          ))
      ) {
        candidatesByMessageId.set(message.messageId, candidate)
      }
    }
  }

  return Array.from(candidatesByMessageId.values())
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.createdAt.localeCompare(left.createdAt)
    })
    .slice(0, limit)
    .map(({ lineageDepth: _lineageDepth, ...result }) => result)
}

export function buildChatConversationProjection(input: {
  activeConversationId: string
  activeThreadId: string | null
  conversationRecords: ChatConversationRecord[]
  messages: ChatMessage[]
}): ChatConversationProjection {
  const recordsById = new Map(
    input.conversationRecords.map((record) => [record.conversationId, record] as const),
  )
  const activeLineageIds = new Set(lineageConversationIds(input.activeConversationId, recordsById))
  const conversationMessages = input.messages.filter((message) =>
    activeLineageIds.has(message.conversationId),
  )
  const mainTranscript = conversationMessages.filter((message) => message.threadId === null)
  const decoratedMainTranscript = decorateMessagesWithThreadSummaries(
    mainTranscript,
    conversationMessages,
  )
  const activeThreadRoot = input.activeThreadId
    ? (decoratedMainTranscript.find((message) => message.messageId === input.activeThreadId) ??
      conversationMessages.find((message) => message.messageId === input.activeThreadId) ??
      null)
    : null
  const activeThreadMessages = input.activeThreadId
    ? decorateTranscript(
        conversationMessages.filter((message) => message.threadId === input.activeThreadId),
      )
    : []
  return {
    conversationMessages,
    mainTranscript: decoratedMainTranscript,
    activeThreadRoot,
    activeThreadMessages,
  }
}
