import type {
  ChatConversationPostingPolicy,
  ChatConversationVisibility,
} from "../../chat/core/model.js"
import type { ChatSidebarViewerRecent } from "../../chat/view-model.js"
import type { ChatOpenMode } from "./open-flow.js"
import type { ChatConversationAccessGrant } from "./permissions.js"
import type { ChatShellRuntimeSeed, ChatShellRuntimeSeedItem } from "./shell-runtime.js"

export interface ChatRuntimeGatewayLoadSeedInput {
  actorId: string
}

export interface ChatRuntimeGatewayPostMessageInput {
  actorId: string
  conversationId: string
  body: string
  threadId?: string | null
  audienceId?: string | null
}

export interface ChatRuntimeGatewaySetMessageReactionInput {
  actorId: string
  conversationId: string
  messageId: string
  emoji: string
  active: boolean
}

export interface ChatRuntimeGatewayEditMessageInput {
  actorId: string
  conversationId: string
  messageId: string
  body: string
}

export interface ChatRuntimeGatewayRedactMessageInput {
  actorId: string
  conversationId: string
  messageId: string
}

export interface ChatRuntimeGatewayMarkReadInput {
  actorId: string
  conversationId: string
  threadId?: string | null
}

export interface ChatRuntimeGatewaySetThreadFollowStateInput {
  actorId: string
  conversationId: string
  threadId: string
  followed: boolean
}

export interface ChatRuntimeGatewaySearchInput {
  actorId: string
  query: string
  limit?: number
}

export interface ChatRuntimeGatewayPollEventsInput {
  actorId: string
  afterSequence: number
  limit?: number
}

export interface ChatRuntimeGatewayPollEventsResult {
  nextSequence: number
  hasEvents: boolean
}

export interface ChatRuntimeGatewayJoinConversationInput {
  actorId: string
  conversationId: string
}

export interface ChatRuntimeGatewayLeaveConversationInput {
  actorId: string
  conversationId: string
}

export interface ChatRuntimeGatewayAddParticipantInput {
  actorId: string
  conversationId: string
  participantId: string
}

export interface ChatRuntimeGatewayRemoveParticipantInput {
  actorId: string
  conversationId: string
  participantId: string
}

export interface ChatRuntimeGatewayGrantAccessInput {
  actorId: string
  conversationId: string
  participantId: string
  roleId: ChatConversationAccessGrant["roleId"]
}

export interface ChatRuntimeGatewayRevokeAccessInput {
  actorId: string
  conversationId: string
  bindingId: string
}

export interface ChatRuntimeGatewayUpdateConversationSettingsInput {
  actorId: string
  conversationId: string
  title?: string
  topic?: string | null
  visibility?: ChatConversationVisibility
  postingPolicy?: ChatConversationPostingPolicy
}

export interface ChatRuntimeGatewayArchiveConversationInput {
  actorId: string
  conversationId: string
}

export interface ChatRuntimeGatewaySearchResult {
  resultKind: "message" | "conversation"
  sidebarItemId: string
  conversationId: string
  conversationTitle: string
  messageId: string | null
  threadId: string | null
  openMode: ChatOpenMode
  preview: string
  createdAt: string
  seedItem?: ChatShellRuntimeSeedItem
  viewerRecentEntry?: ChatSidebarViewerRecent
}

export interface ChatRuntimeGatewayMethodMap {
  loadSeed: {
    input: ChatRuntimeGatewayLoadSeedInput
    output: ChatShellRuntimeSeed
  }
  postMessage: {
    input: ChatRuntimeGatewayPostMessageInput
    output: undefined
  }
  setMessageReaction: {
    input: ChatRuntimeGatewaySetMessageReactionInput
    output: undefined
  }
  editMessage: {
    input: ChatRuntimeGatewayEditMessageInput
    output: undefined
  }
  redactMessage: {
    input: ChatRuntimeGatewayRedactMessageInput
    output: undefined
  }
  markRead: {
    input: ChatRuntimeGatewayMarkReadInput
    output: undefined
  }
  setThreadFollowState: {
    input: ChatRuntimeGatewaySetThreadFollowStateInput
    output: undefined
  }
  searchMessages: {
    input: ChatRuntimeGatewaySearchInput
    output: ChatRuntimeGatewaySearchResult[]
  }
  pollEvents: {
    input: ChatRuntimeGatewayPollEventsInput
    output: ChatRuntimeGatewayPollEventsResult
  }
  joinConversation: {
    input: ChatRuntimeGatewayJoinConversationInput
    output: undefined
  }
  leaveConversation: {
    input: ChatRuntimeGatewayLeaveConversationInput
    output: undefined
  }
  addParticipant: {
    input: ChatRuntimeGatewayAddParticipantInput
    output: undefined
  }
  removeParticipant: {
    input: ChatRuntimeGatewayRemoveParticipantInput
    output: undefined
  }
  grantAccess: {
    input: ChatRuntimeGatewayGrantAccessInput
    output: undefined
  }
  revokeAccess: {
    input: ChatRuntimeGatewayRevokeAccessInput
    output: undefined
  }
  updateConversationSettings: {
    input: ChatRuntimeGatewayUpdateConversationSettingsInput
    output: undefined
  }
  archiveConversation: {
    input: ChatRuntimeGatewayArchiveConversationInput
    output: undefined
  }
}

