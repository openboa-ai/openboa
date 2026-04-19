import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CHAT_REDACTED_MESSAGE_BODY,
  type ChatConversation,
  type ChatConversationRecord,
  type ChatMessageReaction,
} from "../../chat/core/model.js"
import type { ChatConversationProjection } from "../../chat/projections/projections.js"
import type { ChatProjectedMessage, ChatSurface } from "../../chat/view-model.js"
import {
  buildChatShellRuntimeState,
  type ChatConversationAccessGrant,
  type ChatOpenIntent,
  type ChatOpenMode,
  type ChatShellRuntimeSeed,
  type ChatShellRuntimeSeedItem,
  type ChatShellRuntimeState,
  openFollowedThread,
  openInboxEntry,
  openViewerRecentConversation,
  resolveInitialChatShellSidebarItemId,
} from "../chat/index.js"
import { canChatActorModerateMessages, canChatActorPostMessages } from "../chat/permissions.js"
import { chatSeedSurface, makeConversationRecord, makeProjectedMessage } from "./chat-seed.js"

const CHAT_STORAGE_KEY = "openboa.shell.chat.sidebarItem"
const CHAT_SEED_STORAGE_KEY = "openboa.shell.chat.seed"
const CHAT_DRAFTS_STORAGE_KEY = "openboa.shell.chat.drafts"
const DEFAULT_PARTICIPANT_ID = "founder"
const SEARCH_RESULT_LIMIT = 8

interface ChatDraftPersistence {
  conversationDrafts: Record<string, string>
  threadDrafts: Record<string, string>
  conversationAudienceSelections: Record<string, string | null | undefined>
  threadAudienceSelections: Record<string, string | null | undefined>
}

const defaultActiveSidebarItemId = chatSeedSurface.activeConversationId

const sidebarConversations = [
  ...chatSeedSurface.sidebar.channels,
  ...chatSeedSurface.sidebar.dmGroups.flatMap((group) => group.conversations),
]

const conversationById = new Map(
  sidebarConversations.map((conversation) => [conversation.conversationId, conversation]),
)

const inboxEntryById = new Map(chatSeedSurface.sidebar.inbox.map((entry) => [entry.entryId, entry]))
const followedThreadById = new Map(
  chatSeedSurface.sidebar.followedThreads.map((entry) => [entry.entryId, entry]),
)
const viewerRecentById = new Map(
  chatSeedSurface.sidebar.viewerRecents.map((entry) => [entry.entryId, entry]),
)

const defaultConversation = chatSeedSurface.activeConversation ?? conversationById.get("general")

if (!defaultConversation) {
  throw new Error("Chat shell state requires a default conversation.")
}

const generalConversationRecord = makeConversationRecord({
  ...defaultConversation,
  conversationId: defaultConversation.conversationId,
  title: defaultConversation.title,
  kind: defaultConversation.kind,
})

const generalThreadRoot = chatSeedSurface.activeThreadRoot
const generalProjection: ChatConversationProjection = {
  conversationMessages: [
    ...chatSeedSurface.transcript,
    ...chatSeedSurface.activeThreadMessages.filter(
      (message) =>
        !chatSeedSurface.transcript.some(
          (transcriptMessage) => transcriptMessage.messageId === message.messageId,
        ),
    ),
  ],
  mainTranscript: chatSeedSurface.transcript,
  activeThreadRoot: chatSeedSurface.activeThreadRoot,
  activeThreadMessages: chatSeedSurface.activeThreadMessages,
}

const generalOpenIntent: ChatOpenIntent =
  generalThreadRoot && chatSeedSurface.activeThreadMessages[0]
    ? openFollowedThread({
        conversationId: chatSeedSurface.activeConversationId,
        conversationTitle: chatSeedSurface.activeConversation?.title ?? "general",
        threadRootMessageId: generalThreadRoot.messageId,
        threadRootPreview: generalThreadRoot.body,
        latestReplyAt: chatSeedSurface.activeThreadMessages[0].createdAt,
        latestReplyPreview: chatSeedSurface.activeThreadMessages[0].body,
        unreadReplyCount: generalThreadRoot.threadReplyCount ?? 0,
        unreadMentionCount: 0,
      })
    : {
        source: "search",
        openConversationId: chatSeedSurface.activeConversationId,
        sourceConversationId: chatSeedSurface.activeConversationId,
        openMode: "joined",
        focusMessageId: chatSeedSurface.transcript[0]?.messageId ?? null,
        activeThreadId: null,
      }

const opsConversationRecord = makeConversationRecord({
  ...conversationById.get("ops"),
  conversationId: "ops",
  title: "ops",
  kind: "channel",
})

const opsRoot = makeProjectedMessage({
  messageId: "ops-root",
  conversationId: "ops",
  author: { kind: "participant", id: "alpha" },
  body: "Infra checklist is green.",
  createdAt: "2026-04-06T08:57:00.000Z",
})

const opsSecond = makeProjectedMessage({
  messageId: "ops-second",
  conversationId: "ops",
  author: { kind: "participant", id: "founder" },
  body: "Keep deploy watch on the queue until launch review wraps.",
  createdAt: "2026-04-06T09:04:00.000Z",
})

const opsProjection: ChatConversationProjection = {
  conversationMessages: [opsRoot, opsSecond],
  mainTranscript: [opsRoot, opsSecond],
  activeThreadRoot: null,
  activeThreadMessages: [],
}

const dmAlphaConversationRecord = makeConversationRecord({
  ...conversationById.get("dm-alpha"),
  conversationId: "dm-alpha",
  title: "Alpha",
  kind: "dm",
})

const dmAlphaProjection: ChatConversationProjection = {
  conversationMessages: [
    makeProjectedMessage({
      messageId: "dm-alpha-root",
      conversationId: "dm-alpha",
      author: { kind: "participant", id: "alpha" },
      body: "I can summarize the release risk thread.",
      createdAt: "2026-04-06T09:08:00.000Z",
    }),
    makeProjectedMessage({
      messageId: "dm-alpha-second",
      conversationId: "dm-alpha",
      author: { kind: "participant", id: "founder" },
      body: "Send me the top three risks before lunch.",
      createdAt: "2026-04-06T09:10:00.000Z",
    }),
  ],
  mainTranscript: [
    makeProjectedMessage({
      messageId: "dm-alpha-root",
      conversationId: "dm-alpha",
      author: { kind: "participant", id: "alpha" },
      body: "I can summarize the release risk thread.",
      createdAt: "2026-04-06T09:08:00.000Z",
    }),
    makeProjectedMessage({
      messageId: "dm-alpha-second",
      conversationId: "dm-alpha",
      author: { kind: "participant", id: "founder" },
      body: "Send me the top three risks before lunch.",
      createdAt: "2026-04-06T09:10:00.000Z",
    }),
  ],
  activeThreadRoot: null,
  activeThreadMessages: [],
}

const dmSamConversationRecord = makeConversationRecord({
  ...conversationById.get("dm-sam"),
  conversationId: "dm-sam",
  title: "Sam",
  kind: "dm",
})

const dmSamProjection: ChatConversationProjection = {
  conversationMessages: [
    makeProjectedMessage({
      messageId: "dm-sam-root",
      conversationId: "dm-sam",
      author: { kind: "participant", id: "sam" },
      body: "Let's review the launch note after lunch.",
      createdAt: "2026-04-06T07:40:00.000Z",
    }),
    makeProjectedMessage({
      messageId: "dm-sam-second",
      conversationId: "dm-sam",
      author: { kind: "participant", id: "founder" },
      body: "Works for me. I'll bring the final copy edits.",
      createdAt: "2026-04-06T07:43:00.000Z",
    }),
  ],
  mainTranscript: [
    makeProjectedMessage({
      messageId: "dm-sam-root",
      conversationId: "dm-sam",
      author: { kind: "participant", id: "sam" },
      body: "Let's review the launch note after lunch.",
      createdAt: "2026-04-06T07:40:00.000Z",
    }),
    makeProjectedMessage({
      messageId: "dm-sam-second",
      conversationId: "dm-sam",
      author: { kind: "participant", id: "founder" },
      body: "Works for me. I'll bring the final copy edits.",
      createdAt: "2026-04-06T07:43:00.000Z",
    }),
  ],
  activeThreadRoot: null,
  activeThreadMessages: [],
}

const financePrivateConversationRecord = makeConversationRecord({
  conversationId: "finance-private",
  title: "finance-private",
  topic: "Quarterly budget review",
  visibility: "private",
  postingPolicy: "open",
  participantIds: ["alpha"],
})

const financePrivateProjection: ChatConversationProjection = {
  conversationMessages: [
    makeProjectedMessage({
      messageId: "finance-private-root",
      conversationId: "finance-private",
      author: { kind: "participant", id: "alpha" },
      body: "quiet viewer room",
      createdAt: "2026-04-06T09:24:00.000Z",
    }),
  ],
  mainTranscript: [
    makeProjectedMessage({
      messageId: "finance-private-root",
      conversationId: "finance-private",
      author: { kind: "participant", id: "alpha" },
      body: "quiet viewer room",
      createdAt: "2026-04-06T09:24:00.000Z",
    }),
  ],
  activeThreadRoot: null,
  activeThreadMessages: [],
}

const conversationRecordById = {
  general: generalConversationRecord,
  ops: opsConversationRecord,
  "dm-alpha": dmAlphaConversationRecord,
  "dm-sam": dmSamConversationRecord,
  "finance-private": financePrivateConversationRecord,
} as const

const projectionByConversationId = {
  general: generalProjection,
  ops: opsProjection,
  "dm-alpha": dmAlphaProjection,
  "dm-sam": dmSamProjection,
  "finance-private": financePrivateProjection,
} as const

const openIntentByConversationId = {
  general: generalOpenIntent,
  ops: {
    source: "search",
    openConversationId: "ops",
    sourceConversationId: "ops",
    openMode: "joined",
    focusMessageId: null,
    activeThreadId: null,
  },
  "dm-alpha": {
    source: "search",
    openConversationId: "dm-alpha",
    sourceConversationId: "dm-alpha",
    openMode: "joined",
    focusMessageId: null,
    activeThreadId: null,
  },
  "dm-sam": {
    source: "search",
    openConversationId: "dm-sam",
    sourceConversationId: "dm-sam",
    openMode: "joined",
    focusMessageId: null,
    activeThreadId: null,
  },
  "finance-private": openViewerRecentConversation({
    conversationId: "finance-private",
    title: "finance-private",
    kind: "channel",
    observedAt: "2026-04-06T09:25:00.000Z",
    latestActivityAt: "2026-04-06T09:24:00.000Z",
    latestMessagePreview: "quiet viewer room",
  }),
} satisfies Record<string, ChatOpenIntent>

const accessGrantsByConversationId: Partial<Record<string, ChatConversationAccessGrant[]>> = {
  general: [
    {
      bindingId: "general-manager-founder",
      subjectId: "founder",
      roleId: "room_manager",
    },
  ],
  ops: [
    {
      bindingId: "ops-manager-founder",
      subjectId: "founder",
      roleId: "room_manager",
    },
  ],
  "finance-private": [
    {
      bindingId: "finance-private-viewer-founder",
      subjectId: "founder",
      roleId: "viewer",
    },
  ],
}

function buildSeedItem(input: {
  conversation: ChatConversationRecord
  projection: ChatConversationProjection
  openIntent: ChatOpenIntent
  canPostMessage: boolean
  accessGrants?: ChatConversationAccessGrant[]
  followedThreadIds?: string[]
}): ChatShellRuntimeSeedItem {
  return {
    conversation: input.conversation,
    projection: input.projection,
    openIntent: input.openIntent,
    canPostMessage: input.canPostMessage,
    accessGrants: input.accessGrants ?? [],
    followedThreadIds: input.followedThreadIds ?? [],
  }
}

function canSeedItemPostMessage(input: {
  actorId: string
  conversation: ChatConversationRecord
  openIntent: ChatOpenIntent
  accessGrants?: ChatConversationAccessGrant[]
}): boolean {
  return canChatActorPostMessages({
    conversation: input.conversation,
    accessGrants: input.accessGrants ?? [],
    actorId: input.actorId,
    openMode: input.openIntent.openMode,
  })
}

function normalizeSeedItemForActor(input: {
  actorId: string
  item: ChatShellRuntimeSeedItem
}): ChatShellRuntimeSeedItem {
  const conversation =
    input.item.conversation.kind === "channel"
      ? input.item.conversation
      : normalizeDirectConversationRecord(input.item.conversation, input.actorId)

  return {
    ...input.item,
    conversation,
    canPostMessage: canSeedItemPostMessage({
      actorId: input.actorId,
      conversation,
      openIntent: input.item.openIntent,
      accessGrants: input.item.accessGrants,
    }),
  }
}

function buildSeedBaseChat(input: {
  actorId: string
  itemsBySidebarItemId: Record<string, ChatShellRuntimeSeedItem>
  defaultSidebarItemId: string
}): ChatSurface {
  const canonicalItems = new Map<string, ChatShellRuntimeSeedItem>()
  for (const [sidebarItemId, item] of Object.entries(input.itemsBySidebarItemId)) {
    const existing = canonicalItems.get(item.conversation.conversationId)
    if (!existing || sidebarItemId === item.conversation.conversationId) {
      canonicalItems.set(item.conversation.conversationId, item)
    }
  }
  const joinedCanonicalItems = [...canonicalItems.values()].filter(
    (item) => item.openIntent.openMode === "joined",
  )

  const sidebarChat = joinedCanonicalItems.reduce<ChatSurface>(
    (chat, item) =>
      upsertSurfaceConversation(
        chat,
        summarizeConversationRecord(item.conversation, item.projection, input.actorId),
      ),
    {
      ...chatSeedSurface,
      activeConversationId: input.defaultSidebarItemId,
      activeConversation: null,
      transcript: [],
      activeThreadRoot: null,
      activeThreadMessages: [],
      composerPlaceholder: "Message room",
      sidebar: {
        ...chatSeedSurface.sidebar,
        inbox: [],
        followedThreads: [],
        channels: [],
        dmGroups: [],
        viewerRecents: [],
      },
    },
  )

  const sidebar = {
    ...sidebarChat.sidebar,
    inbox: buildSeedInboxEntries({
      actorId: input.actorId,
      itemsBySidebarItemId: input.itemsBySidebarItemId,
    }),
    followedThreads: buildSeedFollowedThreadEntries({
      itemsBySidebarItemId: input.itemsBySidebarItemId,
    }),
    viewerRecents: buildSeedViewerRecentEntries({
      actorId: input.actorId,
      itemsBySidebarItemId: input.itemsBySidebarItemId,
    }),
  }

  const activeItem =
    input.itemsBySidebarItemId[input.defaultSidebarItemId] ??
    canonicalItems.get(input.defaultSidebarItemId) ??
    canonicalItems.values().next().value ??
    null
  const activeConversation = activeItem
    ? summarizeConversationRecord(activeItem.conversation, activeItem.projection, input.actorId)
    : null

  return {
    ...sidebarChat,
    sidebar,
    activeConversationId:
      activeItem?.conversation.conversationId ?? chatSeedSurface.activeConversationId,
    activeConversation,
    transcript: activeItem?.projection.mainTranscript ?? [],
    activeThreadRoot: activeItem?.projection.activeThreadRoot ?? null,
    activeThreadMessages: activeItem?.projection.activeThreadMessages ?? [],
    composerPlaceholder: activeConversation
      ? activeConversation.kind === "channel"
        ? `Message #${activeConversation.title}`
        : `Message ${activeConversation.title}`
      : chatSeedSurface.composerPlaceholder,
  }
}

