import type {
  ChatFollowedThread,
  ChatSearchResult,
  ChatViewerRecentConversation,
} from "../../chat/projections/projections.js"
import type { ChatInboxEntry } from "../../chat/view-model.js"

export type ChatOpenMode = "joined" | "viewer"

export type ChatOpenSource = "inbox" | "thread" | "search" | "viewer-recent"

export interface ChatOpenIntent {
  source: ChatOpenSource
  openConversationId: string
  sourceConversationId: string
  openMode: ChatOpenMode
  focusMessageId: string | null
  activeThreadId: string | null
}

export function openInboxEntry(entry: ChatInboxEntry): ChatOpenIntent {
  return {
    source: "inbox",
    openConversationId: entry.conversationId,
    sourceConversationId: entry.conversationId,
    openMode: "joined",
    focusMessageId: entry.messageId,
    activeThreadId: null,
  }
}

export function openFollowedThread(thread: ChatFollowedThread): ChatOpenIntent {
  return {
    source: "thread",
    openConversationId: thread.conversationId,
    sourceConversationId: thread.conversationId,
    openMode: "joined",
    focusMessageId: thread.threadRootMessageId,
    activeThreadId: thread.threadRootMessageId,
  }
}

export function openSearchResult(result: ChatSearchResult): ChatOpenIntent {
  return {
    source: "search",
    openConversationId: result.openConversationId,
    sourceConversationId: result.sourceConversationId,
    openMode: result.openMode,
    focusMessageId: result.messageId,
    activeThreadId: result.threadId ?? null,
  }
}

export function openViewerRecentConversation(
  conversation: ChatViewerRecentConversation,
): ChatOpenIntent {
  return {
    source: "viewer-recent",
    openConversationId: conversation.conversationId,
    sourceConversationId: conversation.conversationId,
    openMode: "viewer",
    focusMessageId: null,
    activeThreadId: null,
  }
}
