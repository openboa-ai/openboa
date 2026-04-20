import type { ChatShellRuntimeSeed } from "../chat/index.js"
import type {
  ChatRuntimeGateway,
  ChatRuntimeGatewayAddParticipantInput,
  ChatRuntimeGatewayArchiveConversationInput,
  ChatRuntimeGatewayEditMessageInput,
  ChatRuntimeGatewayGrantAccessInput,
  ChatRuntimeGatewayJoinConversationInput,
  ChatRuntimeGatewayLeaveConversationInput,
  ChatRuntimeGatewayMarkReadInput,
  ChatRuntimeGatewayMethod,
  ChatRuntimeGatewayMethodInput,
  ChatRuntimeGatewayMethodOutput,
  ChatRuntimeGatewayPollEventsInput,
  ChatRuntimeGatewayPollEventsResult,
  ChatRuntimeGatewayPostMessageInput,
  ChatRuntimeGatewayRedactMessageInput,
  ChatRuntimeGatewayRemoveParticipantInput,
  ChatRuntimeGatewayRevokeAccessInput,
  ChatRuntimeGatewaySearchInput,
  ChatRuntimeGatewaySearchResult,
  ChatRuntimeGatewaySetMessageReactionInput,
  ChatRuntimeGatewaySetThreadFollowStateInput,
  ChatRuntimeGatewayUpdateConversationSettingsInput,
} from "../chat/runtime-gateway.js"
import { invokeChatRuntimeGatewayMethod } from "../chat/runtime-gateway.js"

export const CHAT_GATEWAY_HTTP_PATH = "/__openboa/chat/gateway"

function windowChatRuntimeGateway(): ChatRuntimeGateway | null {
  if (typeof window === "undefined") {
    return null
  }
  return window.openboaChatGateway ?? null
}

function hasHttpChatRuntimeGateway(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return window.location?.protocol === "http:" || window.location?.protocol === "https:"
}

export function hasChatShellRuntimeGateway(): boolean {
  return windowChatRuntimeGateway() != null || hasHttpChatRuntimeGateway()
}

async function invokeChatGatewayHttp<M extends ChatRuntimeGatewayMethod>(
  method: M,
  input: ChatRuntimeGatewayMethodInput<M>,
): Promise<ChatRuntimeGatewayMethodOutput<M> | null> {
  if (!hasHttpChatRuntimeGateway()) {
    return null
  }

  const response = await fetch(CHAT_GATEWAY_HTTP_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method, input }),
  })

  if (response.status === 404) {
    return null
  }

  const payload = (await response.json().catch(() => ({}))) as {
    result?: ChatRuntimeGatewayMethodOutput<M>
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `Chat gateway request failed: ${response.status}`)
  }
  return (payload.result ?? null) as ChatRuntimeGatewayMethodOutput<M> | null
}

async function invokeChatGateway<M extends ChatRuntimeGatewayMethod>(
  method: M,
  input: ChatRuntimeGatewayMethodInput<M>,
): Promise<ChatRuntimeGatewayMethodOutput<M> | null> {
  const directGateway = windowChatRuntimeGateway()
  if (directGateway) {
    return invokeChatRuntimeGatewayMethod(directGateway, method, input)
  }

  return invokeChatGatewayHttp(method, input)
}

export async function loadChatShellRuntimeSeed(input: {
  actorId: string
}): Promise<ChatShellRuntimeSeed | null> {
  return invokeChatGateway("loadSeed", {
    actorId: input.actorId,
  })
}

export async function loadChatShellRuntimeSeedFromGateway(input: {
  actorId: string
}): Promise<ChatShellRuntimeSeed | null> {
  return loadChatShellRuntimeSeed(input)
}

export async function postChatShellRuntimeMessage(
  input: ChatRuntimeGatewayPostMessageInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("postMessage", input)
  return true
}

export async function setChatShellRuntimeMessageReaction(
  input: ChatRuntimeGatewaySetMessageReactionInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("setMessageReaction", input)
  return true
}

export async function editChatShellRuntimeMessage(
  input: ChatRuntimeGatewayEditMessageInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("editMessage", input)
  return true
}

export async function redactChatShellRuntimeMessage(
  input: ChatRuntimeGatewayRedactMessageInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("redactMessage", input)
  return true
}

export async function markChatShellRuntimeRead(
  input: ChatRuntimeGatewayMarkReadInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("markRead", input)
  return true
}

export async function setChatShellRuntimeThreadFollowState(
  input: ChatRuntimeGatewaySetThreadFollowStateInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("setThreadFollowState", input)
  return true
}

export async function searchChatShellRuntimeMessages(
  input: ChatRuntimeGatewaySearchInput,
): Promise<ChatRuntimeGatewaySearchResult[] | null> {
  if (!hasChatShellRuntimeGateway()) {
    return null
  }
  return invokeChatGateway("searchMessages", input)
}

export async function pollChatShellRuntimeEvents(
  input: ChatRuntimeGatewayPollEventsInput,
): Promise<ChatRuntimeGatewayPollEventsResult | null> {
  if (!hasChatShellRuntimeGateway()) {
    return null
  }
  return invokeChatGateway("pollEvents", input)
}

export async function joinChatShellRuntimeConversation(
  input: ChatRuntimeGatewayJoinConversationInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("joinConversation", input)
  return true
}

export async function leaveChatShellRuntimeConversation(
  input: ChatRuntimeGatewayLeaveConversationInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("leaveConversation", input)
  return true
}

export async function addChatShellRuntimeConversationParticipant(
  input: ChatRuntimeGatewayAddParticipantInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("addParticipant", input)
  return true
}

export async function removeChatShellRuntimeConversationParticipant(
  input: ChatRuntimeGatewayRemoveParticipantInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("removeParticipant", input)
  return true
}

export async function grantChatShellRuntimeConversationAccess(
  input: ChatRuntimeGatewayGrantAccessInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("grantAccess", input)
  return true
}

export async function revokeChatShellRuntimeConversationAccess(
  input: ChatRuntimeGatewayRevokeAccessInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("revokeAccess", input)
  return true
}

export async function updateChatShellRuntimeConversationSettings(
  input: ChatRuntimeGatewayUpdateConversationSettingsInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("updateConversationSettings", input)
  return true
}

export async function archiveChatShellRuntimeConversation(
  input: ChatRuntimeGatewayArchiveConversationInput,
): Promise<boolean> {
  if (!hasChatShellRuntimeGateway()) {
    return false
  }
  await invokeChatGateway("archiveConversation", input)
  return true
}
