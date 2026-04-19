import { describe, expect, it } from "vitest"
import type {
  ChatConversationAttachmentRecord,
  ChatConversationRecord,
  ChatCursorRecord,
  ChatGrantBindingRecord,
  ChatMessage,
  ChatRoomMembershipRecord,
} from "../src/chat/core/model.js"
import {
  buildChatConversationProjection,
  buildChatFollowedThreads,
  buildChatInbox,
  buildChatViewerRecents,
  searchChatVisibleMessages,
  summarizeChatConversations,
} from "../src/chat/projections/projections.js"

function makeConversation(
  input: Partial<ChatConversationRecord> & {
    conversationId: string
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
    title: input.title ?? input.conversationId,
    topic: input.topic ?? null,
    visibility: input.visibility ?? (kind === "channel" ? "public" : "private"),
    postingPolicy: input.postingPolicy ?? "open",
    lifecycleState: input.lifecycleState ?? "active",
    participantIds: input.participantIds ?? ["founder", "alpha"],
    predecessorConversationId: input.predecessorConversationId ?? null,
    lineageRootConversationId: input.lineageRootConversationId ?? input.conversationId,
    historyMode: input.historyMode ?? "native",
    createdAt: input.createdAt ?? "2026-04-04T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-04T00:00:00.000Z",
  }
}

function makeMessage(
  input: Partial<ChatMessage> & { messageId: string; conversationId: string },
): ChatMessage {
  return {
    eventType: "message.posted",
    scopeId: "chat",
    messageId: input.messageId,
    eventId: input.eventId ?? `${input.messageId}-event`,
    sequence: input.sequence ?? 1,
    scopeSequence: input.scopeSequence ?? input.revision ?? 1,
    revision: input.revision ?? 1,
    conversationId: input.conversationId,
    roomId: input.roomId ?? input.conversationId,
    threadId: input.threadId ?? null,
    sessionId: input.sessionId ?? "session-1",
    author: input.author ?? { kind: "participant", id: "founder" },
    audience: input.audience ?? null,
    content: input.content ?? input.body ?? "hello",
    body: input.body ?? input.content ?? "hello",
    createdAt: input.createdAt ?? "2026-04-04T00:00:00.000Z",
    editedAt: input.editedAt ?? null,
    editedById: input.editedById ?? null,
    redactedAt: input.redactedAt ?? null,
    redactedById: input.redactedById ?? null,
    mentionedIds: input.mentionedIds ?? [],
    reactions: input.reactions ?? [],
    relatedMessageId: input.relatedMessageId ?? null,
    messageKind: input.messageKind ?? "participant-message",
    systemEventKind: input.systemEventKind ?? null,
  }
}

function makeCursor(
  input: Partial<ChatCursorRecord> & {
    participantId: string
    conversationId: string
    lastObservedScopeSequence: number
  },
): ChatCursorRecord {
  return {
    eventType: "conversation.cursor.updated",
    scopeId: "chat",
    eventId: input.eventId ?? `${input.conversationId}-${input.participantId}-cursor`,
    sequence: input.sequence ?? 1,
    participantId: input.participantId,
    conversationId: input.conversationId,
    threadId: input.threadId ?? null,
    lastObservedSequence: input.lastObservedSequence ?? input.lastObservedScopeSequence,
    lastObservedScopeSequence: input.lastObservedScopeSequence,
    lastObservedScopeRevision: input.lastObservedScopeRevision ?? input.lastObservedScopeSequence,
    lastContributedSequence: input.lastContributedSequence ?? null,
    createdAt: input.createdAt ?? "2026-04-04T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-04T00:00:00.000Z",
  }
}

function makeMembership(
  input: Partial<ChatRoomMembershipRecord> & { conversationId: string; participantId: string },
): ChatRoomMembershipRecord {
  return {
    eventType: "conversation.membership.upserted",
    scopeId: "chat",
    eventId: input.eventId ?? `${input.conversationId}-${input.participantId}-membership`,
    sequence: input.sequence ?? 1,
    conversationId: input.conversationId,
    participantId: input.participantId,
    membershipState: input.membershipState ?? "joined",
    createdAt: input.createdAt ?? "2026-04-04T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-04T00:00:00.000Z",
  }
}