export function createChatShellRuntimeSeed(input?: { actorId?: string }): ChatShellRuntimeSeed {
  const actorId = input?.actorId ?? DEFAULT_PARTICIPANT_ID
  const itemsBySidebarItemId = {
    general: buildSeedItem({
      conversation: conversationRecordById.general,
      projection: projectionByConversationId.general,
      openIntent: openIntentByConversationId.general,
      canPostMessage: canSeedItemPostMessage({
        actorId,
        conversation: conversationRecordById.general,
        openIntent: openIntentByConversationId.general,
        accessGrants: accessGrantsByConversationId.general,
      }),
      accessGrants: accessGrantsByConversationId.general,
      followedThreadIds: generalThreadRoot ? [generalThreadRoot.messageId] : [],
    }),
    ops: buildSeedItem({
      conversation: conversationRecordById.ops,
      projection: projectionByConversationId.ops,
      openIntent: openIntentByConversationId.ops,
      canPostMessage: canSeedItemPostMessage({
        actorId,
        conversation: conversationRecordById.ops,
        openIntent: openIntentByConversationId.ops,
        accessGrants: accessGrantsByConversationId.ops,
      }),
      accessGrants: accessGrantsByConversationId.ops,
    }),
    "dm-alpha": buildSeedItem({
      conversation: conversationRecordById["dm-alpha"],
      projection: projectionByConversationId["dm-alpha"],
      openIntent: openIntentByConversationId["dm-alpha"],
      canPostMessage: canSeedItemPostMessage({
        actorId,
        conversation: conversationRecordById["dm-alpha"],
        openIntent: openIntentByConversationId["dm-alpha"],
      }),
    }),
    "dm-sam": buildSeedItem({
      conversation: conversationRecordById["dm-sam"],
      projection: projectionByConversationId["dm-sam"],
      openIntent: openIntentByConversationId["dm-sam"],
      canPostMessage: canSeedItemPostMessage({
        actorId,
        conversation: conversationRecordById["dm-sam"],
        openIntent: openIntentByConversationId["dm-sam"],
      }),
    }),
    ...Object.fromEntries(
      [...inboxEntryById.values()].map((entry) => [
        entry.entryId,
        buildSeedItem({
          conversation:
            conversationRecordById[entry.conversationId as keyof typeof conversationRecordById] ??
            generalConversationRecord,
          projection:
            projectionByConversationId[
              entry.conversationId as keyof typeof projectionByConversationId
            ] ?? generalProjection,
          openIntent: openInboxEntry(entry),
          canPostMessage: canSeedItemPostMessage({
            actorId,
            conversation:
              conversationRecordById[entry.conversationId as keyof typeof conversationRecordById] ??
              generalConversationRecord,
            openIntent: openInboxEntry(entry),
            accessGrants: accessGrantsByConversationId[entry.conversationId],
          }),
          followedThreadIds:
            entry.conversationId === "general" && generalThreadRoot
              ? [generalThreadRoot.messageId]
              : [],
        }),
      ]),
    ),
    ...Object.fromEntries(
      [...followedThreadById.values()].map((entry) => [
        entry.entryId,
        buildSeedItem({
          conversation:
            conversationRecordById[entry.conversationId as keyof typeof conversationRecordById] ??
            generalConversationRecord,
          projection:
            projectionByConversationId[
              entry.conversationId as keyof typeof projectionByConversationId
            ] ?? generalProjection,
          openIntent: openFollowedThread({
            conversationId: entry.conversationId,
            conversationTitle: conversationById.get(entry.conversationId)?.title ?? entry.title,
            threadRootMessageId: entry.threadRootMessageId,
            threadRootPreview: entry.preview,
            latestReplyAt: entry.latestReplyAt,
            latestReplyPreview: entry.preview,
            unreadReplyCount: entry.unreadReplyCount,
            unreadMentionCount: entry.unreadMentionCount,
          }),
          canPostMessage: canSeedItemPostMessage({
            actorId,
            conversation:
              conversationRecordById[entry.conversationId as keyof typeof conversationRecordById] ??
              generalConversationRecord,
            openIntent: openFollowedThread({
              conversationId: entry.conversationId,
              conversationTitle: conversationById.get(entry.conversationId)?.title ?? entry.title,
              threadRootMessageId: entry.threadRootMessageId,
              threadRootPreview: entry.preview,
              latestReplyAt: entry.latestReplyAt,
              latestReplyPreview: entry.preview,
              unreadReplyCount: entry.unreadReplyCount,
              unreadMentionCount: entry.unreadMentionCount,
            }),
            accessGrants: accessGrantsByConversationId[entry.conversationId],
          }),
          followedThreadIds: [entry.threadRootMessageId],
        }),
      ]),
    ),
    ...Object.fromEntries(
      [...viewerRecentById.values()].map((entry) => [
        entry.entryId,
        buildSeedItem({
          conversation:
            conversationRecordById[entry.conversationId as keyof typeof conversationRecordById] ??
            financePrivateConversationRecord,
          projection:
            projectionByConversationId[
              entry.conversationId as keyof typeof projectionByConversationId
            ] ?? financePrivateProjection,
          openIntent: openViewerRecentConversation({
            conversationId: entry.conversationId,
            title: entry.title,
            kind: "channel",
            observedAt: entry.observedAt,
            latestActivityAt:
              projectionByConversationId[
                entry.conversationId as keyof typeof projectionByConversationId
              ]?.mainTranscript.at(-1)?.createdAt ?? null,
            latestMessagePreview: entry.preview,
          }),
          canPostMessage: false,
          accessGrants: accessGrantsByConversationId[entry.conversationId],
        }),
      ]),
    ),
  }
  const actorItemsBySidebarItemId = Object.fromEntries(
    Object.entries(itemsBySidebarItemId).map(([sidebarItemId, item]) => [
      sidebarItemId,
      normalizeSeedItemForActor({ actorId, item }),
    ]),
  )

  return syncDerivedSidebarItems({
    actorId,
    baseChat: buildSeedBaseChat({
      actorId,
      itemsBySidebarItemId: actorItemsBySidebarItemId,
      defaultSidebarItemId: defaultActiveSidebarItemId,
    }),
    defaultSidebarItemId: defaultActiveSidebarItemId,
    itemsBySidebarItemId: actorItemsBySidebarItemId,
  })
}

export const defaultChatShellRuntimeSeed = createChatShellRuntimeSeed()

export function restoreChatShellRuntimeSeed(
  persisted: string | null | undefined,
): ChatShellRuntimeSeed {
  if (!persisted) {
    return createChatShellRuntimeSeed()
  }

  try {
    const parsed = JSON.parse(persisted)
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof Reflect.get(parsed, "actorId") !== "string" ||
      typeof Reflect.get(parsed, "defaultSidebarItemId") !== "string" ||
      typeof Reflect.get(parsed, "baseChat") !== "object" ||
      Reflect.get(parsed, "baseChat") === null ||
      typeof Reflect.get(parsed, "itemsBySidebarItemId") !== "object" ||
      Reflect.get(parsed, "itemsBySidebarItemId") === null
    ) {
      return createChatShellRuntimeSeed()
    }

    return syncDerivedSidebarItems(parsed as ChatShellRuntimeSeed)
  } catch {
    return createChatShellRuntimeSeed()
  }
}

export function restoreChatDraftPersistence(
  persisted: string | null | undefined,
): ChatDraftPersistence {
  if (!persisted) {
    return {
      conversationDrafts: {},
      threadDrafts: {},
      conversationAudienceSelections: {},
      threadAudienceSelections: {},
    }
  }

  try {
    const parsed = JSON.parse(persisted)
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid persisted chat drafts")
    }

    return {
      conversationDrafts:
        typeof Reflect.get(parsed, "conversationDrafts") === "object" &&
        Reflect.get(parsed, "conversationDrafts") !== null
          ? (Reflect.get(parsed, "conversationDrafts") as Record<string, string>)
          : {},
      threadDrafts:
        typeof Reflect.get(parsed, "threadDrafts") === "object" &&
        Reflect.get(parsed, "threadDrafts") !== null
          ? (Reflect.get(parsed, "threadDrafts") as Record<string, string>)
          : {},
      conversationAudienceSelections:
        typeof Reflect.get(parsed, "conversationAudienceSelections") === "object" &&
        Reflect.get(parsed, "conversationAudienceSelections") !== null
          ? (Reflect.get(parsed, "conversationAudienceSelections") as Record<
              string,
              string | null | undefined
            >)
          : {},
      threadAudienceSelections:
        typeof Reflect.get(parsed, "threadAudienceSelections") === "object" &&
        Reflect.get(parsed, "threadAudienceSelections") !== null
          ? (Reflect.get(parsed, "threadAudienceSelections") as Record<
              string,
              string | null | undefined
            >)
          : {},
    }
  } catch {
    return {
      conversationDrafts: {},
      threadDrafts: {},
      conversationAudienceSelections: {},
      threadAudienceSelections: {},
    }
  }
}

export function retargetChatShellRuntimeSeed(
  seed: ChatShellRuntimeSeed,
  actorId: string,
): ChatShellRuntimeSeed {
  if (seed.actorId === actorId) {
    return seed
  }

  const actorItemsBySidebarItemId = Object.fromEntries(
    Object.entries(seed.itemsBySidebarItemId).map(([sidebarItemId, item]) => [
      sidebarItemId,
      normalizeSeedItemForActor({ actorId, item }),
    ]),
  )
  const defaultSidebarItemId =
    actorItemsBySidebarItemId[seed.defaultSidebarItemId] != null
      ? seed.defaultSidebarItemId
      : (Object.keys(actorItemsBySidebarItemId)[0] ?? seed.defaultSidebarItemId)
  const baseChat = buildSeedBaseChat({
    actorId,
    itemsBySidebarItemId: actorItemsBySidebarItemId,
    defaultSidebarItemId,
  })

  return syncDerivedSidebarItems({
    ...seed,
    actorId,
    baseChat,
    defaultSidebarItemId,
    itemsBySidebarItemId: actorItemsBySidebarItemId,
  })
}

function nextSequence(projection: ChatConversationProjection): number {
  return (
    projection.conversationMessages.reduce(
      (maxSequence, message) => Math.max(maxSequence, message.scopeSequence),
      0,
    ) + 1
  )
}

function nextTimestamp(projection: ChatConversationProjection): string {
  const latest = projection.conversationMessages.reduce((latestValue, message) => {
    return message.createdAt > latestValue ? message.createdAt : latestValue
  }, "2026-04-06T09:00:00.000Z")
  const next = new Date(latest)
  next.setMinutes(next.getMinutes() + 1)
  return next.toISOString()
}

function nextSeedTimestamp(seed: ChatShellRuntimeSeed): string {
  const latest = Object.values(seed.itemsBySidebarItemId).reduce((latestValue, item) => {
    const projectionLatest = item.projection.conversationMessages.reduce(
      (currentLatest, message) => {
        return message.createdAt > currentLatest ? message.createdAt : currentLatest
      },
      item.conversation.updatedAt,
    )
    return projectionLatest > latestValue ? projectionLatest : latestValue
  }, "2026-04-06T09:00:00.000Z")
  const next = new Date(latest)
  next.setMinutes(next.getMinutes() + 1)
  return next.toISOString()
}

function updateConversationSummary(
  conversation: ChatConversation,
  projection: ChatConversationProjection,
  overrides: Partial<Pick<ChatConversation, "unreadCount" | "mentionCount">> = {},
): ChatConversation {
  const latestMessage = projection.conversationMessages.reduce<ChatProjectedMessage | null>(
    (latest, message) => {
      if (!latest || message.createdAt > latest.createdAt) {
        return message
      }
      return latest
    },
    null,
  )

  return {
    ...conversation,
    unreadCount: overrides.unreadCount ?? conversation.unreadCount,
    mentionCount: overrides.mentionCount ?? conversation.mentionCount,
    latestActivityAt: latestMessage?.createdAt ?? conversation.latestActivityAt,
    latestMessagePreview: latestMessage?.body ?? conversation.latestMessagePreview,
    messageCount: projection.conversationMessages.length,
  }
}

function compareNullableIsoDescending(left: string | null, right: string | null): number {
  const leftValue = left ?? ""
  const rightValue = right ?? ""
  return rightValue.localeCompare(leftValue)
}

function sortSidebarConversations(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort((left, right) => {
    const latestActivityOrder = compareNullableIsoDescending(
      left.latestActivityAt,
      right.latestActivityAt,
    )
    if (latestActivityOrder !== 0) {
      return latestActivityOrder
    }
    const leftAttention = left.unreadCount + left.mentionCount
    const rightAttention = right.unreadCount + right.mentionCount
    if (leftAttention !== rightAttention) {
      return rightAttention - leftAttention
    }
    return left.title.localeCompare(right.title)
  })
}

function sortFollowedThreads(
  threads: ChatSurface["sidebar"]["followedThreads"],
): ChatSurface["sidebar"]["followedThreads"] {
  return [...threads].sort((left, right) => {
    const leftAttention = left.unreadReplyCount + left.unreadMentionCount
    const rightAttention = right.unreadReplyCount + right.unreadMentionCount
    if (leftAttention !== rightAttention) {
      return rightAttention - leftAttention
    }
    const latestReplyOrder = compareNullableIsoDescending(left.latestReplyAt, right.latestReplyAt)
    if (latestReplyOrder !== 0) {
      return latestReplyOrder
    }
    return left.title.localeCompare(right.title)
  })
}

function sortViewerRecents(
  recents: ChatSurface["sidebar"]["viewerRecents"],
): ChatSurface["sidebar"]["viewerRecents"] {
  return [...recents].sort((left, right) => {
    const observedOrder = compareNullableIsoDescending(left.observedAt, right.observedAt)
    if (observedOrder !== 0) {
      return observedOrder
    }
    return left.title.localeCompare(right.title)
  })
}

function sortInboxEntries(
  entries: ChatSurface["sidebar"]["inbox"],
): ChatSurface["sidebar"]["inbox"] {
  return [...entries].sort((left, right) => {
    const leftResolved = Boolean(left.resolvedAt)
    const rightResolved = Boolean(right.resolvedAt)
    if (leftResolved !== rightResolved) {
      return leftResolved ? 1 : -1
    }
    if (leftResolved && rightResolved) {
      return (right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? "")
    }
    return right.createdAt.localeCompare(left.createdAt)
  })
}

function updateSurfaceConversation(
  chat: ChatSurface,
  conversationId: string,
  updater: (conversation: ChatConversation) => ChatConversation,
): ChatSurface {
  const updateCollection = (conversations: ChatConversation[]) =>
    conversations.map((conversation) =>
      conversation.conversationId === conversationId ? updater(conversation) : conversation,
    )

  return {
    ...chat,
    activeConversation:
      chat.activeConversation?.conversationId === conversationId
        ? updater(chat.activeConversation)
        : chat.activeConversation,
    sidebar: {
      ...chat.sidebar,
      channels: sortSidebarConversations(updateCollection(chat.sidebar.channels)),
      dmGroups: chat.sidebar.dmGroups.map((group) => ({
        ...group,
        conversations: sortSidebarConversations(updateCollection(group.conversations)),
      })),
    },
  }
}

