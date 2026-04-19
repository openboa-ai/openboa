import type { ChatConversationRecord } from "../../chat/core/model.js"
import type { ChatConversationProjection } from "../../chat/projections/projections.js"
import type { ChatProjectedMessage, ChatSurface } from "../../chat/view-model.js"
import { buildChatTranscriptView, openFollowedThread } from "../chat/index.js"

export function makeConversationRecord(
  input: Partial<ChatConversationRecord> & {
    conversationId: string
    title: string
    kind?: ChatConversationRecord["kind"]
  },
): ChatConversationRecord {
  const kind = input.kind ?? "channel"
  return {
    eventType: "conversation.upserted",
    scopeId: "chat",
    eventId: input.eventId ?? `${input.conversationId}-event`,
    sequence: input.sequence ?? 1,
    conversationId: input.conversationId,
    kind,
    section: input.section ?? (kind === "channel" ? "channels" : "dms"),
    slug: input.slug ?? (kind === "channel" ? input.conversationId : null),
    title: input.title,
    topic: input.topic ?? null,
    visibility: input.visibility ?? (kind === "channel" ? "public" : "private"),
    postingPolicy: input.postingPolicy ?? "open",
    lifecycleState: input.lifecycleState ?? "active",
    participantIds: input.participantIds ?? ["founder", "alpha", "beta"],
    predecessorConversationId: input.predecessorConversationId ?? null,
    lineageRootConversationId: input.lineageRootConversationId ?? input.conversationId,
    historyMode: input.historyMode ?? "native",
    createdAt: input.createdAt ?? "2026-04-06T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-06T00:00:00.000Z",
  }
}

export function makeProjectedMessage(
  input: Partial<ChatProjectedMessage> & {
    messageId: string
    conversationId: string
    body: string
  },
): ChatProjectedMessage {
  return {
    eventType: "message.posted",
    scopeId: "chat",
    messageId: input.messageId,
    eventId: input.eventId ?? `${input.messageId}-event`,
    sequence: input.sequence ?? 1,
    scopeSequence: input.scopeSequence ?? 1,
    revision: input.revision ?? 1,
    conversationId: input.conversationId,
    roomId: input.roomId ?? input.conversationId,
    threadId: input.threadId ?? null,
    sessionId: input.sessionId ?? "session-1",
    author: input.author ?? { kind: "participant", id: "founder" },
    audience: input.audience ?? null,
    content: input.content ?? input.body,
    body: input.body,
    createdAt: input.createdAt ?? "2026-04-06T00:00:00.000Z",
    editedAt: input.editedAt ?? null,
    editedById: input.editedById ?? null,
    redactedAt: input.redactedAt ?? null,
    redactedById: input.redactedById ?? null,
    mentionedIds: input.mentionedIds ?? [],
    reactions: input.reactions ?? [],
    relatedMessageId: input.relatedMessageId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    messageKind: input.messageKind ?? "participant-message",
    systemEventKind: input.systemEventKind ?? null,
    threadReplyCount: input.threadReplyCount,
    threadPreview: input.threadPreview ?? null,
    threadPreviewAuthorId: input.threadPreviewAuthorId ?? null,
    threadLastReplyAt: input.threadLastReplyAt ?? null,
  }
}

const generalConversationRecord = makeConversationRecord({
  conversationId: "general",
  title: "general",
})

const generalRoot = makeProjectedMessage({
  messageId: "general-root",
  conversationId: "general",
  body: "We should land the customer-quality pass before tomorrow morning.",
  threadReplyCount: 2,
  threadPreview: "I can take the reliability thread.",
  threadPreviewAuthorId: "alpha",
  threadLastReplyAt: "2026-04-06T09:18:00.000Z",
})

const generalSecond = makeProjectedMessage({
  messageId: "general-second",
  conversationId: "general",
  body: "@founder Please turn the open review comments into a final checklist.",
  mentionedIds: ["founder"],
  createdAt: "2026-04-06T09:12:00.000Z",
})

const generalThreadReply = makeProjectedMessage({
  messageId: "general-thread-reply",
  conversationId: "general",
  threadId: "general-root",
  body: "I can take the reliability thread.",
  author: { kind: "participant", id: "alpha" },
  createdAt: "2026-04-06T09:18:00.000Z",
})

const generalProjection: ChatConversationProjection = {
  conversationMessages: [generalRoot, generalSecond, generalThreadReply],
  mainTranscript: [generalRoot, generalSecond],
  activeThreadRoot: generalRoot,
  activeThreadMessages: [generalThreadReply],
}

export const chatSeedTranscriptView = buildChatTranscriptView({
  actorId: "founder",
  conversation: generalConversationRecord,
  projection: generalProjection,
  openIntent: openFollowedThread({
    conversationId: "general",
    conversationTitle: "general",
    threadRootMessageId: "general-root",
    threadRootPreview: generalRoot.body,
    latestReplyAt: generalThreadReply.createdAt,
    latestReplyPreview: generalThreadReply.body,
    unreadReplyCount: 2,
    unreadMentionCount: 0,
  }),
  canPostMessage: true,
  accessGrants: [
    {
      bindingId: "general:founder:room_manager",
      subjectId: "founder",
      roleId: "room_manager",
    },
  ],
})

