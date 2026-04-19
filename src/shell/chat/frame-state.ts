import type { ChatSurface } from "../../chat/view-model.js"

export interface ChatSidebarItem {
  id: string
  label: string
  detail: string | null
  badgeCount: number
  badgeTone?: ChatBadgeTone
  muted?: boolean
  statusLabel?: string
  statusTone?: ChatBadgeTone
}

export interface ChatSidebarSection {
  id: string
  label: string
  badgeCount?: number
  badgeTone?: ChatBadgeTone
  items: ChatSidebarItem[]
  emptyState?: {
    title: string
    detail?: string
    tone?: ChatBadgeTone
  }
}

export interface ChatDetailPane {
  kind: "thread"
  title: string
}

export interface ChatFrameState {
  sidebarSections: ChatSidebarSection[]
  detailPane: ChatDetailPane | null
}

export type ChatBadgeTone = "default" | "attention" | "muted"
const RECENTLY_RESOLVED_WINDOW_MS = 15 * 60 * 1000

function conversationBadgeCount(input: { unreadCount: number; mentionCount: number }): number {
  return input.unreadCount + input.mentionCount
}

function conversationBadgeTone(mentionCount: number): ChatBadgeTone {
  return mentionCount > 0 ? "attention" : "default"
}

function sectionBadgeTone(input: {
  itemBadgeCounts: number[]
  hasAttention: boolean
}): ChatBadgeTone | undefined {
  if (input.itemBadgeCounts.every((count) => count <= 0)) {
    return undefined
  }
  return input.hasAttention ? "attention" : "default"
}

export function resolveInboxStatusLabel(
  resolvedAt: string | null | undefined,
  now = Date.now(),
): string | undefined {
  if (!resolvedAt) {
    return undefined
  }
  const resolvedTimestamp = new Date(resolvedAt).getTime()
  if (!Number.isFinite(resolvedTimestamp)) {
    return "Seen"
  }
  return now - resolvedTimestamp <= RECENTLY_RESOLVED_WINDOW_MS ? "Seen now" : "Seen"
}

export function buildChatFrameState(
  chat: ChatSurface,
  detailPane: ChatDetailPane | null,
): ChatFrameState {
  const inboxBadgeCount = chat.sidebar.inbox.filter((entry) => !entry.resolvedAt).length
  const followedThreadsBadgeCount = chat.sidebar.followedThreads.reduce(
    (total, thread) => total + thread.unreadReplyCount + thread.unreadMentionCount,
    0,
  )
  const channelBadgeCounts = chat.sidebar.channels.map((conversation) =>
    conversationBadgeCount(conversation),
  )
  const dmGroupBadgeMeta = chat.sidebar.dmGroups.map((group) => ({
    id: group.id,
    counts: group.conversations.map((conversation) => conversationBadgeCount(conversation)),
    hasAttention: group.conversations.some((conversation) => conversation.mentionCount > 0),
    badgeCount: group.conversations.reduce(
      (total, conversation) => total + conversationBadgeCount(conversation),
      0,
    ),
  }))

  return {
    detailPane,
    sidebarSections: [
      {
        id: "inbox",
        label: "Inbox",
        badgeCount: inboxBadgeCount,
        badgeTone: inboxBadgeCount > 0 ? "attention" : undefined,
        items: chat.sidebar.inbox.map((entry) => ({
          id: entry.entryId,
          label: entry.title,
          detail: entry.preview,
          badgeCount: 0,
          badgeTone: "attention",
          muted: Boolean(entry.resolvedAt),
          statusLabel: resolveInboxStatusLabel(entry.resolvedAt),
          statusTone: entry.resolvedAt ? "muted" : undefined,
        })),
        emptyState: {
          title: "All clear",
          detail: "No unresolved attention right now.",
          tone: "muted",
        },
      },
      {
        id: "followed",
        label: "Followed Threads",
        badgeCount: followedThreadsBadgeCount,
        badgeTone:
          followedThreadsBadgeCount > 0 &&
          chat.sidebar.followedThreads.some((thread) => thread.unreadMentionCount > 0)
            ? "attention"
            : followedThreadsBadgeCount > 0
              ? "default"
              : undefined,
        items: chat.sidebar.followedThreads.map((thread) => ({
          id: thread.entryId,
          label: thread.title,
          detail: thread.preview,
          badgeCount: thread.unreadReplyCount + thread.unreadMentionCount,
          badgeTone: conversationBadgeTone(thread.unreadMentionCount),
          muted: false,
        })),
        emptyState: {
          title: "No followed threads",
          detail: "Follow a thread to keep it pinned here.",
          tone: "muted",
        },
      },
      {
        id: "channels",
        label: "Channels",
        badgeCount: channelBadgeCounts.reduce((total, count) => total + count, 0),
        badgeTone: sectionBadgeTone({
          itemBadgeCounts: channelBadgeCounts,
          hasAttention: chat.sidebar.channels.some((conversation) => conversation.mentionCount > 0),
        }),
        items: chat.sidebar.channels.map((conversation) => ({
          id: conversation.conversationId,
          label: conversation.title,
          detail: conversation.latestMessagePreview,
          badgeCount: conversationBadgeCount(conversation),
          badgeTone: conversationBadgeTone(conversation.mentionCount),
          muted: false,
        })),
      },
      ...chat.sidebar.dmGroups.map((group) => ({
        id: group.id,
        label: group.label,
        badgeCount: dmGroupBadgeMeta.find((meta) => meta.id === group.id)?.badgeCount,
        badgeTone: sectionBadgeTone({
          itemBadgeCounts: dmGroupBadgeMeta.find((meta) => meta.id === group.id)?.counts ?? [],
          hasAttention:
            dmGroupBadgeMeta.find((meta) => meta.id === group.id)?.hasAttention ?? false,
        }),
        items: group.conversations.map((conversation) => ({
          id: conversation.conversationId,
          label: conversation.title,
          detail: conversation.latestMessagePreview,
          badgeCount: conversationBadgeCount(conversation),
          badgeTone: conversationBadgeTone(conversation.mentionCount),
          muted: false,
        })),
      })),
      {
        id: "viewer-recents",
        label: "Viewer Recents",
        items: chat.sidebar.viewerRecents.map((conversation) => ({
          id: conversation.entryId,
          label: conversation.title,
          detail: conversation.preview,
          badgeCount: 0,
          muted: false,
        })),
        emptyState: {
          title: "No viewer rooms",
          detail: "Read-only rooms will collect here when you open them.",
          tone: "muted",
        },
      },
    ],
  }
}