function summarizeConversationRecord(
  conversation: ChatConversationRecord,
  projection: ChatConversationProjection,
  actorId: string,
): ChatConversation {
  const latestMessage = projection.conversationMessages.reduce<ChatProjectedMessage | null>(
    (latest, message) => {
      if (!latest || message.createdAt > latest.createdAt) {
        return message
      }
      return latest
    },
    null,
  )

  return {
    conversationId: conversation.conversationId,
    kind: conversation.kind,
    slug: conversation.slug,
    title: conversation.title,
    topic: conversation.topic,
    visibility: conversation.visibility,
    postingPolicy: conversation.postingPolicy,
    lifecycleState: conversation.lifecycleState,
    section: conversation.section,
    dmGroup:
      conversation.kind === "channel"
        ? null
        : conversation.participantIds.includes(actorId)
          ? "with-viewer"
          : "without-viewer",
    participantIds: conversation.participantIds,
    predecessorConversationId: conversation.predecessorConversationId,
    lineageRootConversationId: conversation.lineageRootConversationId,
    historyMode: conversation.historyMode,
    unreadCount: 0,
    mentionCount: 0,
    latestActivityAt: latestMessage?.createdAt ?? conversation.updatedAt,
    latestMessagePreview: latestMessage?.body ?? "",
    messageCount: projection.conversationMessages.length,
  }
}

function participantLabel(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function findProjectedMessage(
  projection: ChatConversationProjection,
  messageId: string | null,
): ChatProjectedMessage | null {
  if (!messageId) {
    return null
  }
  return (
    projection.conversationMessages.find((message) => message.messageId === messageId) ??
    projection.mainTranscript.find((message) => message.messageId === messageId) ??
    null
  )
}

function buildSeedInboxEntries(input: {
  actorId: string
  itemsBySidebarItemId: Record<string, ChatShellRuntimeSeedItem>
}): ChatSurface["sidebar"]["inbox"] {
  const entries = Object.entries(input.itemsBySidebarItemId)
    .filter(([, item]) => item.openIntent.source === "inbox")
    .map(([entryId, item]) => {
      const focusMessage = findProjectedMessage(item.projection, item.openIntent.focusMessageId)
      if (!focusMessage) {
        return null
      }

      const existingEntry = inboxEntryById.get(entryId)
      const kind =
        existingEntry?.kind ?? (item.conversation.kind === "channel" ? "mention" : "direct")
      const joinedConversation =
        item.conversation.kind === "channel" ||
        item.conversation.participantIds.includes(input.actorId)
      const directedAtActor =
        focusMessage.audience?.kind === "participant" && focusMessage.audience.id === input.actorId
      const mentionedActor = focusMessage.mentionedIds.includes(input.actorId)
      const includeEntry =
        kind === "direct"
          ? joinedConversation
          : joinedConversation && (directedAtActor || mentionedActor)

      if (!includeEntry) {
        return null
      }

      return {
        entryId,
        kind,
        title:
          kind === "direct" ? item.conversation.title : `Mention in ${item.conversation.title}`,
        preview: focusMessage.body,
        conversationId: item.conversation.conversationId,
        messageId: focusMessage.messageId,
        createdAt: focusMessage.createdAt,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)

  return sortInboxEntries(entries)
}

function buildSeedFollowedThreadEntries(input: {
  itemsBySidebarItemId: Record<string, ChatShellRuntimeSeedItem>
}): ChatSurface["sidebar"]["followedThreads"] {
  const entriesById = new Map<string, ChatSurface["sidebar"]["followedThreads"][number]>()

  for (const [, item] of Object.entries(input.itemsBySidebarItemId)) {
    if (!(item.openIntent.source === "thread" && item.openIntent.activeThreadId)) {
      continue
    }
    const entryId = `thread:${item.conversation.conversationId}:${item.openIntent.activeThreadId}`
    const entry = buildFollowedThreadEntry({
      conversation: item.conversation,
      projection: item.projection,
      threadId: item.openIntent.activeThreadId,
      existingEntry: followedThreadById.get(entryId),
    })
    if (entry) {
      entriesById.set(entry.entryId, entry)
    }
  }

  return sortFollowedThreads([...entriesById.values()])
}

function buildSeedViewerRecentEntries(input: {
  actorId: string
  itemsBySidebarItemId: Record<string, ChatShellRuntimeSeedItem>
}): ChatSurface["sidebar"]["viewerRecents"] {
  const entries = Object.entries(input.itemsBySidebarItemId)
    .filter(
      ([, item]) =>
        item.openIntent.source === "viewer-recent" &&
        !item.conversation.participantIds.includes(input.actorId),
    )
    .map(([entryId, item]) =>
      buildViewerRecentEntry({
        conversation: item.conversation,
        projection: item.projection,
        observedAt:
          viewerRecentById.get(entryId)?.observedAt ??
          item.projection.mainTranscript.at(-1)?.createdAt ??
          item.conversation.updatedAt,
      }),
    )

  return sortViewerRecents(entries)
}

function grantBindingId(input: {
  conversationId: string
  subjectId: string
  roleId: ChatConversationAccessGrant["roleId"]
}): string {
  return `${input.conversationId}:${input.roleId}:${input.subjectId}`
}

function describeAccessGranted(
  subjectId: string,
  roleId: ChatConversationAccessGrant["roleId"],
): string {
  if (roleId === "participant") {
    return `${participantLabel(subjectId)} was invited to the room.`
  }
  if (roleId === "viewer") {
    return `${participantLabel(subjectId)} can now view the room.`
  }
  return `${participantLabel(subjectId)} can now manage the room.`
}

function describeAccessRevoked(
  subjectId: string,
  roleId: ChatConversationAccessGrant["roleId"],
): string {
  if (roleId === "participant") {
    return `Room invite for ${participantLabel(subjectId)} was revoked.`
  }
  if (roleId === "viewer") {
    return `Viewer access for ${participantLabel(subjectId)} was revoked.`
  }
  return `Room manager access for ${participantLabel(subjectId)} was revoked.`
}

function normalizeDirectConversationRecord(
  conversation: ChatConversationRecord,
  actorId: string,
): ChatConversationRecord {
  if (conversation.kind === "channel") {
    return conversation
  }

  const participantIds = Array.from(new Set(conversation.participantIds))
  const visibleParticipantIds = participantIds.includes(actorId)
    ? participantIds.filter((participantId) => participantId !== actorId)
    : participantIds
  const titleSource = visibleParticipantIds.length > 0 ? visibleParticipantIds : participantIds
  const title =
    !participantIds.includes(actorId) && titleSource.length === 2
      ? titleSource.map(participantLabel).join(" + ")
      : titleSource.map(participantLabel).join(", ")

  return {
    ...conversation,
    kind: participantIds.length <= 2 ? "dm" : "group_dm",
    section: "dms",
    slug: null,
    title,
    visibility: "private",
    participantIds,
  }
}

function listKnownParticipantIds(seed: ChatShellRuntimeSeed): string[] {
  return Array.from(
    new Set(
      Object.values(seed.itemsBySidebarItemId).flatMap((item) => [
        ...item.conversation.participantIds,
        ...(item.accessGrants ?? []).map((grant) => grant.subjectId),
      ]),
    ),
  )
    .filter((participantId) => participantId !== seed.actorId)
    .sort((left, right) => participantLabel(left).localeCompare(participantLabel(right)))
}

function upsertSurfaceConversation(chat: ChatSurface, summary: ChatConversation): ChatSurface {
  const channelExists = chat.sidebar.channels.some(
    (conversation) => conversation.conversationId === summary.conversationId,
  )
  const normalizedDmGroups = chat.sidebar.dmGroups.map((group) => ({
    ...group,
    conversations: group.conversations.filter(
      (conversation) => conversation.conversationId !== summary.conversationId,
    ),
  }))

  if (summary.kind === "channel") {
    return {
      ...chat,
      sidebar: {
        ...chat.sidebar,
        channels: channelExists
          ? sortSidebarConversations(
              chat.sidebar.channels.map((conversation) =>
                conversation.conversationId === summary.conversationId ? summary : conversation,
              ),
            )
          : sortSidebarConversations([...chat.sidebar.channels, summary]),
        dmGroups: normalizedDmGroups,
      },
    }
  }

  const targetGroupId = summary.dmGroup ?? "with-viewer"
  const existingGroup = normalizedDmGroups.find((group) => group.id === targetGroupId)
  const nextGroups = existingGroup
    ? normalizedDmGroups.map((group) =>
        group.id === targetGroupId
          ? {
              ...group,
              conversations: sortSidebarConversations([...group.conversations, summary]),
            }
          : group,
      )
    : [
        ...normalizedDmGroups,
        {
          id: targetGroupId,
          label: targetGroupId === "with-viewer" ? "With You" : "Others",
          conversations: [summary],
        },
      ]

  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      channels: chat.sidebar.channels.filter(
        (conversation) => conversation.conversationId !== summary.conversationId,
      ),
      dmGroups: nextGroups.map((group) => ({
        ...group,
        conversations: sortSidebarConversations(group.conversations),
      })),
    },
  }
}

function prependChannelConversation(chat: ChatSurface, summary: ChatConversation): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      channels: sortSidebarConversations([summary, ...chat.sidebar.channels]),
      dmGroups: chat.sidebar.dmGroups,
    },
  }
}

function slugifyConversationTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "room"
}

function ensureUniqueConversationId(seed: ChatShellRuntimeSeed, baseId: string): string {
  const existingIds = new Set(
    Object.values(seed.itemsBySidebarItemId).map((item) => item.conversation.conversationId),
  )
  if (!existingIds.has(baseId)) {
    return baseId
  }
  let suffix = 2
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1
  }
  return `${baseId}-${suffix}`
}

function canonicalParticipantKey(participantIds: string[]): string {
  return [...participantIds].sort().join(",")
}

function findExistingDirectConversationId(
  seed: ChatShellRuntimeSeed,
  participantIds: string[],
): string | null {
  const targetKey = canonicalParticipantKey(participantIds)
  const seenConversationIds = new Set<string>()
  for (const item of Object.values(seed.itemsBySidebarItemId)) {
    if (item.conversation.kind === "channel") {
      continue
    }
    if (seenConversationIds.has(item.conversation.conversationId)) {
      continue
    }
    seenConversationIds.add(item.conversation.conversationId)
    if (canonicalParticipantKey(item.conversation.participantIds) === targetKey) {
      return item.conversation.conversationId
    }
  }
  return null
}

function buildFollowedThreadEntry(input: {
  conversation: ChatConversationRecord
  projection: ChatConversationProjection
  threadId: string
  existingEntry?: ChatSurface["sidebar"]["followedThreads"][number]
}): ChatSurface["sidebar"]["followedThreads"][number] | null {
  const rootMessage =
    input.projection.mainTranscript.find((message) => message.messageId === input.threadId) ??
    input.projection.conversationMessages.find((message) => message.messageId === input.threadId) ??
    null
  if (!rootMessage) {
    return null
  }
  const latestReply = input.projection.conversationMessages
    .filter((message) => message.threadId === input.threadId)
    .at(-1)

  return {
    entryId: `thread:${input.conversation.conversationId}:${input.threadId}`,
    title: input.conversation.title,
    preview: latestReply?.body ?? rootMessage.body,
    conversationId: input.conversation.conversationId,
    threadRootMessageId: input.threadId,
    unreadReplyCount: input.existingEntry?.unreadReplyCount ?? 0,
    unreadMentionCount: input.existingEntry?.unreadMentionCount ?? 0,
    latestReplyAt: latestReply?.createdAt ?? null,
  }
}

function updateFollowedThreadAttention(
  chat: ChatSurface,
  conversationId: string,
  threadId: string,
  updater: (
    entry: ChatSurface["sidebar"]["followedThreads"][number],
  ) => ChatSurface["sidebar"]["followedThreads"][number],
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      followedThreads: sortFollowedThreads(
        chat.sidebar.followedThreads.map((entry) =>
          entry.conversationId === conversationId && entry.threadRootMessageId === threadId
            ? updater(entry)
            : entry,
        ),
      ),
    },
  }
}

function clearFollowedThreadAttention(
  chat: ChatSurface,
  conversationId: string,
  threadId: string,
): ChatSurface {
  return updateFollowedThreadAttention(chat, conversationId, threadId, (entry) => ({
    ...entry,
    unreadReplyCount: 0,
    unreadMentionCount: 0,
  }))
}

function clearConversationFollowedThreadAttention(
  chat: ChatSurface,
  conversationId: string,
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      followedThreads: sortFollowedThreads(
        chat.sidebar.followedThreads.map((entry) =>
          entry.conversationId === conversationId
            ? {
                ...entry,
                unreadReplyCount: 0,
                unreadMentionCount: 0,
              }
            : entry,
        ),
      ),
    },
  }
}

function updateFollowedThreadEntries(
  chat: ChatSurface,
  item: ChatShellRuntimeSeedItem,
  followedThreadIds: string[],
): ChatSurface {
  const preservedEntries = chat.sidebar.followedThreads.filter(
    (entry) => entry.conversationId !== item.conversation.conversationId,
  )
  const existingEntries = new Map(
    chat.sidebar.followedThreads
      .filter((entry) => entry.conversationId === item.conversation.conversationId)
      .map((entry) => [entry.entryId, entry]),
  )
  const rebuiltEntries = followedThreadIds
    .map((threadId) =>
      buildFollowedThreadEntry({
        conversation: item.conversation,
        projection: item.projection,
        threadId,
        existingEntry: existingEntries.get(
          `thread:${item.conversation.conversationId}:${threadId}`,
        ),
      }),
    )
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)

  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      followedThreads: sortFollowedThreads([...preservedEntries, ...rebuiltEntries]),
    },
  }
}

function removeInboxEntriesForConversation(chat: ChatSurface, conversationId: string): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      inbox: chat.sidebar.inbox.filter((entry) => entry.conversationId !== conversationId),
    },
  }
}

function removeViewerRecentConversation(chat: ChatSurface, conversationId: string): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      viewerRecents: sortViewerRecents(
        chat.sidebar.viewerRecents.filter(
          (conversation) => conversation.conversationId !== conversationId,
        ),
      ),
    },
  }
}

function upsertViewerRecentConversation(
  chat: ChatSurface,
  entry: ChatSurface["sidebar"]["viewerRecents"][number],
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      viewerRecents: sortViewerRecents([
        ...chat.sidebar.viewerRecents.filter(
          (conversation) => conversation.conversationId !== entry.conversationId,
        ),
        entry,
      ]),
    },
  }
}

function updateViewerRecentConversation(
  chat: ChatSurface,
  conversationId: string,
  updater: (
    conversation: ChatSurface["sidebar"]["viewerRecents"][number],
  ) => ChatSurface["sidebar"]["viewerRecents"][number],
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      viewerRecents: sortViewerRecents(
        chat.sidebar.viewerRecents.map((conversation) =>
          conversation.conversationId === conversationId ? updater(conversation) : conversation,
        ),
      ),
    },
  }
}

function updateInboxEntryPreview(
  chat: ChatSurface,
  conversationId: string,
  messageId: string,
  preview: string,
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      inbox: chat.sidebar.inbox.map((entry) =>
        entry.conversationId === conversationId && entry.messageId === messageId
          ? {
              ...entry,
              preview,
            }
          : entry,
      ),
    },
  }
}