export type ChatRuntimeGatewayMethod = keyof ChatRuntimeGatewayMethodMap

export type ChatRuntimeGatewayMethodInput<M extends ChatRuntimeGatewayMethod> =
  ChatRuntimeGatewayMethodMap[M]["input"]

export type ChatRuntimeGatewayMethodOutput<M extends ChatRuntimeGatewayMethod> =
  ChatRuntimeGatewayMethodMap[M]["output"]

export const CHAT_RUNTIME_GATEWAY_METHODS = [
  "loadSeed",
  "postMessage",
  "setMessageReaction",
  "editMessage",
  "redactMessage",
  "markRead",
  "setThreadFollowState",
  "searchMessages",
  "pollEvents",
  "joinConversation",
  "leaveConversation",
  "addParticipant",
  "removeParticipant",
  "grantAccess",
  "revokeAccess",
  "updateConversationSettings",
  "archiveConversation",
] as const satisfies readonly ChatRuntimeGatewayMethod[]

export const CHAT_RUNTIME_GATEWAY_IPC_CHANNELS = {
  loadSeed: "openboa:chat:load-seed",
  postMessage: "openboa:chat:post-message",
  setMessageReaction: "openboa:chat:set-message-reaction",
  editMessage: "openboa:chat:edit-message",
  redactMessage: "openboa:chat:redact-message",
  markRead: "openboa:chat:mark-read",
  setThreadFollowState: "openboa:chat:set-thread-follow-state",
  searchMessages: "openboa:chat:search-messages",
  pollEvents: "openboa:chat:poll-events",
  joinConversation: "openboa:chat:join-conversation",
  leaveConversation: "openboa:chat:leave-conversation",
  addParticipant: "openboa:chat:add-participant",
  removeParticipant: "openboa:chat:remove-participant",
  grantAccess: "openboa:chat:grant-access",
  revokeAccess: "openboa:chat:revoke-access",
  updateConversationSettings: "openboa:chat:update-conversation-settings",
  archiveConversation: "openboa:chat:archive-conversation",
} as const satisfies Record<ChatRuntimeGatewayMethod, string>

export type ChatRuntimeGateway = {
  [M in ChatRuntimeGatewayMethod]: (
    input: ChatRuntimeGatewayMethodInput<M>,
  ) => Promise<ChatRuntimeGatewayMethodOutput<M>>
}

export function createChatRuntimeGatewayClient(
  invokeMethod: <M extends ChatRuntimeGatewayMethod>(
    method: M,
    input: ChatRuntimeGatewayMethodInput<M>,
  ) => Promise<ChatRuntimeGatewayMethodOutput<M>>,
): ChatRuntimeGateway {
  return {
    loadSeed: (input) => invokeMethod("loadSeed", input),
    postMessage: (input) => invokeMethod("postMessage", input),
    setMessageReaction: (input) => invokeMethod("setMessageReaction", input),
    editMessage: (input) => invokeMethod("editMessage", input),
    redactMessage: (input) => invokeMethod("redactMessage", input),
    markRead: (input) => invokeMethod("markRead", input),
    setThreadFollowState: (input) => invokeMethod("setThreadFollowState", input),
    searchMessages: (input) => invokeMethod("searchMessages", input),
    pollEvents: (input) => invokeMethod("pollEvents", input),
    joinConversation: (input) => invokeMethod("joinConversation", input),
    leaveConversation: (input) => invokeMethod("leaveConversation", input),
    addParticipant: (input) => invokeMethod("addParticipant", input),
    removeParticipant: (input) => invokeMethod("removeParticipant", input),
    grantAccess: (input) => invokeMethod("grantAccess", input),
    revokeAccess: (input) => invokeMethod("revokeAccess", input),
    updateConversationSettings: (input) => invokeMethod("updateConversationSettings", input),
    archiveConversation: (input) => invokeMethod("archiveConversation", input),
  }
}

export function invokeChatRuntimeGatewayMethod<M extends ChatRuntimeGatewayMethod>(
  gateway: ChatRuntimeGateway,
  method: M,
  input: ChatRuntimeGatewayMethodInput<M>,
): Promise<ChatRuntimeGatewayMethodOutput<M>> {
  return gateway[method](input)
}
