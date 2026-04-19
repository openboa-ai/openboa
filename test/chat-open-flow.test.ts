import { describe, expect, it } from "vitest"
import type { ChatConversationRecord } from "../src/chat/core/model.js"
import type { ChatConversationProjection } from "../src/chat/projections/projections.js"
import type { ChatProjectedMessage } from "../src/chat/view-model.js"
import {
  buildChatTranscriptView,
  openFollowedThread,
  openInboxEntry,
  openSearchResult,
  openViewerRecentConversation,
} from "../src/shell/chat/index.js"

function makeConversation(
  input: Partial<ChatConversationRecord> & {
    conversationId: string
    title?: string
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

function makeProjectedMessage(
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
    messageKind: input.messageKind ?? "participant-message",
    systemEventKind: input.systemEventKind ?? null,
    threadReplyCount: input.threadReplyCount,
    threadPreview: input.threadPreview ?? null,
    threadPreviewAuthorId: input.threadPreviewAuthorId ?? null,
    threadLastReplyAt: input.threadLastReplyAt ?? null,
  }
}

function makeProjection(
  input: Partial<ChatConversationProjection> & {
    transcript?: ChatProjectedMessage[]
  } = {},
): ChatConversationProjection {
  return {
    conversationMessages: input.conversationMessages ?? input.transcript ?? [],
    mainTranscript: input.mainTranscript ?? input.transcript ?? [],
    activeThreadRoot: input.activeThreadRoot ?? null,
    activeThreadMessages: input.activeThreadMessages ?? [],
  }
}

describe("chat shell open flow", () => {
  it("opens inbox entries as joined conversation focus without thread state", () => {
    const intent = openInboxEntry({
      entryId: "mention:msg-1",
      kind: "mention",
      title: "Mention in general",
      preview: "@founder take a look",
      conversationId: "general",
      messageId: "msg-1",
      createdAt: "2026-04-06T00:00:00.000Z",
    })

    expect(intent).toEqual({
      source: "inbox",
      openConversationId: "general",
      sourceConversationId: "general",
      openMode: "joined",
      focusMessageId: "msg-1",
      activeThreadId: null,
    })
  })

  it("opens followed threads as joined room plus thread drawer target", () => {
    const intent = openFollowedThread({
      conversationId: "ops",
      conversationTitle: "ops",
      threadRootMessageId: "root-77",
      threadRootPreview: "Root summary",
      latestReplyAt: "2026-04-06T00:10:00.000Z",
      latestReplyPreview: "latest reply",
      unreadReplyCount: 2,
      unreadMentionCount: 1,
    })

    expect(intent).toEqual({
      source: "thread",
      openConversationId: "ops",
      sourceConversationId: "ops",
      openMode: "joined",
      focusMessageId: "root-77",
      activeThreadId: "root-77",
    })
  })

  it("opens lineage-aware search results with projection-owned open mode and context", () => {
    const intent = openSearchResult({
      messageId: "dm-root-1",
      sourceConversationId: "dm-alpha",
      openConversationId: "dm-alpha-bravo",
      openMode: "joined",
      threadId: "thread-2",
      conversationTitle: "alpha + bravo",
      preview: "history mention",
      createdAt: "2026-04-06T00:20:00.000Z",
      score: 3,
    })

    expect(intent).toEqual({
      source: "search",
      openConversationId: "dm-alpha-bravo",
      sourceConversationId: "dm-alpha",
      openMode: "joined",
      focusMessageId: "dm-root-1",
      activeThreadId: "thread-2",
    })
  })

  it("opens viewer search results without implying membership", () => {
    const intent = openSearchResult({
      messageId: "ops-viewer-msg",
      sourceConversationId: "ops-private",
      openConversationId: "ops-private",
      openMode: "viewer",
      threadId: null,
      conversationTitle: "ops-private",
      preview: "viewer result",
      createdAt: "2026-04-06T00:30:00.000Z",
      score: 2,
    })

    expect(intent).toEqual({
      source: "search",
      openConversationId: "ops-private",
      sourceConversationId: "ops-private",
      openMode: "viewer",
      focusMessageId: "ops-viewer-msg",
      activeThreadId: null,
    })
  })

  it("opens viewer recents quietly in viewer mode", () => {
    const intent = openViewerRecentConversation({
      conversationId: "finance-private",
      title: "finance-private",
      kind: "channel",
      observedAt: "2026-04-06T00:40:00.000Z",
      latestActivityAt: "2026-04-06T00:39:00.000Z",
      latestMessagePreview: "quiet viewer room",
    })

    expect(intent).toEqual({
      source: "viewer-recent",
      openConversationId: "finance-private",
      sourceConversationId: "finance-private",
      openMode: "viewer",
      focusMessageId: null,
      activeThreadId: null,
    })
  })

  it("builds joined transcript view state with an enabled composer", () => {
    const conversation = makeConversation({
      conversationId: "general",
      title: "general",
      postingPolicy: "open",
    })
    const transcript = [
      makeProjectedMessage({
        messageId: "root-1",
        conversationId: "general",
        body: "Root topic",
      }),
    ]
    const projection = makeProjection({
      transcript,
    })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openInboxEntry({
        entryId: "mention:root-1",
        kind: "mention",
        title: "Mention in general",
        preview: "Root topic",
        conversationId: "general",
        messageId: "root-1",
        createdAt: "2026-04-06T00:00:00.000Z",
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

    expect(view.openMode).toBe("joined")
    expect(view.chrome).toEqual({
      icon: "channel",
      badgeLabel: "public",
      canEditDetails: true,
      canTogglePostingPolicy: true,
      canArchive: true,
      canLeave: true,
      canManageParticipants: true,
      canModerateMessages: true,
    })
    expect(view.focusMessageId).toBe("root-1")
    expect(view.transcript).toEqual(transcript)
    expect(view.threadDrawer).toEqual({
      open: false,
      rootMessage: null,
      messages: [],
      followed: false,
      unreadReplyCount: 0,
      unreadMentionCount: 0,
    })
    expect(view.viewerTreatment).toBeNull()
    expect(view.composer).toEqual({
      visible: true,
      enabled: true,
      placeholder: "Message #general",
      disabledReason: null,
    })
  })

  it("builds thread drawer state for followed thread openings", () => {
    const conversation = makeConversation({
      conversationId: "ops",
      title: "ops",
    })
    const threadRoot = makeProjectedMessage({
      messageId: "root-77",
      conversationId: "ops",
      body: "Root summary",
    })
    const threadReply = makeProjectedMessage({
      messageId: "reply-77",
      conversationId: "ops",
      threadId: "root-77",
      body: "Detailed follow-up",
    })
    const projection = makeProjection({
      transcript: [threadRoot],
      activeThreadRoot: threadRoot,
      activeThreadMessages: [threadReply],
    })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openFollowedThread({
        conversationId: "ops",
        conversationTitle: "ops",
        threadRootMessageId: "root-77",
        threadRootPreview: "Root summary",
        latestReplyAt: "2026-04-06T00:10:00.000Z",
        latestReplyPreview: "Detailed follow-up",
        unreadReplyCount: 1,
        unreadMentionCount: 0,
      }),
      canPostMessage: true,
      accessGrants: [
        {
          bindingId: "ops:founder:room_manager",
          subjectId: "founder",
          roleId: "room_manager",
        },
      ],
      threadAttention: {
        unreadReplyCount: 1,
        unreadMentionCount: 0,
      },
    })

    expect(view.threadDrawer.open).toBe(true)
    expect(view.threadDrawer.rootMessage?.messageId).toBe("root-77")
    expect(view.threadDrawer.messages).toEqual([threadReply])
    expect(view.threadDrawer.followed).toBe(false)
    expect(view.threadDrawer.unreadReplyCount).toBe(1)
    expect(view.threadDrawer.unreadMentionCount).toBe(0)
  })

  it("keeps viewer transcript mode explicit and composer read-only", () => {
    const conversation = makeConversation({
      conversationId: "finance-private",
      title: "finance-private",
      postingPolicy: "open",
    })
    const transcript = [
      makeProjectedMessage({
        messageId: "finance-1",
        conversationId: "finance-private",
        body: "quiet viewer room",
      }),
    ]
    const projection = makeProjection({ transcript })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openViewerRecentConversation({
        conversationId: "finance-private",
        title: "finance-private",
        kind: "channel",
        observedAt: "2026-04-06T00:40:00.000Z",
        latestActivityAt: "2026-04-06T00:39:00.000Z",
        latestMessagePreview: "quiet viewer room",
      }),
      canPostMessage: false,
    })

    expect(view.openMode).toBe("viewer")
    expect(view.chrome).toEqual({
      icon: "channel",
      badgeLabel: "public",
      canEditDetails: false,
      canTogglePostingPolicy: false,
      canArchive: false,
      canLeave: false,
      canManageParticipants: false,
      canModerateMessages: false,
    })
    expect(view.viewerTreatment).toEqual({
      mode: "viewer",
      badge: "Viewer mode",
      detail: "Read-only",
      actionLabel: "Join to participate",
    })
    expect(view.composer).toEqual({
      visible: true,
      enabled: false,
      placeholder: "Join to participate",
      disabledReason: "Viewer mode is read-only",
    })
    expect(view.transcript).toEqual(transcript)
  })

  it("shows posting-disabled composer state without re-deriving policy in shell", () => {
    const conversation = makeConversation({
      conversationId: "announcements",
      title: "announcements",
      postingPolicy: "restricted",
    })
    const projection = makeProjection({
      transcript: [
        makeProjectedMessage({
          messageId: "announce-1",
          conversationId: "announcements",
          body: "Read this first",
        }),
      ],
    })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openSearchResult({
        messageId: "announce-1",
        sourceConversationId: "announcements",
        openConversationId: "announcements",
        openMode: "joined",
        threadId: null,
        conversationTitle: "announcements",
        preview: "Read this first",
        createdAt: "2026-04-06T01:00:00.000Z",
        score: 2,
      }),
      canPostMessage: false,
    })

    expect(view.viewerTreatment).toBeNull()
    expect(view.composer).toEqual({
      visible: true,
      enabled: false,
      placeholder: "Posting is restricted",
      disabledReason: "Posting is restricted",
    })
  })

  it("builds dm transcript chrome without channel management affordances", () => {
    const conversation = makeConversation({
      conversationId: "dm-alpha",
      title: "Alpha",
      kind: "dm",
      participantIds: ["founder", "alpha"],
    })
    const projection = makeProjection({
      transcript: [
        makeProjectedMessage({
          messageId: "dm-alpha-1",
          conversationId: "dm-alpha",
          body: "Ping me when the notes are ready.",
        }),
      ],
    })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openSearchResult({
        messageId: "dm-alpha-1",
        sourceConversationId: "dm-alpha",
        openConversationId: "dm-alpha",
        openMode: "joined",
        threadId: null,
        conversationTitle: "Alpha",
        preview: "Ping me when the notes are ready.",
        createdAt: "2026-04-06T01:20:00.000Z",
        score: 1,
      }),
      canPostMessage: true,
    })

    expect(view.chrome).toEqual({
      icon: "dm",
      badgeLabel: "dm",
      canEditDetails: false,
      canTogglePostingPolicy: false,
      canArchive: false,
      canLeave: false,
      canManageParticipants: false,
      canModerateMessages: true,
    })
    expect(view.composer).toEqual({
      visible: true,
      enabled: true,
      placeholder: "Message Alpha",
      disabledReason: null,
    })
  })

  it("keeps participant management available in single-member channels", () => {
    const conversation = makeConversation({
      conversationId: "solo-room",
      title: "solo-room",
      kind: "channel",
      participantIds: ["founder"],
    })
    const projection = makeProjection({
      transcript: [],
    })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openSearchResult({
        messageId: null,
        sourceConversationId: "solo-room",
        openConversationId: "solo-room",
        openMode: "joined",
        threadId: null,
        conversationTitle: "solo-room",
        preview: "solo-room",
        createdAt: "2026-04-06T01:22:00.000Z",
        score: 1,
      }),
      canPostMessage: true,
      accessGrants: [
        {
          bindingId: "solo-room:founder:room_manager",
          subjectId: "founder",
          roleId: "room_manager",
        },
      ],
    })

    expect(view.chrome.canManageParticipants).toBe(true)
  })

  it("builds group dm transcript chrome with leave and roster affordances only", () => {
    const conversation = makeConversation({
      conversationId: "group-alpha-beta",
      title: "Alpha, Beta",
      kind: "group_dm",
      participantIds: ["founder", "alpha", "beta"],
    })
    const projection = makeProjection({
      transcript: [
        makeProjectedMessage({
          messageId: "group-alpha-beta-1",
          conversationId: "group-alpha-beta",
          body: "Let's close the launch note together.",
        }),
      ],
    })

    const view = buildChatTranscriptView({
      actorId: "founder",
      conversation,
      projection,
      openIntent: openSearchResult({
        messageId: "group-alpha-beta-1",
        sourceConversationId: "group-alpha-beta",
        openConversationId: "group-alpha-beta",
        openMode: "joined",
        threadId: null,
        conversationTitle: "Alpha, Beta",
        preview: "Let's close the launch note together.",
        createdAt: "2026-04-06T01:25:00.000Z",
        score: 1,
      }),
      canPostMessage: true,
    })

    expect(view.chrome).toEqual({
      icon: "group-dm",
      badgeLabel: "group dm",
      canEditDetails: false,
      canTogglePostingPolicy: false,
      canArchive: false,
      canLeave: true,
      canManageParticipants: true,
      canModerateMessages: true,
    })
  })

  it("keeps joined participant channels read-write without manager controls", () => {
    const conversation = makeConversation({
      conversationId: "ops-review",
      title: "ops-review",
      kind: "channel",
      participantIds: ["founder", "alpha"],
      postingPolicy: "open",
    })
    const projection = makeProjection()

    const view = buildChatTranscriptView({
      actorId: "alpha",
      conversation,
      projection,
      openIntent: openSearchResult({
        messageId: null,
        sourceConversationId: "ops-review",
        openConversationId: "ops-review",
        openMode: "joined",
        threadId: null,
        conversationTitle: "ops-review",
        preview: "ops-review",
        createdAt: "2026-04-06T01:32:00.000Z",
        score: 1,
      }),
      canPostMessage: true,
      accessGrants: [
        {
          bindingId: "ops-review:alpha:participant",
          subjectId: "alpha",
          roleId: "participant",
        },
      ],
    })

    expect(view.chrome).toEqual({
      icon: "channel",
      badgeLabel: "public",
      canEditDetails: false,
      canTogglePostingPolicy: false,
      canArchive: false,
      canLeave: true,
      canManageParticipants: false,
      canModerateMessages: false,
    })
    expect(view.composer.enabled).toBe(true)
  })
})
