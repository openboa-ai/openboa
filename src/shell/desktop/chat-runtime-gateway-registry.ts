import type {
  ChatConversationPostingPolicy,
  ChatConversationVisibility,
} from "../../chat/core/model.js"
import {
  CHAT_RUNTIME_GATEWAY_IPC_CHANNELS,
  type ChatRuntimeGatewayMethod,
  type ChatRuntimeGatewayMethodInput,
  type ChatRuntimeGatewayMethodOutput,
} from "../chat/runtime-gateway.js"
import {
  addDesktopChatConversationParticipant,
  archiveDesktopChatConversation,
  editDesktopChatMessage,
  grantDesktopChatConversationAccess,
  joinDesktopChatConversation,
  leaveDesktopChatConversation,
  loadDesktopChatRuntimeSeed,
  markDesktopChatRead,
  pollDesktopChatEvents,
  postDesktopChatMessage,
  redactDesktopChatMessage,
  removeDesktopChatConversationParticipant,
  revokeDesktopChatConversationAccess,
  searchDesktopChatMessages,
  setDesktopChatMessageReaction,
  setDesktopChatThreadFollowState,
  updateDesktopChatConversationSettings,
} from "./chat-runtime-gateway.js"

type ChatRuntimeGatewayServerSpec<M extends ChatRuntimeGatewayMethod> = {
  channel: string
  parse(input: Record<string, unknown>): ChatRuntimeGatewayMethodInput<M>
  handle: (
    companyDir: string,
    input: ChatRuntimeGatewayMethodInput<M>,
  ) => Promise<ChatRuntimeGatewayMethodOutput<M>>
}

type ChatRuntimeGatewayServerRegistry = {
  [M in ChatRuntimeGatewayMethod]: ChatRuntimeGatewayServerSpec<M>
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "")
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function nullableStringField(value: unknown): string | null | undefined {
  return typeof value === "string" || value === null ? (value as string | null) : undefined
}

function optionalNumberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function booleanField(value: unknown): boolean {
  return Boolean(value)
}

function visibilityField(value: unknown): ChatConversationVisibility | undefined {
  return value === "public" || value === "private" ? value : undefined
}

function postingPolicyField(value: unknown): ChatConversationPostingPolicy | undefined {
  return value === "open" || value === "restricted" ? value : undefined
}

function commandHandler<I>(
  handler: (companyDir: string, input: I) => Promise<void>,
): (companyDir: string, input: I) => Promise<undefined> {
  return async (companyDir, input) => {
    await handler(companyDir, input)
    return undefined
  }
}

export const desktopChatRuntimeGatewayRegistry = {
  loadSeed: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.loadSeed,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
      }
    },
    handle: loadDesktopChatRuntimeSeed,
  },
  postMessage: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.postMessage,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        body: stringField(input.body),
        threadId: nullableStringField(input.threadId) ?? null,
        audienceId: nullableStringField(input.audienceId) ?? null,
      }
    },
    handle: commandHandler(postDesktopChatMessage),
  },
  setMessageReaction: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.setMessageReaction,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        messageId: stringField(input.messageId),
        emoji: stringField(input.emoji),
        active: booleanField(input.active),
      }
    },
    handle: commandHandler(setDesktopChatMessageReaction),
  },
  editMessage: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.editMessage,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        messageId: stringField(input.messageId),
        body: stringField(input.body),
      }
    },
    handle: commandHandler(editDesktopChatMessage),
  },
  redactMessage: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.redactMessage,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        messageId: stringField(input.messageId),
      }
    },
    handle: commandHandler(redactDesktopChatMessage),
  },
  markRead: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.markRead,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        threadId: nullableStringField(input.threadId) ?? null,
      }
    },
    handle: commandHandler(markDesktopChatRead),
  },
  setThreadFollowState: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.setThreadFollowState,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        threadId: stringField(input.threadId),
        followed: booleanField(input.followed),
      }
    },
    handle: commandHandler(setDesktopChatThreadFollowState),
  },
  searchMessages: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.searchMessages,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        query: stringField(input.query),
        limit: optionalNumberField(input.limit),
      }
    },
    handle: searchDesktopChatMessages,
  },
  pollEvents: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.pollEvents,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        afterSequence: Number(input.afterSequence ?? 0),
        limit: optionalNumberField(input.limit),
      }
    },
    handle: pollDesktopChatEvents,
  },
  joinConversation: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.joinConversation,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
      }
    },
    handle: commandHandler(joinDesktopChatConversation),
  },
  leaveConversation: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.leaveConversation,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
      }
    },
    handle: commandHandler(leaveDesktopChatConversation),
  },
  addParticipant: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.addParticipant,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        participantId: stringField(input.participantId),
      }
    },
    handle: commandHandler(addDesktopChatConversationParticipant),
  },
  removeParticipant: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.removeParticipant,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        participantId: stringField(input.participantId),
      }
    },
    handle: commandHandler(removeDesktopChatConversationParticipant),
  },
  grantAccess: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.grantAccess,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        participantId: stringField(input.participantId),
        roleId: stringField(input.roleId) as "participant" | "viewer" | "room_manager",
      }
    },
    handle: commandHandler(grantDesktopChatConversationAccess),
  },
  revokeAccess: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.revokeAccess,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        bindingId: stringField(input.bindingId),
      }
    },
    handle: commandHandler(revokeDesktopChatConversationAccess),
  },
  updateConversationSettings: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.updateConversationSettings,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
        title: optionalStringField(input.title),
        topic: nullableStringField(input.topic),
        visibility: visibilityField(input.visibility),
        postingPolicy: postingPolicyField(input.postingPolicy),
      }
    },
    handle: commandHandler(updateDesktopChatConversationSettings),
  },
  archiveConversation: {
    channel: CHAT_RUNTIME_GATEWAY_IPC_CHANNELS.archiveConversation,
    parse(input) {
      return {
        actorId: stringField(input.actorId),
        conversationId: stringField(input.conversationId),
      }
    },
    handle: commandHandler(archiveDesktopChatConversation),
  },
} satisfies ChatRuntimeGatewayServerRegistry

export function isChatRuntimeGatewayMethod(value: string): value is ChatRuntimeGatewayMethod {
  return value in desktopChatRuntimeGatewayRegistry
}

export function parseDesktopChatRuntimeGatewayMethodInput<M extends ChatRuntimeGatewayMethod>(
  method: M,
  input: unknown,
): ChatRuntimeGatewayMethodInput<M> {
  const spec = desktopChatRuntimeGatewayRegistry[method] as ChatRuntimeGatewayServerSpec<M>
  return spec.parse(normalizeRecord(input))
}

export async function executeDesktopChatRuntimeGatewayMethod<M extends ChatRuntimeGatewayMethod>(
  companyDir: string,
  method: M,
  input: ChatRuntimeGatewayMethodInput<M>,
): Promise<ChatRuntimeGatewayMethodOutput<M>> {
  const spec = desktopChatRuntimeGatewayRegistry[method] as ChatRuntimeGatewayServerSpec<M>
  return spec.handle(companyDir, input)
}

export async function invokeDesktopChatRuntimeGatewayMethod(
  companyDir: string,
  method: string,
  input: unknown,
): Promise<unknown> {
  if (!isChatRuntimeGatewayMethod(method)) {
    throw new Error(`Unsupported chat gateway method: ${method}`)
  }

  return executeDesktopChatRuntimeGatewayMethod(
    companyDir,
    method,
    parseDesktopChatRuntimeGatewayMethodInput(method, input),
  )
}