export const chatSeedSurface: ChatSurface = {
  activeConversationId: "general",
  activeConversation: {
    conversationId: "general",
    kind: "channel",
    slug: "general",
    title: "general",
    topic: "Daily coordination",
    visibility: "public",
    postingPolicy: "open",
    lifecycleState: "active",
    section: "channels",
    dmGroup: null,
    participantIds: ["founder", "alpha", "beta"],
    predecessorConversationId: null,
    lineageRootConversationId: "general",
    historyMode: "native",
    unreadCount: 3,
    mentionCount: 1,
    latestActivityAt: "2026-04-06T09:18:00.000Z",
    latestMessagePreview: generalSecond.body,
    messageCount: 18,
  },
  sidebar: {
    inbox: [
      {
        entryId: "mention:general-second",
        kind: "mention",
        title: "Mention in general",
        preview: generalSecond.body,
        conversationId: "general",
        messageId: "general-second",
        createdAt: generalSecond.createdAt,
      },
    ],
    followedThreads: [
      {
        entryId: "thread:general:general-root",
        title: "general",
        preview: generalThreadReply.body,
        conversationId: "general",
        threadRootMessageId: "general-root",
        unreadReplyCount: 2,
        unreadMentionCount: 0,
        latestReplyAt: generalThreadReply.createdAt,
      },
    ],
    channels: [
      {
        conversationId: "general",
        kind: "channel",
        slug: "general",
        title: "general",
        topic: "Daily coordination",
        visibility: "public",
        postingPolicy: "open",
        lifecycleState: "active",
        section: "channels",
        dmGroup: null,
        participantIds: ["founder", "alpha", "beta"],
        predecessorConversationId: null,
        lineageRootConversationId: "general",
        historyMode: "native",
        unreadCount: 3,
        mentionCount: 1,
        latestActivityAt: "2026-04-06T09:18:00.000Z",
        latestMessagePreview: generalSecond.body,
        messageCount: 18,
      },
      {
        conversationId: "ops",
        kind: "channel",
        slug: "ops",
        title: "ops",
        topic: "Ops status",
        visibility: "private",
        postingPolicy: "restricted",
        lifecycleState: "active",
        section: "channels",
        dmGroup: null,
        participantIds: ["founder", "alpha"],
        predecessorConversationId: null,
        lineageRootConversationId: "ops",
        historyMode: "native",
        unreadCount: 0,
        mentionCount: 0,
        latestActivityAt: "2026-04-06T08:57:00.000Z",
        latestMessagePreview: "Infra checklist is green.",
        messageCount: 11,
      },
    ],
    dmGroups: [
      {
        id: "with-viewer",
        label: "With You",
        conversations: [
          {
            conversationId: "dm-alpha",
            kind: "dm",
            slug: null,
            title: "Alpha",
            topic: null,
            visibility: "private",
            postingPolicy: "open",
            lifecycleState: "active",
            section: "dms",
            dmGroup: "with-viewer",
            participantIds: ["founder", "alpha"],
            predecessorConversationId: null,
            lineageRootConversationId: "dm-alpha",
            historyMode: "native",
            unreadCount: 1,
            mentionCount: 0,
            latestActivityAt: "2026-04-06T09:08:00.000Z",
            latestMessagePreview: "I can summarize the release risk thread.",
            messageCount: 6,
          },
        ],
      },
      {
        id: "without-viewer",
        label: "Others",
        conversations: [
          {
            conversationId: "dm-sam",
            kind: "dm",
            slug: null,
            title: "Sam + Alpha",
            topic: null,
            visibility: "private",
            postingPolicy: "open",
            lifecycleState: "active",
            section: "dms",
            dmGroup: "without-viewer",
            participantIds: ["alpha", "sam"],
            predecessorConversationId: null,
            lineageRootConversationId: "dm-sam",
            historyMode: "native",
            unreadCount: 0,
            mentionCount: 0,
            latestActivityAt: "2026-04-06T07:40:00.000Z",
            latestMessagePreview: "Let's review the launch note after lunch.",
            messageCount: 3,
          },
        ],
      },
    ],
    viewerRecents: [
      {
        entryId: "viewer:finance-private",
        title: "finance-private",
        preview: "quiet viewer room",
        conversationId: "finance-private",
        observedAt: "2026-04-06T09:25:00.000Z",
      },
    ],
  },
  transcript: chatSeedTranscriptView.transcript,
  activeThreadRoot: chatSeedTranscriptView.threadDrawer.rootMessage,
  activeThreadMessages: chatSeedTranscriptView.threadDrawer.messages,
  composerPlaceholder: chatSeedTranscriptView.composer.placeholder,
}
