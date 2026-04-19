import type { ChatConversationRecord } from "../../chat/core/model.js"
import type { ChatConversationProjection } from "../../chat/projections/projections.js"
import type { ChatProjectedMessage } from "../../chat/view-model.js"
import type { ChatOpenIntent } from "./open-flow.js"
import {
  type ChatConversationAccessGrant,
  canChatActorManageConversation,
  canChatActorModerateMessages,
} from "./permissions.js"

export interface ChatViewerTreatment {
  mode: "viewer"
  badge: "Viewer mode"
  detail: "Read-only"
  actionLabel: "Join to participate"
}

export interface ChatComposerState {
  visible: true
  enabled: boolean
  placeholder: string
  disabledReason: string | null
}

export interface ChatConversationChromeState {
  icon: "channel" | "private-channel" | "dm" | "group-dm"
  badgeLabel: string
  canEditDetails: boolean
  canTogglePostingPolicy: boolean
  canArchive: boolean
  canLeave: boolean
  canManageParticipants: boolean
  canModerateMessages: boolean
}

export interface ChatThreadDrawerState {
  open: boolean
  rootMessage: ChatProjectedMessage | null
  messages: ChatProjectedMessage[]
  followed: boolean
  unreadReplyCount: number
  unreadMentionCount: number
}

export interface ChatTranscriptViewState {
  conversationId: string
  conversationTitle: string
  openMode: ChatOpenIntent["openMode"]
  chrome: ChatConversationChromeState
  accessGrants: ChatConversationAccessGrant[]
  focusMessageId: string | null
  transcript: ChatProjectedMessage[]
  threadDrawer: ChatThreadDrawerState
  viewerTreatment: ChatViewerTreatment | null
  composer: ChatComposerState
}

export interface BuildChatTranscriptViewInput {
  actorId: string
  conversation: ChatConversationRecord
  projection: ChatConversationProjection
  openIntent: ChatOpenIntent
  canPostMessage: boolean
  accessGrants?: ChatConversationAccessGrant[]
  threadFollowed?: boolean
  threadAttention?: {
    unreadReplyCount: number
    unreadMentionCount: number
  }
}

function accessGrantSortValue(roleId: ChatConversationAccessGrant["roleId"]): number {
  switch (roleId) {
    case "room_manager":
      return 0
    case "participant":
      return 1
    case "viewer":
      return 2
  }
}

function resolveThreadDrawerState(
  projection: ChatConversationProjection,
  activeThreadId: string | null,
): Omit<ChatThreadDrawerState, "followed"> {
  if (!activeThreadId) {
    return {
      open: false,
      rootMessage: null,
      messages: [],
      unreadReplyCount: 0,
      unreadMentionCount: 0,
    }
  }

  const rootMessage =
    projection.activeThreadRoot?.messageId === activeThreadId
      ? projection.activeThreadRoot
      : (projection.mainTranscript.find((message) => message.messageId === activeThreadId) ??
        projection.conversationMessages.find((message) => message.messageId === activeThreadId) ??
        null)

  const threadMessages = projection.conversationMessages.filter(
    (message) => message.threadId === activeThreadId,
  )
  const messages = threadMessages.length > 0 ? threadMessages : projection.activeThreadMessages

  return {
    open: rootMessage !== null,
    rootMessage,
    messages,
    unreadReplyCount: 0,
    unreadMentionCount: 0,
  }
}

function defaultComposerPlaceholder(conversation: ChatConversationRecord): string {
  switch (conversation.kind) {
    case "channel":
      return `Message #${conversation.title}`
    case "dm":
    case "group_dm":
      return `Message ${conversation.title}`
  }
}

function disabledComposerState(input: {
  placeholder: string
  disabledReason: string
}): ChatComposerState {
  return {
    visible: true,
    enabled: false,
    placeholder: input.placeholder,
    disabledReason: input.disabledReason,
  }
}