function upsertInboxEntry(
  chat: ChatSurface,
  entry: ChatSurface["sidebar"]["inbox"][number],
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      inbox: sortInboxEntries([
        ...chat.sidebar.inbox.filter(
          (current) =>
            !(current.conversationId === entry.conversationId && current.kind === entry.kind),
        ),
        {
          ...entry,
          resolvedAt: null,
        },
      ]),
    },
  }
}

function updateSeedItemsForConversation(
  seed: ChatShellRuntimeSeed,
  conversationId: string,
  updater: (item: ChatShellRuntimeSeedItem) => ChatShellRuntimeSeedItem,
): Record<string, ChatShellRuntimeSeedItem> {
  return Object.fromEntries(
    Object.entries(seed.itemsBySidebarItemId).map(([itemId, item]) => [
      itemId,
      item.openIntent.openConversationId === conversationId ? updater(item) : item,
    ]),
  )
}

function clearConversationAttention(chat: ChatSurface, conversationId: string): ChatSurface {
  return updateSurfaceConversation(
    {
      ...chat,
      sidebar: {
        ...chat.sidebar,
        inbox: sortInboxEntries(
          chat.sidebar.inbox.map((entry) =>
            entry.conversationId === conversationId
              ? {
                  ...entry,
                  resolvedAt: entry.resolvedAt ?? new Date().toISOString(),
                }
              : entry,
          ),
        ),
      },
    },
    conversationId,
    (conversation) => ({
      ...conversation,
      unreadCount: 0,
      mentionCount: 0,
    }),
  )
}

function removeSurfaceConversation(chat: ChatSurface, conversationId: string): ChatSurface {
  return {
    ...chat,
    activeConversation:
      chat.activeConversation?.conversationId === conversationId ? null : chat.activeConversation,
    sidebar: {
      ...chat.sidebar,
      channels: chat.sidebar.channels.filter(
        (conversation) => conversation.conversationId !== conversationId,
      ),
      dmGroups: chat.sidebar.dmGroups.map((group) => ({
        ...group,
        conversations: group.conversations.filter(
          (conversation) => conversation.conversationId !== conversationId,
        ),
      })),
    },
  }
}

function removeFollowedThreadEntriesForConversation(
  chat: ChatSurface,
  conversationId: string,
): ChatSurface {
  return {
    ...chat,
    sidebar: {
      ...chat.sidebar,
      followedThreads: chat.sidebar.followedThreads.filter(
        (entry) => entry.conversationId !== conversationId,
      ),
    },
  }
}

function buildViewerRecentEntry(input: {
  conversation: ChatConversationRecord
  projection: ChatConversationProjection
  observedAt: string
}): ChatSurface["sidebar"]["viewerRecents"][number] {
  return {
    entryId: `viewer:${input.conversation.conversationId}`,
    title: input.conversation.title,
    preview:
      input.projection.mainTranscript.at(-1)?.body ??
      input.projection.conversationMessages.at(-1)?.body ??
      input.conversation.title,
    conversationId: input.conversation.conversationId,
    observedAt: input.observedAt,
  }
}

function appendMainlineMessage(
  projection: ChatConversationProjection,
  message: ChatProjectedMessage,
): ChatConversationProjection {
  return {
    ...projection,
    conversationMessages: [...projection.conversationMessages, message],
    mainTranscript: [...projection.mainTranscript, message],
    activeThreadRoot: projection.activeThreadRoot,
    activeThreadMessages: projection.activeThreadMessages,
  }
}

function appendThreadReply(
  projection: ChatConversationProjection,
  reply: ChatProjectedMessage,
): ChatConversationProjection {
  const replies = [
    ...projection.conversationMessages.filter((message) => message.threadId === reply.threadId),
    reply,
  ]
  const patchRoot = (message: ChatProjectedMessage): ChatProjectedMessage =>
    message.messageId === reply.threadId
      ? {
          ...message,
          threadReplyCount: replies.length,
          threadPreview: reply.body,
          threadPreviewAuthorId: reply.author.id,
          threadLastReplyAt: reply.createdAt,
        }
      : message

  return {
    ...projection,
    conversationMessages: [...projection.conversationMessages.map(patchRoot), reply],
    mainTranscript: projection.mainTranscript.map(patchRoot),
    activeThreadRoot:
      projection.activeThreadRoot?.messageId === reply.threadId
        ? patchRoot(projection.activeThreadRoot)
        : projection.activeThreadRoot,
    activeThreadMessages:
      projection.activeThreadRoot?.messageId === reply.threadId
        ? [...projection.activeThreadMessages, reply]
        : projection.activeThreadMessages,
  }
}

function appendSystemConversationEvent(
  projection: ChatConversationProjection,
  input: {
    conversationId: string
    body: string
    createdAt: string
    systemEventKind: ChatProjectedMessage["systemEventKind"]
  },
): ChatConversationProjection {
  const scopeSequence = nextSequence(projection)
  const message = makeProjectedMessage({
    messageId: `${input.conversationId}-system-${scopeSequence}`,
    conversationId: input.conversationId,
    author: { kind: "system", id: "system" },
    body: input.body,
    createdAt: input.createdAt,
    scopeSequence,
    sequence: scopeSequence,
    revision: scopeSequence,
    messageKind: "system-event",
    systemEventKind: input.systemEventKind,
  })
  return appendMainlineMessage(projection, message)
}

export interface ChatSearchResult {
  resultKind: "message" | "conversation"
  sidebarItemId: string
  conversationId: string
  conversationTitle: string
  messageId: string | null
  threadId: string | null
  openMode: ChatOpenMode
  preview: string
  createdAt: string
}

export function chatSearchResultKey(result: ChatSearchResult): string {
  return [
    result.sidebarItemId,
    result.resultKind,
    result.messageId ?? "room",
    result.threadId ?? "main",
  ].join(":")
}

export function resolveChatSearchSelection(
  results: readonly ChatSearchResult[],
  activeKey: string | null,
): {
  activeKey: string | null
  activeIndex: number
} {
  if (results.length === 0) {
    return {
      activeKey: null,
      activeIndex: 0,
    }
  }

  if (!activeKey) {
    return {
      activeKey: chatSearchResultKey(results[0]),
      activeIndex: 0,
    }
  }

  const activeIndex = results.findIndex((result) => chatSearchResultKey(result) === activeKey)
  if (activeIndex === -1) {
    return {
      activeKey: chatSearchResultKey(results[0]),
      activeIndex: 0,
    }
  }

  return {
    activeKey,
    activeIndex,
  }
}

export function searchChatMessages(seed: ChatShellRuntimeSeed, query: string): ChatSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  const canonicalItems = new Map<
    string,
    { sidebarItemId: string; item: ChatShellRuntimeSeedItem }
  >()
  for (const [sidebarItemId, item] of Object.entries(seed.itemsBySidebarItemId)) {
    const existing = canonicalItems.get(item.conversation.conversationId)
    if (!existing || sidebarItemId === item.conversation.conversationId) {
      canonicalItems.set(item.conversation.conversationId, { sidebarItemId, item })
    }
  }

  return [...canonicalItems.values()]
    .flatMap(({ sidebarItemId, item }) => {
      const messageResults = item.projection.conversationMessages
        .filter((message) => message.body.toLowerCase().includes(normalizedQuery))
        .map((message) => ({
          resultKind: "message" as const,
          sidebarItemId,
          conversationId: item.conversation.conversationId,
          conversationTitle: item.conversation.title,
          messageId: message.messageId,
          threadId: message.threadId,
          openMode: item.openIntent.openMode,
          preview: message.body,
          createdAt: message.createdAt,
        }))

      const conversationMatches =
        item.conversation.title.toLowerCase().includes(normalizedQuery) ||
        item.conversation.topic?.toLowerCase().includes(normalizedQuery)
      const conversationResults =
        conversationMatches && messageResults.length === 0
          ? [
              {
                resultKind: "conversation" as const,
                sidebarItemId,
                conversationId: item.conversation.conversationId,
                conversationTitle: item.conversation.title,
                messageId: null,
                threadId: null,
                openMode: item.openIntent.openMode,
                preview: item.conversation.topic ?? item.conversation.title,
                createdAt:
                  item.projection.mainTranscript.at(-1)?.createdAt ?? item.conversation.updatedAt,
              },
            ]
          : []

      return [...conversationResults, ...messageResults]
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, SEARCH_RESULT_LIMIT)
}

export function openChatSearchResult(
  seed: ChatShellRuntimeSeed,
  result: ChatSearchResult,
): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(seed, result.sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const nextSeed = {
    ...resolved.seed,
    itemsBySidebarItemId: {
      ...resolved.seed.itemsBySidebarItemId,
      [result.sidebarItemId]: {
        ...item,
        openIntent: {
          source: "search",
          openConversationId: item.conversation.conversationId,
          sourceConversationId: result.conversationId,
          openMode: result.openMode,
          focusMessageId: result.messageId,
          activeThreadId: result.threadId,
        } satisfies ChatOpenIntent,
      },
    },
  }
  const openedSeed = result.threadId
    ? {
        ...nextSeed,
        baseChat: clearFollowedThreadAttention(
          nextSeed.baseChat,
          result.conversationId,
          result.threadId,
        ),
      }
    : nextSeed
  return openChatSidebarItem(openedSeed, result.sidebarItemId)
}

export function createChatConversation(input: {
  seed: ChatShellRuntimeSeed
  title: string
  creatorId: string
  visibility?: ChatConversationRecord["visibility"]
}): { seed: ChatShellRuntimeSeed; sidebarItemId: string } {
  const title = input.title.trim()
  if (!title) {
    return {
      seed: input.seed,
      sidebarItemId: input.seed.defaultSidebarItemId,
    }
  }

  const baseId = slugifyConversationTitle(title)
  const conversationId = ensureUniqueConversationId(input.seed, baseId)
  const createdAt = nextSeedTimestamp(input.seed)
  const conversation = makeConversationRecord({
    conversationId,
    title,
    slug: conversationId,
    visibility: input.visibility ?? "public",
    participantIds: [input.creatorId],
    createdAt,
    updatedAt: createdAt,
  })
  const projection: ChatConversationProjection = {
    conversationMessages: [],
    mainTranscript: [],
    activeThreadRoot: null,
    activeThreadMessages: [],
  }
  const summary = summarizeConversationRecord(conversation, projection, input.creatorId)
  const seedItem = buildSeedItem({
    conversation,
    projection,
    openIntent: {
      source: "search",
      openConversationId: conversationId,
      sourceConversationId: conversationId,
      openMode: "joined",
      focusMessageId: null,
      activeThreadId: null,
    } satisfies ChatOpenIntent,
    canPostMessage: true,
    accessGrants: [
      {
        bindingId: grantBindingId({
          conversationId,
          subjectId: input.creatorId,
          roleId: "room_manager",
        }),
        subjectId: input.creatorId,
        roleId: "room_manager",
      },
    ],
  })

  return {
    sidebarItemId: conversationId,
    seed: {
      ...input.seed,
      baseChat: {
        ...prependChannelConversation(input.seed.baseChat, summary),
        activeConversationId: conversationId,
        activeConversation: summary,
        transcript: [],
        activeThreadRoot: null,
        activeThreadMessages: [],
        composerPlaceholder: `Message #${title}`,
      },
      itemsBySidebarItemId: {
        ...input.seed.itemsBySidebarItemId,
        [conversationId]: seedItem,
      },
    },
  }
}

export function createChatDirectConversation(input: {
  seed: ChatShellRuntimeSeed
  creatorId: string
  participantIds: string[]
}): { seed: ChatShellRuntimeSeed; sidebarItemId: string } {
  const otherParticipantIds = Array.from(
    new Set(
      input.participantIds
        .map((participantId) => participantId.trim())
        .filter((participantId) => participantId && participantId !== input.creatorId),
    ),
  )
  if (otherParticipantIds.length === 0) {
    return {
      seed: input.seed,
      sidebarItemId: input.seed.defaultSidebarItemId,
    }
  }
  const canonicalParticipants = [input.creatorId, ...otherParticipantIds]
  const existingConversationId = findExistingDirectConversationId(input.seed, canonicalParticipants)
  if (existingConversationId) {
    return {
      seed: input.seed,
      sidebarItemId: existingConversationId,
    }
  }

  const kind: ChatConversationRecord["kind"] = otherParticipantIds.length === 1 ? "dm" : "group_dm"
  const baseId = `${kind === "dm" ? "dm" : "group"}-${otherParticipantIds.join("-")}`
  const conversationId = ensureUniqueConversationId(input.seed, baseId)
  const createdAt = nextSeedTimestamp(input.seed)
  const conversation = normalizeDirectConversationRecord(
    makeConversationRecord({
      conversationId,
      kind,
      title: otherParticipantIds.map(participantLabel).join(", "),
      slug: null,
      visibility: "private",
      participantIds: canonicalParticipants,
      createdAt,
      updatedAt: createdAt,
    }),
    input.creatorId,
  )
  const projection: ChatConversationProjection = {
    conversationMessages: [],
    mainTranscript: [],
    activeThreadRoot: null,
    activeThreadMessages: [],
  }
  const summary = summarizeConversationRecord(conversation, projection, input.creatorId)
  const seedItem = buildSeedItem({
    conversation,
    projection,
    openIntent: {
      source: "search",
      openConversationId: conversationId,
      sourceConversationId: conversationId,
      openMode: "joined",
      focusMessageId: null,
      activeThreadId: null,
    } satisfies ChatOpenIntent,
    canPostMessage: true,
  })

  return {
    sidebarItemId: conversationId,
    seed: {
      ...input.seed,
      baseChat: {
        ...upsertSurfaceConversation(input.seed.baseChat, summary),
        activeConversationId: conversationId,
        activeConversation: summary,
        transcript: [],
        activeThreadRoot: null,
        activeThreadMessages: [],
        composerPlaceholder: `Message ${conversation.title}`,
      },
      itemsBySidebarItemId: {
        ...input.seed.itemsBySidebarItemId,
        [conversationId]: seedItem,
      },
    },
  }
}

export function toggleChatConversationPostingPolicy(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const nextPostingPolicy = item.conversation.postingPolicy === "open" ? "restricted" : "open"
  const createdAt = nextSeedTimestamp(resolved.seed)

  return applyConversationMutation({
    seed: resolved.seed,
    sidebarItemId: input.sidebarItemId,
    mutateProjection: (projection) =>
      appendSystemConversationEvent(projection, {
        conversationId: item.conversation.conversationId,
        body: `Room posting policy changed to ${nextPostingPolicy}.`,
        createdAt,
        systemEventKind: "room-posting-policy-changed",
      }),
    updateConversationRecord: (conversation) => ({
      ...conversation,
      postingPolicy: nextPostingPolicy,
      updatedAt: createdAt,
    }),
    updateChatSurface: (chat, conversationId, projection) =>
      updateSurfaceConversation(chat, conversationId, (conversation) =>
        updateConversationSummary(
          {
            ...conversation,
            postingPolicy: nextPostingPolicy,
          },
          projection,
        ),
      ),
  })
}