function makeGrantBinding(
  input: Partial<ChatGrantBindingRecord> & {
    bindingId: string
    subjectId: string
    roleId: ChatGrantBindingRecord["roleId"]
  },
): ChatGrantBindingRecord {
  return {
    eventType: "authorization.grant-binding.upserted",
    scopeId: "chat",
    eventId: input.eventId ?? `${input.bindingId}-event`,
    sequence: input.sequence ?? 1,
    bindingId: input.bindingId,
    subjectId: input.subjectId,
    roleId: input.roleId,
    scopeKind: input.scopeKind ?? "conversation",
    conversationId: input.conversationId ?? "general",
    bindingState: input.bindingState ?? "active",
    createdAt: input.createdAt ?? "2026-04-04T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-04T00:00:00.000Z",
  }
}

function makeAttachment(
  input: Partial<ChatConversationAttachmentRecord> & {
    conversationId: string
    participantId: string
  },
): ChatConversationAttachmentRecord {
  return {
    eventType: "conversation.attachment.upserted",
    scopeId: "chat",
    eventId: input.eventId ?? `${input.conversationId}-${input.threadId ?? "root"}-attachment`,
    sequence: input.sequence ?? 1,
    conversationId: input.conversationId,
    threadId: input.threadId ?? null,
    participantId: input.participantId,
    attached: input.attached ?? true,
    createdAt: input.createdAt ?? "2026-04-04T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-04T00:00:00.000Z",
  }
}