function buildConversationChromeState(input: {
  actorId: string
  conversation: ChatConversationRecord
  openMode: ChatOpenIntent["openMode"]
  accessGrants: ChatConversationAccessGrant[]
}): ChatConversationChromeState {
  const { conversation, openMode } = input
  const joined = openMode === "joined"
  const canManageConversation = canChatActorManageConversation({
    conversation,
    accessGrants: input.accessGrants,
    actorId: input.actorId,
    openMode,
  })
  const canModerateMessages = canChatActorModerateMessages({
    conversation,
    accessGrants: input.accessGrants,
    actorId: input.actorId,
    openMode,
  })
  const icon =
    conversation.kind === "channel"
      ? conversation.visibility === "private"
        ? "private-channel"
        : "channel"
      : conversation.kind === "group_dm"
        ? "group-dm"
        : "dm"
  const badgeLabel =
    conversation.kind === "channel"
      ? conversation.visibility
      : conversation.kind === "group_dm"
        ? "group dm"
        : "dm"

  return {
    icon,
    badgeLabel,
    canEditDetails: canManageConversation && conversation.kind === "channel",
    canTogglePostingPolicy: canManageConversation && conversation.kind === "channel",
    canArchive: canManageConversation && conversation.kind === "channel",
    canLeave: joined && conversation.kind !== "dm",
    canManageParticipants: canManageConversation && conversation.kind !== "dm",
    canModerateMessages,
  }
}

export function buildChatTranscriptView(
  input: BuildChatTranscriptViewInput,
): ChatTranscriptViewState {
  const { conversation, projection, openIntent } = input
  const openMode = openIntent.openMode
  const threadDrawer = resolveThreadDrawerState(projection, openIntent.activeThreadId)
  const chrome = buildConversationChromeState({
    actorId: input.actorId,
    conversation,
    openMode,
    accessGrants: input.accessGrants ?? [],
  })
  const viewerTreatment =
    openMode === "viewer"
      ? ({
          mode: "viewer",
          badge: "Viewer mode",
          detail: "Read-only",
          actionLabel: "Join to participate",
        } satisfies ChatViewerTreatment)
      : null

  const composer = (() => {
    if (openMode === "viewer") {
      return disabledComposerState({
        placeholder: "Join to participate",
        disabledReason: "Viewer mode is read-only",
      })
    }
    if (conversation.lifecycleState === "archived") {
      return disabledComposerState({
        placeholder: "Conversation archived",
        disabledReason: "Archived conversations cannot accept new messages",
      })
    }
    if (!input.canPostMessage) {
      return disabledComposerState({
        placeholder:
          conversation.postingPolicy === "restricted"
            ? "Posting is restricted"
            : "Posting unavailable",
        disabledReason:
          conversation.postingPolicy === "restricted"
            ? "Posting is restricted"
            : "Posting unavailable",
      })
    }
    return {
      visible: true,
      enabled: true,
      placeholder: defaultComposerPlaceholder(conversation),
      disabledReason: null,
    } satisfies ChatComposerState
  })()

  return {
    conversationId: conversation.conversationId,
    conversationTitle: conversation.title,
    openMode,
    chrome,
    accessGrants: [...(input.accessGrants ?? [])].sort((left, right) => {
      const roleOrder = accessGrantSortValue(left.roleId) - accessGrantSortValue(right.roleId)
      if (roleOrder !== 0) {
        return roleOrder
      }
      return left.subjectId.localeCompare(right.subjectId)
    }),
    focusMessageId: openIntent.focusMessageId,
    transcript: projection.mainTranscript,
    threadDrawer: {
      ...threadDrawer,
      followed: threadDrawer.rootMessage ? (input.threadFollowed ?? false) : false,
      unreadReplyCount: threadDrawer.rootMessage
        ? (input.threadAttention?.unreadReplyCount ?? 0)
        : 0,
      unreadMentionCount: threadDrawer.rootMessage
        ? (input.threadAttention?.unreadMentionCount ?? 0)
        : 0,
    },
    viewerTreatment,
    composer,
  }
}