export function updateChatConversationDetails(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  title?: string
  topic?: string | null
  visibility?: ChatConversationRecord["visibility"]
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const trimmedTitle = input.title?.trim()
  const nextTitle = trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : item.conversation.title
  const trimmedTopic =
    input.topic === undefined
      ? undefined
      : typeof input.topic === "string"
        ? input.topic.trim()
        : null
  const nextTopic =
    input.topic === undefined ? item.conversation.topic : trimmedTopic ? trimmedTopic : null
  const nextVisibility = input.visibility ?? item.conversation.visibility
  const titleChanged = nextTitle !== item.conversation.title
  const topicChanged = nextTopic !== item.conversation.topic
  const visibilityChanged = nextVisibility !== item.conversation.visibility
  if (!titleChanged && !topicChanged && !visibilityChanged) {
    return resolved.seed
  }

  const createdAt = nextSeedTimestamp(resolved.seed)

  return applyConversationMutation({
    seed: resolved.seed,
    sidebarItemId: input.sidebarItemId,
    mutateProjection: (projection) => {
      let nextProjection = projection
      if (titleChanged) {
        nextProjection = appendSystemConversationEvent(nextProjection, {
          conversationId: item.conversation.conversationId,
          body: `Room renamed to "${nextTitle}".`,
          createdAt,
          systemEventKind: "room-renamed",
        })
      }
      if (topicChanged) {
        nextProjection = appendSystemConversationEvent(nextProjection, {
          conversationId: item.conversation.conversationId,
          body: nextTopic === null ? "Room topic cleared." : `Room topic set to "${nextTopic}".`,
          createdAt,
          systemEventKind: "room-topic-changed",
        })
      }
      return nextProjection
    },
    updateConversationRecord: (conversation) => ({
      ...conversation,
      title: nextTitle,
      topic: nextTopic,
      visibility: nextVisibility,
      updatedAt: createdAt,
    }),
    updateChatSurface: (chat, conversationId, projection) => {
      const nextChat = updateSurfaceConversation(chat, conversationId, (conversation) =>
        updateConversationSummary(
          {
            ...conversation,
            title: nextTitle,
            topic: nextTopic,
            visibility: nextVisibility,
          },
          projection,
        ),
      )
      return updateViewerRecentConversation(nextChat, conversationId, (conversation) => ({
        ...conversation,
        title: nextTitle,
      }))
    },
  })
}

export function archiveChatConversation(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item || item.conversation.lifecycleState === "archived") {
    return resolved.seed
  }

  const createdAt = nextSeedTimestamp(resolved.seed)

  return applyConversationMutation({
    seed: resolved.seed,
    sidebarItemId: input.sidebarItemId,
    mutateProjection: (projection) =>
      appendSystemConversationEvent(projection, {
        conversationId: item.conversation.conversationId,
        body: "Room archived.",
        createdAt,
        systemEventKind: "room-archived",
      }),
    updateConversationRecord: (conversation) => ({
      ...conversation,
      lifecycleState: "archived",
      updatedAt: createdAt,
    }),
    updateChatSurface: (chat, conversationId, projection) =>
      updateSurfaceConversation(chat, conversationId, (conversation) =>
        updateConversationSummary(
          {
            ...conversation,
            lifecycleState: "archived",
          },
          projection,
        ),
      ),
  })
}

function rebuildProjectionThreadState(
  projection: ChatConversationProjection,
): ChatConversationProjection {
  const repliesByThreadId = new Map<string, ChatProjectedMessage[]>()
  for (const message of projection.conversationMessages) {
    if (!message.threadId) {
      continue
    }
    const replies = repliesByThreadId.get(message.threadId)
    if (replies) {
      replies.push(message)
    } else {
      repliesByThreadId.set(message.threadId, [message])
    }
  }

  const patchThreadRoot = (message: ChatProjectedMessage): ChatProjectedMessage => {
    const replies = repliesByThreadId.get(message.messageId) ?? []
    const latestReply = replies.at(-1) ?? null
    return {
      ...message,
      threadReplyCount: replies.length > 0 ? replies.length : undefined,
      threadPreview: latestReply?.body ?? null,
      threadPreviewAuthorId: latestReply?.author.id ?? null,
      threadLastReplyAt: latestReply?.createdAt ?? null,
    }
  }

  const mainTranscript = projection.mainTranscript.map(patchThreadRoot)
  const conversationMessages = projection.conversationMessages.map((message) =>
    message.threadId ? message : patchThreadRoot(message),
  )

  const activeThreadId =
    projection.activeThreadRoot?.messageId ?? projection.activeThreadMessages[0]?.threadId ?? null

  return {
    ...projection,
    conversationMessages,
    mainTranscript,
    activeThreadRoot: activeThreadId
      ? (mainTranscript.find((message) => message.messageId === activeThreadId) ??
        conversationMessages.find((message) => message.messageId === activeThreadId) ??
        null)
      : null,
    activeThreadMessages: activeThreadId
      ? conversationMessages.filter((message) => message.threadId === activeThreadId)
      : [],
  }
}

function updateProjectionMessage(
  projection: ChatConversationProjection,
  messageId: string,
  updater: (message: ChatProjectedMessage) => ChatProjectedMessage,
): ChatConversationProjection {
  let found = false
  let changed = false
  const apply = (message: ChatProjectedMessage) => {
    if (message.messageId !== messageId) {
      return message
    }
    found = true
    const nextMessage = updater(message)
    if (nextMessage !== message) {
      changed = true
    }
    return nextMessage
  }

  if (!projection.conversationMessages.some((message) => message.messageId === messageId)) {
    return projection
  }

  const nextProjection = {
    ...projection,
    conversationMessages: projection.conversationMessages.map(apply),
    mainTranscript: projection.mainTranscript.map(apply),
    activeThreadRoot: projection.activeThreadRoot ? apply(projection.activeThreadRoot) : null,
    activeThreadMessages: projection.activeThreadMessages.map(apply),
  }

  return found && changed ? rebuildProjectionThreadState(nextProjection) : projection
}

function applyConversationMutation(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  mutateProjection: (projection: ChatConversationProjection) => ChatConversationProjection
  updateConversationRecord?: (
    conversation: ChatConversationRecord,
    projection: ChatConversationProjection,
  ) => ChatConversationRecord
  updateChatSurface?: (
    chat: ChatSurface,
    conversationId: string,
    projection: ChatConversationProjection,
  ) => ChatSurface
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const conversationId = item.conversation.conversationId
  const nextProjection = input.mutateProjection(item.projection)
  const nextConversationRecord = input.updateConversationRecord
    ? input.updateConversationRecord(item.conversation, nextProjection)
    : item.conversation
  if (nextProjection === item.projection && nextConversationRecord === item.conversation) {
    return resolved.seed
  }
  const nextChatBase = input.updateChatSurface
    ? input.updateChatSurface(resolved.seed.baseChat, conversationId, nextProjection)
    : updateSurfaceConversation(resolved.seed.baseChat, conversationId, (conversation) =>
        updateConversationSummary(conversation, nextProjection),
      )

  return {
    ...resolved.seed,
    baseChat: nextChatBase,
    itemsBySidebarItemId: updateSeedItemsForConversation(
      resolved.seed,
      conversationId,
      (seedItem) => {
        const nextSeedItem = {
          ...seedItem,
          conversation: nextConversationRecord,
          projection: nextProjection,
        }
        return {
          ...nextSeedItem,
          canPostMessage: canSeedItemPostMessage({
            actorId: resolved.seed.actorId,
            conversation: nextSeedItem.conversation,
            openIntent: nextSeedItem.openIntent,
            accessGrants: nextSeedItem.accessGrants,
          }),
        }
      },
    ),
  }
}

export function appendChatMessage(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  body: string
  senderId: string
  threadId: string | null
  audienceId?: string | null
  activeSidebarItemId?: string | null
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const projection = item.projection
  const scopeSequence = nextSequence(projection)
  const createdAt = nextSeedTimestamp(resolved.seed)
  const message = makeProjectedMessage({
    messageId: `${item.conversation.conversationId}-${input.threadId ? "reply" : "msg"}-${scopeSequence}`,
    conversationId: item.conversation.conversationId,
    threadId: input.threadId,
    author: { kind: "participant", id: input.senderId },
    audience: input.audienceId ? { kind: "participant", id: input.audienceId } : null,
    body: input.body.trim(),
    createdAt,
    scopeSequence,
    sequence: scopeSequence,
    revision: scopeSequence,
    threadReplyCount: undefined,
    threadPreview: null,
    threadPreviewAuthorId: null,
    threadLastReplyAt: null,
  })

  const nextProjection = input.threadId
    ? appendThreadReply(projection, message)
    : appendMainlineMessage(projection, message)
  const updatedItem: ChatShellRuntimeSeedItem = {
    ...item,
    projection: nextProjection,
    openIntent: {
      ...item.openIntent,
      focusMessageId: message.messageId,
      activeThreadId: input.threadId,
    },
  }

  const nextConversation = {
    ...item.conversation,
    updatedAt: createdAt,
  }
  const activeViewerItemId = input.activeSidebarItemId ?? null
  const activeViewerConversationId = activeViewerItemId
    ? (resolved.seed.itemsBySidebarItemId[activeViewerItemId]?.openIntent.openConversationId ??
      null)
    : null
  const localRoomVisible =
    activeViewerConversationId === item.conversation.conversationId &&
    item.openIntent.openMode === "joined"
  const directedAtLocal =
    input.audienceId === resolved.seed.actorId ||
    message.mentionedIds.includes(resolved.seed.actorId)
  const directConversation =
    item.conversation.kind === "dm" || item.conversation.kind === "group_dm"
  const shouldRaiseConversationAttention =
    input.senderId !== resolved.seed.actorId && input.threadId === null && !localRoomVisible
  const inboxKind = directConversation ? "direct" : "mention"

  let nextChat = updateSurfaceConversation(
    removeInboxEntriesForConversation(resolved.seed.baseChat, item.conversation.conversationId),
    item.conversation.conversationId,
    (conversation) =>
      updateConversationSummary(conversation, nextProjection, {
        unreadCount: shouldRaiseConversationAttention ? conversation.unreadCount + 1 : 0,
        mentionCount:
          shouldRaiseConversationAttention && directedAtLocal ? conversation.mentionCount + 1 : 0,
      }),
  )
  if (shouldRaiseConversationAttention && (directConversation || directedAtLocal)) {
    nextChat = upsertInboxEntry(nextChat, {
      entryId: `${inboxKind}:${message.messageId}`,
      kind: inboxKind,
      title:
        inboxKind === "direct" ? item.conversation.title : `Mention in ${item.conversation.title}`,
      preview: message.body,
      conversationId: item.conversation.conversationId,
      messageId: message.messageId,
      createdAt: message.createdAt,
    })
  }
  nextChat = updateFollowedThreadEntries(nextChat, updatedItem, updatedItem.followedThreadIds ?? [])
  if (input.threadId && (updatedItem.followedThreadIds ?? []).includes(input.threadId)) {
    const threadVisible =
      item.openIntent.openMode === "joined" && item.openIntent.activeThreadId === input.threadId
    const shouldClearAttention = input.senderId === resolved.seed.actorId || threadVisible
    nextChat = shouldClearAttention
      ? clearFollowedThreadAttention(nextChat, item.conversation.conversationId, input.threadId)
      : updateFollowedThreadAttention(
          nextChat,
          item.conversation.conversationId,
          input.threadId,
          (entry) => ({
            ...entry,
            unreadReplyCount: entry.unreadReplyCount + 1,
            unreadMentionCount:
              entry.unreadMentionCount + (input.audienceId === resolved.seed.actorId ? 1 : 0),
          }),
        )
  }

  return {
    ...resolved.seed,
    baseChat: nextChat,
    itemsBySidebarItemId: Object.fromEntries(
      Object.entries(resolved.seed.itemsBySidebarItemId).map(([itemId, seedItem]) => {
        if (seedItem.openIntent.openConversationId !== item.conversation.conversationId) {
          return [itemId, seedItem]
        }

        if (itemId === input.sidebarItemId) {
          return [
            itemId,
            {
              ...updatedItem,
              conversation: nextConversation,
            },
          ]
        }

        return [
          itemId,
          {
            ...seedItem,
            conversation: nextConversation,
            projection: nextProjection,
          },
        ]
      }),
    ),
  }
}

export function markChatConversationRead(
  seed: ChatShellRuntimeSeed,
  conversationId: string,
): ChatShellRuntimeSeed {
  return {
    ...seed,
    baseChat: clearConversationFollowedThreadAttention(
      clearConversationAttention(seed.baseChat, conversationId),
      conversationId,
    ),
  }
}

function syncDerivedSidebarItems(seed: ChatShellRuntimeSeed): ChatShellRuntimeSeed {
  const nextItems = { ...seed.itemsBySidebarItemId }
  const derivedItemIds = new Set<string>()
  const surfaceConversations = [
    ...seed.baseChat.sidebar.channels,
    ...seed.baseChat.sidebar.dmGroups.flatMap((group) => group.conversations),
  ]

  for (const summary of surfaceConversations) {
    if (nextItems[summary.conversationId]) {
      continue
    }
    const canonicalItem = Object.values(nextItems).find(
      (item) => item.conversation.conversationId === summary.conversationId,
    )
    if (!canonicalItem) {
      continue
    }
    nextItems[summary.conversationId] = {
      ...canonicalItem,
      openIntent: {
        source: "search",
        openConversationId: summary.conversationId,
        sourceConversationId: summary.conversationId,
        openMode: "joined",
        focusMessageId: null,
        activeThreadId: null,
      },
      canPostMessage: canSeedItemPostMessage({
        actorId: seed.actorId,
        conversation: canonicalItem.conversation,
        openIntent: {
          source: "search",
          openConversationId: summary.conversationId,
          sourceConversationId: summary.conversationId,
          openMode: "joined",
          focusMessageId: null,
          activeThreadId: null,
        },
        accessGrants: canonicalItem.accessGrants,
      }),
    }
  }

  for (const entry of seed.baseChat.sidebar.inbox) {
    derivedItemIds.add(entry.entryId)
    const canonicalItem =
      nextItems[entry.conversationId] ??
      Object.values(nextItems).find(
        (item) => item.conversation.conversationId === entry.conversationId,
      )
    if (!canonicalItem) {
      continue
    }
    nextItems[entry.entryId] = {
      ...canonicalItem,
      openIntent: openInboxEntry(entry),
    }
  }

  for (const thread of seed.baseChat.sidebar.followedThreads) {
    derivedItemIds.add(thread.entryId)
    const canonicalItem =
      nextItems[thread.conversationId] ??
      Object.values(nextItems).find(
        (item) => item.conversation.conversationId === thread.conversationId,
      )
    if (!canonicalItem) {
      continue
    }
    nextItems[thread.entryId] = {
      ...canonicalItem,
      openIntent: openFollowedThread({
        conversationId: thread.conversationId,
        conversationTitle: thread.title,
        threadRootMessageId: thread.threadRootMessageId,
        threadRootPreview: thread.preview,
        latestReplyAt: thread.latestReplyAt,
        latestReplyPreview: thread.preview,
        unreadReplyCount: thread.unreadReplyCount,
        unreadMentionCount: thread.unreadMentionCount,
      }),
      followedThreadIds: Array.from(
        new Set([...(canonicalItem.followedThreadIds ?? []), thread.threadRootMessageId]),
      ),
    }
  }

  for (const viewer of seed.baseChat.sidebar.viewerRecents) {
    derivedItemIds.add(viewer.entryId)
    const canonicalItem =
      nextItems[viewer.conversationId] ??
      Object.values(nextItems).find(
        (item) => item.conversation.conversationId === viewer.conversationId,
      )
    if (!canonicalItem) {
      continue
    }
    nextItems[viewer.entryId] = {
      ...canonicalItem,
      openIntent: openViewerRecentConversation({
        conversationId: viewer.conversationId,
        title: viewer.title,
        kind: canonicalItem.conversation.kind,
        observedAt: viewer.observedAt,
        latestActivityAt: canonicalItem.projection.mainTranscript.at(-1)?.createdAt ?? null,
        latestMessagePreview: viewer.preview,
      }),
      canPostMessage: false,
    }
  }

  for (const itemId of Object.keys(nextItems)) {
    if (
      (itemId.startsWith("mention:") ||
        itemId.startsWith("direct:") ||
        itemId.startsWith("thread:") ||
        itemId.startsWith("viewer:")) &&
      !derivedItemIds.has(itemId)
    ) {
      delete nextItems[itemId]
    }
  }

  return {
    ...seed,
    itemsBySidebarItemId: nextItems,
  }
}

