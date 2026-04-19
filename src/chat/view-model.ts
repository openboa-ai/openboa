import type { ChatConversation, ChatDmGroup, ChatMessage } from "./core/model.js"

export interface ChatInboxEntry {
  entryId: string
  kind: "direct" | "mention"
  title: string
  preview: string
  conversationId: string
  messageId: string | null
  createdAt: string
  resolvedAt?: string | null
}

export interface ChatSidebarFollowedThread {
  entryId: string
  title: string
  preview: string
  conversationId: string
  threadRootMessageId: string
  unreadReplyCount: number
  unreadMentionCount: number
  latestReplyAt: string | null
}

export interface ChatSidebarViewerRecent {
  entryId: string
  title: string
  preview: string
  conversationId: string
  observedAt: string
}

export interface ChatProjectedMessage extends ChatMessage {
  threadReplyCount?: number
  threadPreview?: string | null
  threadPreviewAuthorId?: string | null
  threadLastReplyAt?: string | null
}

export interface ChatSidebar {
  inbox: ChatInboxEntry[]
  followedThreads: ChatSidebarFollowedThread[]
  channels: ChatConversation[]
  dmGroups: Array<{
    id: ChatDmGroup
    label: string
    conversations: ChatConversation[]
  }>
  viewerRecents: ChatSidebarViewerRecent[]
}

export interface ChatSurface {
  activeConversationId: string
  activeConversation: ChatConversation | null
  sidebar: ChatSidebar
  transcript: ChatProjectedMessage[]
  activeThreadRoot: ChatProjectedMessage | null
  activeThreadMessages: ChatProjectedMessage[]
  composerPlaceholder: string
}
