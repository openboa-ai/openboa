import type { ChatConversation, ChatConversationRecord } from "../../chat/core/model.js"
import type { ChatConversationProjection } from "../../chat/projections/projections.js"
import type { ChatSurface } from "../../chat/view-model.js"
import type { ChatDetailPane } from "./frame-state.js"
import type { ChatOpenIntent } from "./open-flow.js"
import type { ChatConversationAccessGrant } from "./permissions.js"
import { buildChatTranscriptView, type ChatTranscriptViewState } from "./transcript-view.js"

export interface ChatShellRuntimeSeedItem {
  conversation: ChatConversationRecord
  projection: ChatConversationProjection
  openIntent: ChatOpenIntent
  canPostMessage: boolean
  accessGrants?: ChatConversationAccessGrant[]
  followedThreadIds?: string[]
}

export interface ChatShellRuntimeSeed {
  actorId: string
  eventWatermark: number
  baseChat: ChatSurface
  defaultSidebarItemId: string
  itemsBySidebarItemId: Record<string, ChatShellRuntimeSeedItem>
}

export interface ChatShellControllerState {
  selectedSidebarItemId: string
  threadDrawerOpenOverrides?: Record<string, boolean | undefined>
}

export interface ChatShellRuntimeState {
  selectedSidebarItemId: string
  chat: ChatSurface
  detailPane: ChatDetailPane | null
  transcriptView: ChatTranscriptViewState
}

function conversationMapFromChat(chat: ChatSurface): Map<string, ChatConversation> {
  return new Map(
    [
      ...chat.sidebar.channels,
      ...chat.sidebar.dmGroups.flatMap((group) => group.conversations),
    ].map((conversation) => [conversation.conversationId, conversation]),
  )
}

function summarizeSurfaceConversation(
  conversation: ChatConversationRecord,
  projection: ChatConversationProjection,
): ChatConversation {
  const latestMessage = projection.conversationMessages.reduce<
    ChatConversationProjection["conversationMessages"][number] | null
  >((latest, message) => {
    if (!latest || message.createdAt > latest.createdAt) {
      return message
    }
    return latest
  }, null)

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
    dmGroup: null,
    participantIds: conversation.participantIds,
    predecessorConversationId: conversation.predecessorConversationId,
    lineageRootConversationId: conversation.lineageRootConversationId,
    historyMode: conversation.historyMode,
    unreadCount: 0,
    mentionCount: 0,
    latestActivityAt: latestMessage?.createdAt ?? null,
    latestMessagePreview: latestMessage?.body ?? "",
    messageCount: projection.conversationMessages.length,
  }
}

function resolveSelection(
  seed: ChatShellRuntimeSeed,
  selectedSidebarItemId: string,
): {
  selectedSidebarItemId: string
  item: ChatShellRuntimeSeedItem
} {
  const selectedItem =
    seed.itemsBySidebarItemId[selectedSidebarItemId] ??
    seed.itemsBySidebarItemId[seed.defaultSidebarItemId]

  return {
    selectedSidebarItemId: seed.itemsBySidebarItemId[selectedSidebarItemId]
      ? selectedSidebarItemId
      : seed.defaultSidebarItemId,
    item: selectedItem,
  }
}

function applyThreadDrawerOverride(
  transcriptView: ChatTranscriptViewState,
  override: boolean | undefined,
): ChatTranscriptViewState {
  if (override === undefined) {
    return transcriptView
  }

  if (override) {
    return transcriptView
  }

  return {
    ...transcriptView,
    threadDrawer: {
      open: false,
      rootMessage: null,
      messages: [],
      followed: false,
      unreadReplyCount: 0,
      unreadMentionCount: 0,
    },
  }
}

function buildTranscriptViewForSeedItem(
  item: ChatShellRuntimeSeedItem,
  chat: ChatSurface,
  actorId: string,
): ChatTranscriptViewState {
  const activeThreadId = item.openIntent.activeThreadId
  const threadFollowed = activeThreadId
    ? (item.followedThreadIds ?? []).includes(activeThreadId)
    : false
  const threadAttention = activeThreadId
    ? (chat.sidebar.followedThreads.find(
        (thread) =>
          thread.conversationId === item.conversation.conversationId &&
          thread.threadRootMessageId === activeThreadId,
      ) ?? null)
    : null

  return buildChatTranscriptView({
    actorId,
    conversation: item.conversation,
    projection: item.projection,
    openIntent: item.openIntent,
    canPostMessage: item.canPostMessage,
    accessGrants: item.accessGrants ?? [],
    threadFollowed,
    threadAttention: threadAttention
      ? {
          unreadReplyCount: threadAttention.unreadReplyCount,
          unreadMentionCount: threadAttention.unreadMentionCount,
        }
      : undefined,
  })
}

export function resolveInitialChatShellSidebarItemId(
  seed: ChatShellRuntimeSeed,
  persistedSidebarItemId: string | null | undefined,
): string {
  if (persistedSidebarItemId && seed.itemsBySidebarItemId[persistedSidebarItemId]) {
    return persistedSidebarItemId
  }
  return seed.defaultSidebarItemId
}

export function buildChatShellRuntimeState(
  seed: ChatShellRuntimeSeed,
  controller: ChatShellControllerState,
): ChatShellRuntimeState {
  const selection = resolveSelection(seed, controller.selectedSidebarItemId)
  const conversations = conversationMapFromChat(seed.baseChat)
  const activeConversation =
    conversations.get(selection.item.openIntent.openConversationId) ??
    summarizeSurfaceConversation(selection.item.conversation, selection.item.projection)

  const transcriptView = applyThreadDrawerOverride(
    buildTranscriptViewForSeedItem(selection.item, seed.baseChat, seed.actorId),
    controller.threadDrawerOpenOverrides?.[selection.selectedSidebarItemId],
  )

  const detailPane =
    transcriptView.threadDrawer.open && transcriptView.threadDrawer.rootMessage
      ? {
          kind: "thread" as const,
          title: activeConversation?.title ?? transcriptView.conversationTitle,
        }
      : null

  return {
    selectedSidebarItemId: selection.selectedSidebarItemId,
    transcriptView,
    detailPane,
    chat: {
      ...seed.baseChat,
      activeConversationId: activeConversation.conversationId ?? seed.baseChat.activeConversationId,
      activeConversation,
      transcript: transcriptView.transcript,
      activeThreadRoot: transcriptView.threadDrawer.rootMessage,
      activeThreadMessages: transcriptView.threadDrawer.messages,
      composerPlaceholder: transcriptView.composer.placeholder,
    },
  }
}