function resolveSeedItem(seed: ChatShellRuntimeSeed, sidebarItemId: string) {
  const syncedSeed = syncDerivedSidebarItems(seed)
  return {
    seed: syncedSeed,
    item: syncedSeed.itemsBySidebarItemId[sidebarItemId] ?? null,
  }
}

export function openChatSidebarItem(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
): ChatShellRuntimeSeed {
  const syncedSeed = syncDerivedSidebarItems(seed)
  const item = syncedSeed.itemsBySidebarItemId[sidebarItemId]
  if (!item) {
    return syncedSeed
  }

  let nextSeed = syncedSeed
  if (item.openIntent.openMode === "joined") {
    nextSeed = {
      ...nextSeed,
      baseChat: clearConversationAttention(nextSeed.baseChat, item.openIntent.openConversationId),
    }
  }
  if (item.openIntent.activeThreadId) {
    nextSeed = clearChatThreadAttention(nextSeed, sidebarItemId, item.openIntent.activeThreadId)
  }
  return nextSeed
}

export function resolveChatSidebarSelection(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
): string {
  const syncedSeed = syncDerivedSidebarItems(seed)
  const item = syncedSeed.itemsBySidebarItemId[sidebarItemId]
  if (!item) {
    return syncedSeed.defaultSidebarItemId
  }
  return item.openIntent.source === "inbox" ? item.openIntent.openConversationId : sidebarItemId
}

export function clearChatThreadAttention(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
  threadId: string | null,
): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(seed, sidebarItemId)
  const item = resolved.item
  if (!item || !threadId) {
    return resolved.seed
  }
  return {
    ...resolved.seed,
    baseChat: clearFollowedThreadAttention(
      resolved.seed.baseChat,
      item.conversation.conversationId,
      threadId,
    ),
  }
}

export function markChatThreadRead(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
  threadId: string,
): ChatShellRuntimeSeed {
  return clearChatThreadAttention(seed, sidebarItemId, threadId)
}

export function setChatThreadOpenState(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
  messageId: string | null,
): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(seed, sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const nextSeed = {
    ...resolved.seed,
    itemsBySidebarItemId: {
      ...resolved.seed.itemsBySidebarItemId,
      [sidebarItemId]: {
        ...item,
        openIntent: {
          ...item.openIntent,
          focusMessageId: messageId,
          activeThreadId: messageId,
        },
      },
    },
  }
  return clearChatThreadAttention(nextSeed, sidebarItemId, messageId)
}

export function setChatThreadFollowState(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
  threadId: string,
  followed: boolean,
): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(seed, sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  const followedThreadIds = followed
    ? Array.from(new Set([...(item.followedThreadIds ?? []), threadId]))
    : (item.followedThreadIds ?? []).filter((currentThreadId) => currentThreadId !== threadId)

  return {
    ...resolved.seed,
    baseChat: updateFollowedThreadEntries(resolved.seed.baseChat, item, followedThreadIds),
    itemsBySidebarItemId: {
      ...resolved.seed.itemsBySidebarItemId,
      [sidebarItemId]: {
        ...item,
        followedThreadIds,
      },
    },
  }
}

export function toggleChatMessageReaction(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  messageId: string
  emoji: string
  participantId: string
}): ChatShellRuntimeSeed {
  return applyConversationMutation({
    seed: input.seed,
    sidebarItemId: input.sidebarItemId,
    mutateProjection: (projection) =>
      updateProjectionMessage(projection, input.messageId, (message) => {
        if (message.author.kind !== "participant" || message.redactedAt) {
          return message
        }
        const existing = message.reactions.find((reaction) => reaction.emoji === input.emoji)
        const participantIds = existing?.participantIds ?? []
        const active = participantIds.includes(input.participantId)
        const nextParticipantIds = active
          ? participantIds.filter((participantId) => participantId !== input.participantId)
          : [...participantIds, input.participantId]
        const nextReactions =
          active && nextParticipantIds.length === 0
            ? message.reactions.filter((reaction) => reaction.emoji !== input.emoji)
            : message.reactions.map((reaction) =>
                reaction.emoji === input.emoji
                  ? {
                      ...reaction,
                      participantIds: nextParticipantIds,
                      count: nextParticipantIds.length,
                    }
                  : reaction,
              )

        const ensuredReactions =
          !active && !existing
            ? [
                ...nextReactions,
                {
                  emoji: input.emoji,
                  participantIds: nextParticipantIds,
                  count: nextParticipantIds.length,
                } satisfies ChatMessageReaction,
              ]
            : nextReactions

        return {
          ...message,
          reactions: ensuredReactions,
        }
      }),
  })
}

export function editChatMessage(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  messageId: string
  body: string
  actorId: string
}): ChatShellRuntimeSeed {
  const nextBody = input.body.trim()
  if (!nextBody) {
    return input.seed
  }

  return applyConversationMutation({
    seed: input.seed,
    sidebarItemId: input.sidebarItemId,
    mutateProjection: (projection) => {
      const editedAt = nextTimestamp(projection)
      return updateProjectionMessage(projection, input.messageId, (message) => {
        if (
          message.author.kind !== "participant" ||
          message.author.id !== input.actorId ||
          message.redactedAt ||
          message.body === nextBody
        ) {
          return message
        }

        return {
          ...message,
          body: nextBody,
          content: nextBody,
          editedAt,
          editedById: input.actorId,
        }
      })
    },
    updateConversationRecord: (conversation, projection) => ({
      ...conversation,
      updatedAt: nextTimestamp(projection),
    }),
    updateChatSurface: (chat, conversationId, projection) =>
      updateSurfaceConversation(
        updateInboxEntryPreview(chat, conversationId, input.messageId, nextBody),
        conversationId,
        (conversation) => updateConversationSummary(conversation, projection),
      ),
  })
}

export function redactChatMessage(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  messageId: string
  actorId: string
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item) {
    return resolved.seed
  }

  return applyConversationMutation({
    seed: resolved.seed,
    sidebarItemId: input.sidebarItemId,
    mutateProjection: (projection) => {
      const redactedAt = nextTimestamp(projection)
      const actorCanModerate = canChatActorModerateMessages({
        conversation: item.conversation,
        accessGrants: item.accessGrants ?? [],
        actorId: input.actorId,
        openMode: item.openIntent.openMode,
      })
      return updateProjectionMessage(projection, input.messageId, (message) => {
        if (
          message.author.kind !== "participant" ||
          (message.author.id !== input.actorId && !actorCanModerate) ||
          message.redactedAt
        ) {
          return message
        }

        return {
          ...message,
          body: CHAT_REDACTED_MESSAGE_BODY,
          content: CHAT_REDACTED_MESSAGE_BODY,
          redactedAt,
          redactedById: input.actorId,
        }
      })
    },
    updateConversationRecord: (conversation, projection) => ({
      ...conversation,
      updatedAt: nextTimestamp(projection),
    }),
    updateChatSurface: (chat, conversationId, projection) =>
      updateSurfaceConversation(
        updateInboxEntryPreview(chat, conversationId, input.messageId, CHAT_REDACTED_MESSAGE_BODY),
        conversationId,
        (conversation) => updateConversationSummary(conversation, projection),
      ),
  })
}

export function joinChatConversation(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
  participantId: string,
): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(seed, sidebarItemId)
  const item = resolved.item
  if (!item || item.openIntent.openMode !== "viewer") {
    return resolved.seed
  }

  const conversationId = item.conversation.conversationId
  const createdAt = nextSeedTimestamp(resolved.seed)
  const nextConversationRecord = normalizeDirectConversationRecord(
    {
      ...item.conversation,
      participantIds: Array.from(new Set([...item.conversation.participantIds, participantId])),
      updatedAt: createdAt,
    },
    resolved.seed.actorId,
  )
  const nextProjection = appendSystemConversationEvent(item.projection, {
    conversationId,
    body: `${participantLabel(participantId)} joined the room.`,
    createdAt,
    systemEventKind: "participant-added",
  })
  const nextChat = updateSurfaceConversation(
    resolved.seed.baseChat,
    conversationId,
    (conversation) =>
      updateConversationSummary(
        {
          ...conversation,
          participantIds: Array.from(new Set([...conversation.participantIds, participantId])),
        },
        nextProjection,
      ),
  )
  const nextSummary = summarizeConversationRecord(
    nextConversationRecord,
    nextProjection,
    resolved.seed.actorId,
  )
  const joinedSummary: ChatConversation = {
    ...nextSummary,
    participantIds: Array.from(new Set([...nextSummary.participantIds, participantId])),
  }

  return {
    ...resolved.seed,
    baseChat: upsertSurfaceConversation(
      removeViewerRecentConversation(nextChat, conversationId),
      joinedSummary,
    ),
    itemsBySidebarItemId: updateSeedItemsForConversation(
      resolved.seed,
      conversationId,
      (seedItem) => ({
        ...seedItem,
        conversation: nextConversationRecord,
        projection: nextProjection,
        openIntent: {
          ...seedItem.openIntent,
          openMode: "joined",
        },
        canPostMessage: canSeedItemPostMessage({
          actorId: resolved.seed.actorId,
          conversation: nextConversationRecord,
          openIntent: {
            ...seedItem.openIntent,
            openMode: "joined",
          },
          accessGrants: seedItem.accessGrants,
        }),
      }),
    ),
  }
}

export function removeChatConversationParticipant(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  participantId: string
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item || item.openIntent.openMode !== "joined") {
    return resolved.seed
  }
  if (!item.conversation.participantIds.includes(input.participantId)) {
    return resolved.seed
  }
  if (item.conversation.participantIds.length <= 1) {
    return resolved.seed
  }

  const createdAt = nextSeedTimestamp(resolved.seed)
  const nextConversationRecord = normalizeDirectConversationRecord(
    {
      ...item.conversation,
      participantIds: item.conversation.participantIds.filter((id) => id !== input.participantId),
      updatedAt: createdAt,
    },
    resolved.seed.actorId,
  )
  const nextProjection = appendSystemConversationEvent(item.projection, {
    conversationId: item.conversation.conversationId,
    body: `Removed ${participantLabel(input.participantId)} from the room.`,
    createdAt,
    systemEventKind: "participant-left",
  })
  const nextSummary = summarizeConversationRecord(
    nextConversationRecord,
    nextProjection,
    resolved.seed.actorId,
  )

  return {
    ...resolved.seed,
    baseChat: {
      ...upsertSurfaceConversation(resolved.seed.baseChat, nextSummary),
      activeConversation:
        resolved.seed.baseChat.activeConversation?.conversationId ===
        item.conversation.conversationId
          ? nextSummary
          : resolved.seed.baseChat.activeConversation,
      transcript:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? nextProjection.mainTranscript
          : resolved.seed.baseChat.transcript,
      activeThreadRoot:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? null
          : resolved.seed.baseChat.activeThreadRoot,
      activeThreadMessages:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? []
          : resolved.seed.baseChat.activeThreadMessages,
    },
    itemsBySidebarItemId: updateSeedItemsForConversation(
      resolved.seed,
      item.conversation.conversationId,
      (seedItem) => ({
        ...seedItem,
        accessGrants: (seedItem.accessGrants ?? []).filter(
          (grant) =>
            grant.subjectId !== input.participantId ||
            (grant.roleId !== "participant" && grant.roleId !== "room_manager"),
        ),
        conversation: nextConversationRecord,
        projection: nextProjection,
      }),
    ),
  }
}

export function addChatConversationParticipant(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  participantId: string
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  const participantId = input.participantId.trim()
  if (!item || item.openIntent.openMode !== "joined" || !participantId) {
    return resolved.seed
  }
  if (item.conversation.kind === "dm" || item.conversation.lifecycleState === "archived") {
    return resolved.seed
  }
  if (item.conversation.participantIds.includes(participantId)) {
    return resolved.seed
  }

  const createdAt = nextSeedTimestamp(resolved.seed)
  const nextConversationRecord = normalizeDirectConversationRecord(
    {
      ...item.conversation,
      participantIds: [...item.conversation.participantIds, participantId],
      updatedAt: createdAt,
    },
    resolved.seed.actorId,
  )
  const nextProjection = appendSystemConversationEvent(item.projection, {
    conversationId: item.conversation.conversationId,
    body: `${participantLabel(participantId)} joined the room.`,
    createdAt,
    systemEventKind: "participant-added",
  })
  const nextSummary = summarizeConversationRecord(
    nextConversationRecord,
    nextProjection,
    resolved.seed.actorId,
  )

  return {
    ...resolved.seed,
    baseChat: {
      ...upsertSurfaceConversation(resolved.seed.baseChat, nextSummary),
      activeConversation:
        resolved.seed.baseChat.activeConversation?.conversationId ===
        item.conversation.conversationId
          ? nextSummary
          : resolved.seed.baseChat.activeConversation,
      transcript:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? nextProjection.mainTranscript
          : resolved.seed.baseChat.transcript,
      activeThreadRoot:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? null
          : resolved.seed.baseChat.activeThreadRoot,
      activeThreadMessages:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? []
          : resolved.seed.baseChat.activeThreadMessages,
    },
    itemsBySidebarItemId: updateSeedItemsForConversation(
      resolved.seed,
      item.conversation.conversationId,
      (seedItem) => ({
        ...seedItem,
        conversation: nextConversationRecord,
        projection: nextProjection,
      }),
    ),
  }
}

export function grantChatConversationAccess(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  participantId: string
  roleId: ChatConversationAccessGrant["roleId"]
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  const participantId = input.participantId.trim()
  if (!item || item.openIntent.openMode !== "joined" || !participantId) {
    return resolved.seed
  }
  if (item.conversation.kind === "dm" || item.conversation.lifecycleState === "archived") {
    return resolved.seed
  }

  const bindingId = grantBindingId({
    conversationId: item.conversation.conversationId,
    subjectId: participantId,
    roleId: input.roleId,
  })
  if ((item.accessGrants ?? []).some((grant) => grant.bindingId === bindingId)) {
    return resolved.seed
  }

  const createdAt = nextSeedTimestamp(resolved.seed)
  const nextProjection = appendSystemConversationEvent(item.projection, {
    conversationId: item.conversation.conversationId,
    body: describeAccessGranted(participantId, input.roleId),
    createdAt,
    systemEventKind: "room-grant-added",
  })

  return {
    ...resolved.seed,
    baseChat: {
      ...upsertSurfaceConversation(
        resolved.seed.baseChat,
        summarizeConversationRecord(item.conversation, nextProjection, resolved.seed.actorId),
      ),
      activeConversation:
        resolved.seed.baseChat.activeConversation?.conversationId ===
        item.conversation.conversationId
          ? summarizeConversationRecord(item.conversation, nextProjection, resolved.seed.actorId)
          : resolved.seed.baseChat.activeConversation,
      transcript:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? nextProjection.mainTranscript
          : resolved.seed.baseChat.transcript,
      activeThreadRoot:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? null
          : resolved.seed.baseChat.activeThreadRoot,
      activeThreadMessages:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? []
          : resolved.seed.baseChat.activeThreadMessages,
    },
    itemsBySidebarItemId: updateSeedItemsForConversation(
      resolved.seed,
      item.conversation.conversationId,
      (seedItem) => ({
        ...seedItem,
        projection: nextProjection,
        accessGrants: [
          ...(seedItem.accessGrants ?? []),
          {
            bindingId,
            subjectId: participantId,
            roleId: input.roleId,
          },
        ],
      }),
    ),
  }
}