describe("chat-projections", () => {
  it("builds conversation-local transcript, thread view, and deduped activity indicators", () => {
    const root = makeMessage({
      messageId: "root-1",
      conversationId: "general",
      author: { kind: "participant", id: "founder" },
      body: "Root topic",
      createdAt: "2026-04-04T00:00:00.000Z",
    })
    const reply = makeMessage({
      messageId: "reply-1",
      conversationId: "general",
      threadId: "root-1",
      author: { kind: "participant", id: "alpha" },
      body: "Thread reply",
      createdAt: "2026-04-04T00:01:00.000Z",
    })
    const otherConversation = makeMessage({
      messageId: "other-1",
      conversationId: "ops",
      body: "Ignore me",
    })
    const projection = buildChatConversationProjection({
      activeConversationId: "general",
      activeThreadId: "root-1",
      conversationRecords: [
        {
          eventType: "conversation.upserted",
          scopeId: "chat",
          eventId: "general-event",
          sequence: 1,
          conversationId: "general",
          kind: "channel",
          section: "channels",
          slug: "general",
          title: "general",
          topic: null,
          visibility: "public",
          postingPolicy: "open",
          lifecycleState: "active",
          participantIds: ["founder", "alpha"],
          predecessorConversationId: null,
          lineageRootConversationId: "general",
          historyMode: "native",
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      messages: [root, reply, otherConversation],
    })

    expect(projection.conversationMessages.map((message) => message.messageId)).toEqual([
      "root-1",
      "reply-1",
    ])
    expect(projection.mainTranscript).toHaveLength(1)
    expect(projection.mainTranscript[0]?.threadReplyCount).toBe(1)
    expect(projection.mainTranscript[0]?.threadPreview).toContain("Thread reply")
    expect(projection.activeThreadRoot?.messageId).toBe("root-1")
    expect(projection.activeThreadMessages.map((message) => message.messageId)).toEqual(["reply-1"])
  })

  it("derives mainline unread counts from cursors and keeps viewer rooms at zero", () => {
    const records = [
      makeConversation({
        conversationId: "general",
        title: "General",
        participantIds: ["founder", "alpha"],
      }),
      makeConversation({
        conversationId: "ops",
        title: "Ops",
        participantIds: ["founder", "alpha"],
      }),
    ]
    const messages = [
      makeMessage({
        messageId: "general-root",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "Earlier message",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
      }),
      makeMessage({
        messageId: "general-mention",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "@founder please check this",
        mentionedIds: ["founder"],
        scopeSequence: 2,
        createdAt: "2026-04-04T00:01:00.000Z",
      }),
      makeMessage({
        messageId: "general-thread-root",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "Thread root",
        scopeSequence: 3,
        createdAt: "2026-04-04T00:02:00.000Z",
      }),
      makeMessage({
        messageId: "general-thread-reply",
        conversationId: "general",
        threadId: "general-thread-root",
        author: { kind: "participant", id: "alpha" },
        body: "@founder thread ping",
        mentionedIds: ["founder"],
        scopeSequence: 1,
        createdAt: "2026-04-04T00:03:00.000Z",
      }),
      makeMessage({
        messageId: "ops-mention",
        conversationId: "ops",
        author: { kind: "participant", id: "alpha" },
        body: "@founder viewer room mention",
        mentionedIds: ["founder"],
        scopeSequence: 1,
        createdAt: "2026-04-04T00:04:00.000Z",
      }),
    ]

    const conversations = summarizeChatConversations({
      conversationRecords: records,
      messages,
      cursorRecords: [
        makeCursor({
          participantId: "founder",
          conversationId: "general",
          lastObservedScopeSequence: 1,
        }),
      ],
      membershipRecords: [
        makeMembership({
          conversationId: "general",
          participantId: "founder",
        }),
      ],
      viewerId: "founder",
    })

    expect(
      conversations.map((conversation) => ({
        conversationId: conversation.conversationId,
        unreadCount: conversation.unreadCount,
        mentionCount: conversation.mentionCount,
      })),
    ).toEqual([
      {
        conversationId: "ops",
        unreadCount: 0,
        mentionCount: 0,
      },
      {
        conversationId: "general",
        unreadCount: 2,
        mentionCount: 1,
      },
    ])
  })

  it("builds direct-attention inbox rows from unread mentions and unread DMs", () => {
    const conversationRecords = [
      makeConversation({
        conversationId: "general",
        title: "General",
        participantIds: ["founder", "alpha"],
      }),
      makeConversation({
        conversationId: "dm-alpha",
        kind: "dm",
        title: "alpha",
        participantIds: ["founder", "alpha"],
        visibility: "private",
      }),
      makeConversation({
        conversationId: "ops",
        title: "Ops",
        participantIds: ["founder", "alpha"],
      }),
    ]
    const messages = [
      makeMessage({
        messageId: "general-root",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "General update",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
      }),
      makeMessage({
        messageId: "general-mention",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "@founder need your call",
        mentionedIds: ["founder"],
        scopeSequence: 2,
        createdAt: "2026-04-04T00:01:00.000Z",
      }),
      makeMessage({
        messageId: "thread-root",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "Thread root",
        scopeSequence: 3,
        createdAt: "2026-04-04T00:02:00.000Z",
      }),
      makeMessage({
        messageId: "thread-mention",
        conversationId: "general",
        threadId: "thread-root",
        author: { kind: "participant", id: "alpha" },
        body: "@founder thread follow-up",
        mentionedIds: ["founder"],
        scopeSequence: 1,
        createdAt: "2026-04-04T00:03:00.000Z",
      }),
      makeMessage({
        messageId: "dm-unread",
        conversationId: "dm-alpha",
        author: { kind: "participant", id: "alpha" },
        body: "Direct ping",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:04:00.000Z",
      }),
      makeMessage({
        messageId: "ops-mention",
        conversationId: "ops",
        author: { kind: "participant", id: "alpha" },
        body: "@founder viewer-only room",
        mentionedIds: ["founder"],
        scopeSequence: 1,
        createdAt: "2026-04-04T00:05:00.000Z",
      }),
    ]
    const cursorRecords = [
      makeCursor({
        participantId: "founder",
        conversationId: "general",
        lastObservedScopeSequence: 1,
      }),
      makeCursor({
        participantId: "founder",
        conversationId: "dm-alpha",
        lastObservedScopeSequence: 0,
      }),
    ]
    const membershipRecords = [
      makeMembership({
        conversationId: "general",
        participantId: "founder",
      }),
      makeMembership({
        conversationId: "dm-alpha",
        participantId: "founder",
      }),
    ]
    const conversations = summarizeChatConversations({
      conversationRecords,
      messages,
      cursorRecords,
      membershipRecords,
      viewerId: "founder",
    })

    const inbox = buildChatInbox({
      viewerId: "founder",
      messages,
      conversations,
      cursorRecords,
      membershipRecords,
    })

    expect(
      inbox.map((entry) => ({
        entryId: entry.entryId,
        kind: entry.kind,
        conversationId: entry.conversationId,
        messageId: entry.messageId,
      })),
    ).toEqual([
      {
        entryId: "direct:dm-alpha",
        kind: "direct",
        conversationId: "dm-alpha",
        messageId: "dm-unread",
      },
      {
        entryId: "mention:thread-mention",
        kind: "mention",
        conversationId: "general",
        messageId: "thread-mention",
      },
      {
        entryId: "mention:general-mention",
        kind: "mention",
        conversationId: "general",
        messageId: "general-mention",
      },
    ])
  })

  it("derives followed threads from joined attachment and transcript facts", () => {
    const messages = [
      makeMessage({
        messageId: "thread-started",
        conversationId: "general",
        author: { kind: "participant", id: "founder" },
        body: "Kickoff thread",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
      }),
      makeMessage({
        messageId: "thread-started-r1",
        conversationId: "general",
        threadId: "thread-started",
        author: { kind: "participant", id: "alpha" },
        body: "First reply",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:01:00.000Z",
      }),
      makeMessage({
        messageId: "thread-started-r2",
        conversationId: "general",
        threadId: "thread-started",
        author: { kind: "participant", id: "beta" },
        body: "Latest reply",
        scopeSequence: 2,
        createdAt: "2026-04-04T00:02:00.000Z",
      }),
      makeMessage({
        messageId: "thread-mentioned",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "Need review",
        scopeSequence: 2,
        createdAt: "2026-04-04T00:03:00.000Z",
      }),
      makeMessage({
        messageId: "thread-mentioned-r1",
        conversationId: "general",
        threadId: "thread-mentioned",
        author: { kind: "participant", id: "beta" },
        body: "@founder please review",
        mentionedIds: ["founder"],
        scopeSequence: 1,
        createdAt: "2026-04-04T00:04:00.000Z",
      }),
      makeMessage({
        messageId: "thread-unfollowed",
        conversationId: "general",
        author: { kind: "participant", id: "founder" },
        body: "Mute this thread",
        scopeSequence: 3,
        createdAt: "2026-04-04T00:05:00.000Z",
      }),
      makeMessage({
        messageId: "thread-unfollowed-r1",
        conversationId: "general",
        threadId: "thread-unfollowed",
        author: { kind: "participant", id: "alpha" },
        body: "Ignored reply",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:06:00.000Z",
      }),
      makeMessage({
        messageId: "viewer-thread",
        conversationId: "ops",
        author: { kind: "participant", id: "alpha" },
        body: "Viewer room",
        scopeSequence: 1,
        createdAt: "2026-04-04T00:07:00.000Z",
      }),
      makeMessage({
        messageId: "viewer-thread-r1",
        conversationId: "ops",
        threadId: "viewer-thread",
        author: { kind: "participant", id: "beta" },
        body: "@founder cannot follow this",
        mentionedIds: ["founder"],
        scopeSequence: 1,
        createdAt: "2026-04-04T00:08:00.000Z",
      }),
    ]

    const followedThreads = buildChatFollowedThreads({
      viewerId: "founder",
      conversationRecords: [
        makeConversation({ conversationId: "general", title: "General" }),
        makeConversation({
          conversationId: "ops",
          title: "Ops",
          participantIds: ["alpha", "beta"],
        }),
      ],
      messages,
      membershipRecords: [makeMembership({ conversationId: "general", participantId: "founder" })],
      cursorRecords: [
        makeCursor({
          participantId: "founder",
          conversationId: "general",
          threadId: "thread-started",
          lastObservedScopeSequence: 1,
        }),
      ],
      attachmentRecords: [
        makeAttachment({
          conversationId: "general",
          threadId: "thread-unfollowed",
          participantId: "founder",
          attached: false,
          updatedAt: "2026-04-04T00:06:30.000Z",
        }),
        makeAttachment({
          conversationId: "ops",
          threadId: "viewer-thread",
          participantId: "founder",
          attached: true,
          updatedAt: "2026-04-04T00:08:30.000Z",
        }),
      ],
    })

    expect(
      followedThreads.map((thread) => ({
        threadRootMessageId: thread.threadRootMessageId,
        unreadReplyCount: thread.unreadReplyCount,
        unreadMentionCount: thread.unreadMentionCount,
      })),
    ).toEqual([
      {
        threadRootMessageId: "thread-mentioned",
        unreadReplyCount: 1,
        unreadMentionCount: 1,
      },
      {
        threadRootMessageId: "thread-started",
        unreadReplyCount: 1,
        unreadMentionCount: 0,
      },
    ])
  })

  it("derives recent viewer rooms from mainline attachments without joined-room unread", () => {
    const conversationRecords = [
      makeConversation({
        conversationId: "general",
        title: "General",
        participantIds: ["founder", "alpha"],
      }),
      makeConversation({
        conversationId: "ops",
        title: "Ops",
        participantIds: ["alpha", "beta"],
      }),
      makeConversation({
        conversationId: "finance",
        title: "Finance",
        participantIds: ["alpha", "beta"],
      }),
    ]
    const conversations = summarizeChatConversations({
      conversationRecords,
      messages: [
        makeMessage({
          messageId: "ops-msg",
          conversationId: "ops",
          author: { kind: "participant", id: "alpha" },
          body: "Ops status",
          scopeSequence: 1,
          createdAt: "2026-04-04T00:01:00.000Z",
        }),
        makeMessage({
          messageId: "finance-msg",
          conversationId: "finance",
          author: { kind: "participant", id: "beta" },
          body: "Finance update",
          scopeSequence: 1,
          createdAt: "2026-04-04T00:02:00.000Z",
        }),
      ],
      membershipRecords: [makeMembership({ conversationId: "general", participantId: "founder" })],
      viewerId: "founder",
    })

    const viewerRecents = buildChatViewerRecents({
      viewerId: "founder",
      conversations,
      conversationRecords,
      membershipRecords: [makeMembership({ conversationId: "general", participantId: "founder" })],
      grantBindings: [
        makeGrantBinding({
          bindingId: "ops-viewer",
          subjectId: "founder",
          roleId: "viewer",
          conversationId: "ops",
        }),
        makeGrantBinding({
          bindingId: "finance-viewer",
          subjectId: "founder",
          roleId: "viewer",
          conversationId: "finance",
        }),
      ],
      attachmentRecords: [
        makeAttachment({
          conversationId: "finance",
          participantId: "founder",
          updatedAt: "2026-04-04T00:04:00.000Z",
        }),
        makeAttachment({
          conversationId: "ops",
          participantId: "founder",
          updatedAt: "2026-04-04T00:05:00.000Z",
        }),
        makeAttachment({
          conversationId: "general",
          participantId: "founder",
          updatedAt: "2026-04-04T00:06:00.000Z",
        }),
      ],
    })

    expect(
      viewerRecents.map((conversation) => ({
        conversationId: conversation.conversationId,
        observedAt: conversation.observedAt,
      })),
    ).toEqual([
      {
        conversationId: "ops",
        observedAt: "2026-04-04T00:05:00.000Z",
      },
      {
        conversationId: "finance",
        observedAt: "2026-04-04T00:04:00.000Z",
      },
    ])
  })

  it("searches readable conversations and labels joined versus viewer open mode", () => {
    const conversationRecords = [
      makeConversation({
        conversationId: "dm-alpha",
        kind: "dm",
        title: "alpha",
        participantIds: ["founder", "alpha"],
        visibility: "private",
      }),
      makeConversation({
        conversationId: "dm-alpha-beta",
        kind: "group_dm",
        title: "alpha + beta",
        participantIds: ["founder", "alpha", "beta"],
        visibility: "private",
        predecessorConversationId: "dm-alpha",
        lineageRootConversationId: "dm-alpha",
        historyMode: "inherit_full",
      }),
      makeConversation({
        conversationId: "ops",
        title: "Ops",
        participantIds: ["alpha", "beta"],
      }),
      makeConversation({
        conversationId: "secret",
        title: "Secret",
        participantIds: ["alpha", "beta"],
        visibility: "private",
      }),
    ]

    const results = searchChatVisibleMessages({
      viewerId: "founder",
      query: "launch incident",
      conversationRecords,
      messages: [
        makeMessage({
          messageId: "launch-msg",
          conversationId: "dm-alpha",
          author: { kind: "participant", id: "alpha" },
          body: "launch plan is ready",
          scopeSequence: 1,
          createdAt: "2026-04-04T00:01:00.000Z",
        }),
        makeMessage({
          messageId: "incident-msg",
          conversationId: "ops",
          author: { kind: "participant", id: "beta" },
          body: "incident update",
          scopeSequence: 1,
          createdAt: "2026-04-04T00:02:00.000Z",
        }),
        makeMessage({
          messageId: "secret-msg",
          conversationId: "secret",
          author: { kind: "participant", id: "alpha" },
          body: "incident secrets",
          scopeSequence: 1,
          createdAt: "2026-04-04T00:03:00.000Z",
        }),
      ],
      membershipRecords: [
        makeMembership({
          conversationId: "dm-alpha",
          participantId: "founder",
          membershipState: "left",
        }),
        makeMembership({
          conversationId: "dm-alpha-beta",
          participantId: "founder",
          membershipState: "joined",
        }),
      ],
      grantBindings: [
        makeGrantBinding({
          bindingId: "dm-alpha-beta-manager",
          subjectId: "founder",
          roleId: "room_manager",
          conversationId: "dm-alpha-beta",
        }),
        makeGrantBinding({
          bindingId: "ops-viewer",
          subjectId: "founder",
          roleId: "viewer",
          conversationId: "ops",
        }),
      ],
    })

    expect(
      results.map((result) => ({
        messageId: result.messageId,
        sourceConversationId: result.sourceConversationId,
        openConversationId: result.openConversationId,
        openMode: result.openMode,
      })),
    ).toEqual([
      {
        messageId: "incident-msg",
        sourceConversationId: "ops",
        openConversationId: "ops",
        openMode: "viewer",
      },
      {
        messageId: "launch-msg",
        sourceConversationId: "dm-alpha",
        openConversationId: "dm-alpha-beta",
        openMode: "joined",
      },
    ])
  })
})