export function revokeChatConversationAccess(input: {
  seed: ChatShellRuntimeSeed
  sidebarItemId: string
  bindingId: string
}): ChatShellRuntimeSeed {
  const resolved = resolveSeedItem(input.seed, input.sidebarItemId)
  const item = resolved.item
  if (!item || item.openIntent.openMode !== "joined") {
    return resolved.seed
  }

  const existingGrant = (item.accessGrants ?? []).find(
    (grant) => grant.bindingId === input.bindingId,
  )
  if (!existingGrant) {
    return resolved.seed
  }

  const createdAt = nextSeedTimestamp(resolved.seed)
  const nextProjection = appendSystemConversationEvent(item.projection, {
    conversationId: item.conversation.conversationId,
    body: describeAccessRevoked(existingGrant.subjectId, existingGrant.roleId),
    createdAt,
    systemEventKind: "room-grant-revoked",
  })

  return {
    ...resolved.seed,
    baseChat: {
      ...upsertSurfaceConversation(
        resolved.seed.baseChat,
        summarizeConversationRecord(item.conversation, nextProjection, resolved.seed.actorId),
      ),
      activeConversation:
        resolved.seed.baseChat.activeConversation?.conversationId ===
        item.conversation.conversationId
          ? summarizeConversationRecord(item.conversation, nextProjection, resolved.seed.actorId)
          : resolved.seed.baseChat.activeConversation,
      transcript:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? nextProjection.mainTranscript
          : resolved.seed.baseChat.transcript,
      activeThreadRoot:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? null
          : resolved.seed.baseChat.activeThreadRoot,
      activeThreadMessages:
        resolved.seed.baseChat.activeConversationId === item.conversation.conversationId
          ? []
          : resolved.seed.baseChat.activeThreadMessages,
    },
    itemsBySidebarItemId: updateSeedItemsForConversation(
      resolved.seed,
      item.conversation.conversationId,
      (seedItem) => ({
        ...seedItem,
        projection: nextProjection,
        accessGrants: (seedItem.accessGrants ?? []).filter(
          (grant) => grant.bindingId !== input.bindingId,
        ),
      }),
    ),
  }
}

export function hideChatViewerConversation(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
): { seed: ChatShellRuntimeSeed; nextSidebarItemId: string } {
  const resolved = resolveSeedItem(seed, sidebarItemId)
  const item = resolved.item
  if (!item || item.openIntent.openMode !== "viewer") {
    return {
      seed: resolved.seed,
      nextSidebarItemId: sidebarItemId,
    }
  }

  const { [sidebarItemId]: _removed, ...remainingItems } = resolved.seed.itemsBySidebarItemId
  const nextSidebarItemId =
    remainingItems[resolved.seed.defaultSidebarItemId] != null
      ? resolved.seed.defaultSidebarItemId
      : (Object.keys(remainingItems)[0] ?? resolved.seed.defaultSidebarItemId)

  return {
    nextSidebarItemId,
    seed: {
      ...resolved.seed,
      baseChat: removeViewerRecentConversation(
        resolved.seed.baseChat,
        item.conversation.conversationId,
      ),
      itemsBySidebarItemId: remainingItems,
    },
  }
}

export function leaveChatConversation(
  seed: ChatShellRuntimeSeed,
  sidebarItemId: string,
  participantId: string,
): { seed: ChatShellRuntimeSeed; nextSidebarItemId: string } {
  const resolved = resolveSeedItem(seed, sidebarItemId)
  const item = resolved.item
  if (
    !item ||
    item.openIntent.openMode !== "joined" ||
    (item.conversation.kind !== "channel" && item.conversation.kind !== "group_dm")
  ) {
    return {
      seed: resolved.seed,
      nextSidebarItemId: sidebarItemId,
    }
  }
  if (!item.conversation.participantIds.includes(participantId)) {
    return {
      seed: resolved.seed,
      nextSidebarItemId: sidebarItemId,
    }
  }

  const conversationId = item.conversation.conversationId
  const createdAt = nextSeedTimestamp(resolved.seed)
  const nextConversationRecord = normalizeDirectConversationRecord(
    {
      ...item.conversation,
      participantIds: item.conversation.participantIds.filter((id) => id !== participantId),
      updatedAt: createdAt,
    },
    resolved.seed.actorId,
  )
  const nextProjection = appendSystemConversationEvent(item.projection, {
    conversationId,
    body: `${participantLabel(participantId)} left the room.`,
    createdAt,
    systemEventKind: "participant-left",
  })
  const nextBaseChatWithoutAttention = removeFollowedThreadEntriesForConversation(
    removeInboxEntriesForConversation(resolved.seed.baseChat, conversationId),
    conversationId,
  )
  const nextItems = updateSeedItemsForConversation(resolved.seed, conversationId, (seedItem) => ({
    ...seedItem,
    conversation: nextConversationRecord,
    projection: nextProjection,
    openIntent: {
      ...seedItem.openIntent,
      openMode: "viewer",
      focusMessageId: null,
      activeThreadId: null,
    },
    canPostMessage: false,
    followedThreadIds: [],
  }))
  const canonicalViewerItem = nextItems[conversationId] ?? nextItems[sidebarItemId]
  if (!canonicalViewerItem) {
    return {
      seed: resolved.seed,
      nextSidebarItemId: sidebarItemId,
    }
  }

  if (item.conversation.kind === "group_dm") {
    const nextSummary = summarizeConversationRecord(
      nextConversationRecord,
      nextProjection,
      resolved.seed.actorId,
    )
    return {
      nextSidebarItemId: conversationId,
      seed: {
        ...resolved.seed,
        baseChat: {
          ...upsertSurfaceConversation(nextBaseChatWithoutAttention, nextSummary),
          activeConversationId: conversationId,
          activeConversation: nextSummary,
          transcript: nextProjection.mainTranscript,
          activeThreadRoot: null,
          activeThreadMessages: [],
          composerPlaceholder: `Message ${nextConversationRecord.title}`,
        },
        itemsBySidebarItemId: nextItems,
      },
    }
  }

  const viewerSidebarItemId = `viewer:${conversationId}`
  const nextViewerRecent = buildViewerRecentEntry({
    conversation: nextConversationRecord,
    projection: nextProjection,
    observedAt: createdAt,
  })
  const nextBaseChat = upsertViewerRecentConversation(
    removeSurfaceConversation(nextBaseChatWithoutAttention, conversationId),
    nextViewerRecent,
  )

  return {
    nextSidebarItemId: viewerSidebarItemId,
    seed: {
      ...resolved.seed,
      baseChat: nextBaseChat,
      itemsBySidebarItemId: {
        ...nextItems,
        [viewerSidebarItemId]: {
          ...canonicalViewerItem,
          openIntent: openViewerRecentConversation({
            conversationId,
            title: nextConversationRecord.title,
            kind: "channel",
            observedAt: createdAt,
            latestActivityAt: createdAt,
            latestMessagePreview: nextViewerRecent.preview,
          }),
          canPostMessage: false,
          followedThreadIds: [],
        },
      },
    },
  }
}

export function resolveInitialChatSidebarItemId(
  persistedSidebarItemId: string | null | undefined,
): string {
  return resolveInitialChatShellSidebarItemId(defaultChatShellRuntimeSeed, persistedSidebarItemId)
}

export function buildChatRuntimeState(
  activeSidebarItemId: string,
  options: {
    seed?: ChatShellRuntimeSeed
    threadDrawerOpenOverrides?: Record<string, boolean | undefined>
  } = {},
): ChatShellRuntimeState {
  return buildChatShellRuntimeState(
    syncDerivedSidebarItems(options.seed ?? defaultChatShellRuntimeSeed),
    {
      selectedSidebarItemId: activeSidebarItemId,
      threadDrawerOpenOverrides: options.threadDrawerOpenOverrides,
    },
  )
}

export function useChatShellState() {
  const persistedDrafts = restoreChatDraftPersistence(
    window.localStorage.getItem(CHAT_DRAFTS_STORAGE_KEY),
  )
  const [seed, setSeed] = useState<ChatShellRuntimeSeed>(() =>
    restoreChatShellRuntimeSeed(window.localStorage.getItem(CHAT_SEED_STORAGE_KEY)),
  )
  const [activeSidebarItemId, setActiveSidebarItemId] = useState(() =>
    resolveInitialChatSidebarItemId(window.localStorage.getItem(CHAT_STORAGE_KEY)),
  )
  const [threadDrawerOpenOverrides, setThreadDrawerOpenOverrides] = useState<
    Record<string, boolean | undefined>
  >({})
  const [conversationDrafts, setConversationDrafts] = useState<Record<string, string>>(
    persistedDrafts.conversationDrafts,
  )
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>(
    persistedDrafts.threadDrafts,
  )
  const [conversationAudienceSelections, setConversationAudienceSelections] = useState<
    Record<string, string | null | undefined>
  >(persistedDrafts.conversationAudienceSelections)
  const [threadAudienceSelections, setThreadAudienceSelections] = useState<
    Record<string, string | null | undefined>
  >(persistedDrafts.threadAudienceSelections)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeSearchResultKey, setActiveSearchResultKey] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{
    sidebarItemId: string
    messageId: string
    draft: string
  } | null>(null)
  const seedRef = useRef(seed)

  const runtime = useMemo(
    () =>
      buildChatRuntimeState(activeSidebarItemId, {
        seed,
        threadDrawerOpenOverrides,
      }),
    [activeSidebarItemId, seed, threadDrawerOpenOverrides],
  )
  const searchResults = useMemo(() => searchChatMessages(seed, searchQuery), [searchQuery, seed])
  const resolvedSearchSelection = useMemo(
    () => resolveChatSearchSelection(searchResults, activeSearchResultKey),
    [searchResults, activeSearchResultKey],
  )
  const activeSearchResultIndex = resolvedSearchSelection.activeIndex

  useEffect(() => {
    seedRef.current = seed
  }, [seed])
  const actorId = seed.actorId

  useEffect(() => {
    window.localStorage.setItem(CHAT_STORAGE_KEY, runtime.selectedSidebarItemId)
  }, [runtime.selectedSidebarItemId])

  useEffect(() => {
    window.localStorage.setItem(CHAT_SEED_STORAGE_KEY, JSON.stringify(seed))
  }, [seed])

  useEffect(() => {
    window.localStorage.setItem(
      CHAT_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        conversationDrafts,
        threadDrafts,
        conversationAudienceSelections,
        threadAudienceSelections,
      } satisfies ChatDraftPersistence),
    )
  }, [conversationAudienceSelections, conversationDrafts, threadAudienceSelections, threadDrafts])

  useEffect(() => {
    setEditingMessage((current) =>
      current && current.sidebarItemId !== runtime.selectedSidebarItemId ? null : current,
    )
  }, [runtime.selectedSidebarItemId])

  useEffect(() => {
    if (resolvedSearchSelection.activeKey !== activeSearchResultKey) {
      setActiveSearchResultKey(resolvedSearchSelection.activeKey)
    }
  }, [activeSearchResultKey, resolvedSearchSelection.activeKey])

  const selectSidebarItem = useCallback((itemId: string) => {
    startTransition(() => {
      setSeed((current) => openChatSidebarItem(current, itemId))
      setActiveSidebarItemId(resolveChatSidebarSelection(seedRef.current, itemId))
    })
  }, [])

  const createConversation = useCallback(
    (
      input:
        | {
            kind: "channel"
            title: string
            visibility: ChatConversationRecord["visibility"]
          }
        | {
            kind: "direct"
            participantIds: string[]
          },
    ) => {
      startTransition(() => {
        const created =
          input.kind === "channel"
            ? createChatConversation({
                seed: seedRef.current,
                title: input.title,
                creatorId: seedRef.current.actorId,
                visibility: input.visibility,
              })
            : createChatDirectConversation({
                seed: seedRef.current,
                creatorId: seedRef.current.actorId,
                participantIds: input.participantIds,
              })
        setSeed(created.seed)
        setActiveSidebarItemId(created.sidebarItemId)
        setThreadDrawerOpenOverrides((current) => ({
          ...current,
          [created.sidebarItemId]: false,
        }))
      })
    },
    [],
  )

  const openInbox = useCallback(() => {
    const firstInboxEntry = runtime.chat.sidebar.inbox[0]
    if (!firstInboxEntry) {
      return
    }
    startTransition(() => {
      setSeed((current) => openChatSidebarItem(current, firstInboxEntry.entryId))
      setActiveSidebarItemId(resolveChatSidebarSelection(seedRef.current, firstInboxEntry.entryId))
    })
  }, [runtime.chat.sidebar.inbox])

  const openThreadDrawer = useCallback(
    (messageId: string) => {
      startTransition(() => {
        setSeed((current) => setChatThreadOpenState(current, activeSidebarItemId, messageId))
        setThreadDrawerOpenOverrides((current) => ({
          ...current,
          [activeSidebarItemId]: true,
        }))
      })
    },
    [activeSidebarItemId],
  )

  const closeThreadDrawer = useCallback(() => {
    startTransition(() => {
      setThreadDrawerOpenOverrides((current) => ({
        ...current,
        [runtime.selectedSidebarItemId]: false,
      }))
    })
  }, [runtime.selectedSidebarItemId])

  const updateConversationDraft = useCallback(
    (value: string) => {
      setConversationDrafts((current) => ({
        ...current,
        [runtime.selectedSidebarItemId]: value,
      }))
    },
    [runtime.selectedSidebarItemId],
  )

  const insertConversationDraftToken = useCallback(
    (token: string) => {
      setConversationDrafts((current) => {
        const existing = current[runtime.selectedSidebarItemId] ?? ""
        const needsSpace = existing.length > 0 && !existing.endsWith(" ")
        return {
          ...current,
          [runtime.selectedSidebarItemId]: `${existing}${needsSpace ? " " : ""}${token}`,
        }
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const submitConversationDraft = useCallback(() => {
    const draft = conversationDrafts[runtime.selectedSidebarItemId]?.trim()
    if (!draft || !runtime.transcriptView.composer.enabled) {
      return
    }

    startTransition(() => {
      setSeed((current) =>
        appendChatMessage({
          seed: current,
          sidebarItemId: runtime.selectedSidebarItemId,
          body: draft,
          senderId: seedRef.current.actorId,
          threadId: null,
          audienceId: conversationAudienceSelections[runtime.selectedSidebarItemId] ?? null,
        }),
      )
      setConversationDrafts((current) => ({
        ...current,
        [runtime.selectedSidebarItemId]: "",
      }))
      setConversationAudienceSelections((current) => ({
        ...current,
        [runtime.selectedSidebarItemId]: null,
      }))
    })
  }, [
    conversationAudienceSelections,
    conversationDrafts,
    runtime.selectedSidebarItemId,
    runtime.transcriptView.composer.enabled,
  ])

  const updateThreadDraft = useCallback(
    (value: string) => {
      const threadId = runtime.transcriptView.threadDrawer.rootMessage?.messageId
      if (!threadId) {
        return
      }
      const key = `${runtime.selectedSidebarItemId}:${threadId}`
      setThreadDrafts((current) => ({
        ...current,
        [key]: value,
      }))
    },
    [runtime.selectedSidebarItemId, runtime.transcriptView.threadDrawer.rootMessage?.messageId],
  )

  const insertThreadDraftToken = useCallback(
    (token: string) => {
      const threadId = runtime.transcriptView.threadDrawer.rootMessage?.messageId
      if (!threadId) {
        return
      }
      const key = `${runtime.selectedSidebarItemId}:${threadId}`
      setThreadDrafts((current) => {
        const existing = current[key] ?? ""
        const needsSpace = existing.length > 0 && !existing.endsWith(" ")
        return {
          ...current,
          [key]: `${existing}${needsSpace ? " " : ""}${token}`,
        }
      })
    },
    [runtime.selectedSidebarItemId, runtime.transcriptView.threadDrawer.rootMessage?.messageId],
  )

  const submitThreadDraft = useCallback(() => {
    const threadId = runtime.transcriptView.threadDrawer.rootMessage?.messageId
    if (!threadId) {
      return
    }
    const key = `${runtime.selectedSidebarItemId}:${threadId}`
    const draft = threadDrafts[key]?.trim()
    if (!draft || !runtime.transcriptView.composer.enabled) {
      return
    }

    startTransition(() => {
      setSeed((current) =>
        appendChatMessage({
          seed: current,
          sidebarItemId: runtime.selectedSidebarItemId,
          body: draft,
          senderId: seedRef.current.actorId,
          threadId,
          audienceId: threadAudienceSelections[key] ?? null,
        }),
      )
      setThreadDrafts((current) => ({
        ...current,
        [key]: "",
      }))
      setThreadAudienceSelections((current) => ({
        ...current,
        [key]: null,
      }))
      setThreadDrawerOpenOverrides((current) => ({
        ...current,
        [runtime.selectedSidebarItemId]: true,
      }))
    })
  }, [
    runtime.selectedSidebarItemId,
    threadAudienceSelections,
    runtime.transcriptView.composer.enabled,
    runtime.transcriptView.threadDrawer.rootMessage?.messageId,
    threadDrafts,
  ])

  const markActiveConversationRead = useCallback(() => {
    const conversationId = runtime.chat.activeConversationId
    startTransition(() => {
      setSeed((current) => markChatConversationRead(current, conversationId))
      if (runtime.selectedSidebarItemId !== conversationId) {
        setActiveSidebarItemId(conversationId)
      }
    })
  }, [runtime.chat.activeConversationId, runtime.selectedSidebarItemId])

  const toggleActiveThreadFollow = useCallback(() => {
    const threadId = runtime.transcriptView.threadDrawer.rootMessage?.messageId
    if (!threadId) {
      return
    }
    startTransition(() => {
      setSeed((current) =>
        setChatThreadFollowState(
          current,
          runtime.selectedSidebarItemId,
          threadId,
          !runtime.transcriptView.threadDrawer.followed,
        ),
      )
    })
  }, [
    runtime.selectedSidebarItemId,
    runtime.transcriptView.threadDrawer.followed,
    runtime.transcriptView.threadDrawer.rootMessage?.messageId,
  ])

  const markActiveThreadRead = useCallback(() => {
    const threadId = runtime.transcriptView.threadDrawer.rootMessage?.messageId
    if (!threadId) {
      return
    }
    startTransition(() => {
      setSeed((current) => markChatThreadRead(current, runtime.selectedSidebarItemId, threadId))
    })
  }, [runtime.selectedSidebarItemId, runtime.transcriptView.threadDrawer.rootMessage?.messageId])

  const joinActiveConversation = useCallback(() => {
    startTransition(() => {
      setSeed((current) =>
        joinChatConversation(current, runtime.selectedSidebarItemId, seedRef.current.actorId),
      )
      setActiveSidebarItemId(runtime.chat.activeConversationId)
    })
  }, [runtime.chat.activeConversationId, runtime.selectedSidebarItemId])

  const toggleConversationPostingPolicy = useCallback(() => {
    startTransition(() => {
      setSeed((current) =>
        toggleChatConversationPostingPolicy({
          seed: current,
          sidebarItemId: runtime.selectedSidebarItemId,
        }),
      )
    })
  }, [runtime.selectedSidebarItemId])

  const archiveActiveConversation = useCallback(() => {
    startTransition(() => {
      setSeed((current) =>
        archiveChatConversation({
          seed: current,
          sidebarItemId: runtime.selectedSidebarItemId,
        }),
      )
    })
  }, [runtime.selectedSidebarItemId])

  const updateActiveConversationDetails = useCallback(
    (
      title: string,
      topic: string | null,
      visibility: ChatConversationRecord["visibility"] | undefined,
    ) => {
      startTransition(() => {
        setSeed((current) =>
          updateChatConversationDetails({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            title,
            topic,
            visibility,
          }),
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const hideActiveViewerConversation = useCallback(() => {
    startTransition(() => {
      const next = hideChatViewerConversation(seedRef.current, runtime.selectedSidebarItemId)
      setSeed(next.seed)
      setActiveSidebarItemId(next.nextSidebarItemId)
    })
  }, [runtime.selectedSidebarItemId])

  const leaveActiveConversation = useCallback(() => {
    startTransition(() => {
      const next = leaveChatConversation(
        seedRef.current,
        runtime.selectedSidebarItemId,
        seedRef.current.actorId,
      )
      setSeed(next.seed)
      setActiveSidebarItemId(next.nextSidebarItemId)
      setThreadDrawerOpenOverrides((current) => ({
        ...current,
        [next.nextSidebarItemId]: false,
      }))
    })
  }, [runtime.selectedSidebarItemId])

  const removeParticipantFromActiveConversation = useCallback(
    (participantId: string) => {
      startTransition(() => {
        setSeed((current) =>
          removeChatConversationParticipant({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            participantId,
          }),
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const addParticipantToActiveConversation = useCallback(
    (participantId: string) => {
      startTransition(() => {
        setSeed((current) =>
          addChatConversationParticipant({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            participantId,
          }),
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const grantAccessToActiveConversation = useCallback(
    (participantId: string, roleId: ChatConversationAccessGrant["roleId"]) => {
      startTransition(() => {
        setSeed((current) =>
          grantChatConversationAccess({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            participantId,
            roleId,
          }),
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const revokeAccessFromActiveConversation = useCallback(
    (bindingId: string) => {
      startTransition(() => {
        setSeed((current) =>
          revokeChatConversationAccess({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            bindingId,
          }),
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const selectSearchResult = useCallback((result: ChatSearchResult) => {
    startTransition(() => {
      setSeed((current) =>
        openChatSidebarItem(openChatSearchResult(current, result), result.sidebarItemId),
      )
      setActiveSidebarItemId(resolveChatSidebarSelection(seedRef.current, result.sidebarItemId))
      setSearchQuery("")
      setActiveSearchResultKey(null)
      setThreadDrawerOpenOverrides((current) => ({
        ...current,
        [result.sidebarItemId]: !!result.threadId,
      }))
    })
  }, [])

  const moveSearchSelection = useCallback(
    (delta: number) => {
      if (searchResults.length === 0) {
        return
      }
      setActiveSearchResultKey((current) => {
        const currentIndex = resolveChatSearchSelection(searchResults, current).activeIndex
        const next = currentIndex + delta
        if (next < 0) {
          return chatSearchResultKey(searchResults[searchResults.length - 1] ?? searchResults[0])
        }
        if (next >= searchResults.length) {
          return chatSearchResultKey(searchResults[0])
        }
        return chatSearchResultKey(searchResults[next] ?? searchResults[0])
      })
    },
    [searchResults],
  )

  const submitActiveSearchResult = useCallback(() => {
    const selectedResult = searchResults[activeSearchResultIndex] ?? searchResults[0]
    if (!selectedResult) {
      return
    }
    selectSearchResult(selectedResult)
  }, [activeSearchResultIndex, searchResults, selectSearchResult])

  const updateSearchQuery = useCallback((value: string) => {
    setSearchQuery(value)
  }, [])

  const startEditingMessage = useCallback(
    (messageId: string) => {
      const message = runtime.transcriptView.conversationId
        ? [
            ...runtime.transcriptView.transcript,
            ...runtime.transcriptView.threadDrawer.messages,
            ...(runtime.transcriptView.threadDrawer.rootMessage
              ? [runtime.transcriptView.threadDrawer.rootMessage]
              : []),
          ].find((candidate) => candidate.messageId === messageId)
        : null

      if (
        !message ||
        message.author.kind !== "participant" ||
        message.author.id !== actorId ||
        message.redactedAt
      ) {
        return
      }

      setEditingMessage({
        sidebarItemId: runtime.selectedSidebarItemId,
        messageId,
        draft: message.body,
      })
    },
    [
      runtime.selectedSidebarItemId,
      runtime.transcriptView.conversationId,
      runtime.transcriptView.threadDrawer.messages,
      runtime.transcriptView.threadDrawer.rootMessage,
      runtime.transcriptView.transcript,
      actorId,
    ],
  )

  const updateEditingMessageDraft = useCallback((value: string) => {
    setEditingMessage((current) => (current ? { ...current, draft: value } : current))
  }, [])

  const cancelEditingMessage = useCallback(() => {
    setEditingMessage(null)
  }, [])

  const saveEditingMessage = useCallback(() => {
    if (!editingMessage) {
      return
    }
    const draft = editingMessage.draft.trim()
    if (!draft) {
      return
    }

    startTransition(() => {
      setSeed((current) =>
        editChatMessage({
          seed: current,
          sidebarItemId: editingMessage.sidebarItemId,
          messageId: editingMessage.messageId,
          body: draft,
          actorId: seedRef.current.actorId,
        }),
      )
      setEditingMessage(null)
    })
  }, [editingMessage])

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      startTransition(() => {
        setSeed((current) =>
          toggleChatMessageReaction({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            messageId,
            emoji,
            participantId: seedRef.current.actorId,
          }),
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const redactActiveMessage = useCallback(
    (messageId: string) => {
      startTransition(() => {
        setSeed((current) =>
          redactChatMessage({
            seed: current,
            sidebarItemId: runtime.selectedSidebarItemId,
            messageId,
            actorId: seedRef.current.actorId,
          }),
        )
        setEditingMessage((current) =>
          current?.messageId === messageId &&
          current.sidebarItemId === runtime.selectedSidebarItemId
            ? null
            : current,
        )
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const activeConversationDraft = conversationDrafts[runtime.selectedSidebarItemId] ?? ""
  const activeThreadDraftKey = runtime.transcriptView.threadDrawer.rootMessage
    ? `${runtime.selectedSidebarItemId}:${runtime.transcriptView.threadDrawer.rootMessage.messageId}`
    : null
  const activeThreadDraft = activeThreadDraftKey ? (threadDrafts[activeThreadDraftKey] ?? "") : ""
  const activeConversationAudienceId =
    conversationAudienceSelections[runtime.selectedSidebarItemId] ?? null
  const activeThreadAudienceId = activeThreadDraftKey
    ? (threadAudienceSelections[activeThreadDraftKey] ?? null)
    : null
  const activeConversationAudienceOptions =
    runtime.chat.activeConversation?.participantIds.filter(
      (participantId) => participantId !== actorId,
    ) ?? []
  const knownParticipantIds = useMemo(() => listKnownParticipantIds(seed), [seed])
  const actorOptions = useMemo(
    () => [actorId, ...knownParticipantIds],
    [actorId, knownParticipantIds],
  )

  const selectActor = useCallback(
    (nextActorId: string) => {
      if (!nextActorId || nextActorId === seedRef.current.actorId) {
        return
      }
      startTransition(() => {
        const nextSeed = retargetChatShellRuntimeSeed(seedRef.current, nextActorId)
        const nextSidebarItemId =
          nextSeed.itemsBySidebarItemId[runtime.selectedSidebarItemId] != null
            ? resolveChatSidebarSelection(nextSeed, runtime.selectedSidebarItemId)
            : nextSeed.defaultSidebarItemId
        setSeed(nextSeed)
        setActiveSidebarItemId(nextSidebarItemId)
        setThreadDrawerOpenOverrides({})
        setConversationDrafts({})
        setThreadDrafts({})
        setConversationAudienceSelections({})
        setThreadAudienceSelections({})
        setSearchQuery("")
        setActiveSearchResultKey(null)
        setEditingMessage(null)
      })
    },
    [runtime.selectedSidebarItemId],
  )

  const toggleConversationAudience = useCallback(
    (participantId: string) => {
      setConversationAudienceSelections((current) => ({
        ...current,
        [runtime.selectedSidebarItemId]:
          current[runtime.selectedSidebarItemId] === participantId ? null : participantId,
      }))
    },
    [runtime.selectedSidebarItemId],
  )

  const toggleThreadAudience = useCallback(
    (participantId: string) => {
      const threadId = runtime.transcriptView.threadDrawer.rootMessage?.messageId
      if (!threadId) {
        return
      }
      const key = `${runtime.selectedSidebarItemId}:${threadId}`
      setThreadAudienceSelections((current) => ({
        ...current,
        [key]: current[key] === participantId ? null : participantId,
      }))
    },
    [runtime.selectedSidebarItemId, runtime.transcriptView.threadDrawer.rootMessage?.messageId],
  )

  return {
    actorId,
    actorOptions,
    runtime,
    searchQuery,
    searchResults,
    activeSearchResultIndex,
    inboxCount: runtime.chat.sidebar.inbox.length,
    knownParticipantIds,
    activeConversationDraft,
    activeThreadDraft,
    activeConversationAudienceId,
    activeThreadAudienceId,
    activeConversationAudienceOptions,
    editingMessageId:
      editingMessage?.sidebarItemId === runtime.selectedSidebarItemId
        ? editingMessage.messageId
        : null,
    editingMessageDraft:
      editingMessage?.sidebarItemId === runtime.selectedSidebarItemId ? editingMessage.draft : "",
    createConversation,
    selectActor,
    openInbox,
    selectSidebarItem,
    closeThreadDrawer,
    openThreadDrawer,
    updateConversationDraft,
    insertConversationDraftToken,
    submitConversationDraft,
    updateThreadDraft,
    insertThreadDraftToken,
    submitThreadDraft,
    toggleConversationAudience,
    toggleThreadAudience,
    markActiveConversationRead,
    markActiveThreadRead,
    toggleActiveThreadFollow,
    joinActiveConversation,
    toggleConversationPostingPolicy,
    archiveActiveConversation,
    updateActiveConversationDetails,
    leaveActiveConversation,
    addParticipantToActiveConversation,
    removeParticipantFromActiveConversation,
    grantAccessToActiveConversation,
    revokeAccessFromActiveConversation,
    hideActiveViewerConversation,
    setSearchQuery: updateSearchQuery,
    moveSearchSelection,
    selectSearchResult,
    submitActiveSearchResult,
    startEditingMessage,
    updateEditingMessageDraft,
    cancelEditingMessage,
    saveEditingMessage,
    toggleReaction,
    redactActiveMessage,
  }
}
