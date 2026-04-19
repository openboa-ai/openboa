import type { ChatConversationRecord, ChatRoleId } from "../../chat/core/model.js"
import type { ChatOpenMode } from "./open-flow.js"

export interface ChatConversationAccessGrant {
  bindingId: string
  subjectId: string
  roleId: "participant" | "viewer" | "room_manager"
}

function isJoinedConversationActor(
  conversation: ChatConversationRecord,
  actorId: string,
  openMode: ChatOpenMode,
): boolean {
  return openMode === "joined" && conversation.participantIds.includes(actorId)
}

export function resolveChatActorConversationRoleIds(input: {
  conversation: ChatConversationRecord
  accessGrants: ChatConversationAccessGrant[]
  actorId: string
}): ChatRoleId[] {
  const roleIds = new Set<ChatRoleId>()
  const joined = input.conversation.participantIds.includes(input.actorId)

  if (joined) {
    roleIds.add("participant")
    if (input.conversation.kind === "dm" || input.conversation.kind === "group_dm") {
      roleIds.add("room_manager")
    }
  }

  for (const grant of input.accessGrants) {
    if (grant.subjectId === input.actorId) {
      roleIds.add(grant.roleId)
    }
  }

  return [...roleIds]
}

export function canChatActorManageConversation(input: {
  conversation: ChatConversationRecord
  accessGrants: ChatConversationAccessGrant[]
  actorId: string
  openMode: ChatOpenMode
}): boolean {
  if (
    !isJoinedConversationActor(input.conversation, input.actorId, input.openMode) ||
    input.conversation.lifecycleState === "archived"
  ) {
    return false
  }

  return resolveChatActorConversationRoleIds(input).includes("room_manager")
}

export function canChatActorModerateMessages(input: {
  conversation: ChatConversationRecord
  accessGrants: ChatConversationAccessGrant[]
  actorId: string
  openMode: ChatOpenMode
}): boolean {
  if (
    !isJoinedConversationActor(input.conversation, input.actorId, input.openMode) ||
    input.conversation.lifecycleState === "archived"
  ) {
    return false
  }

  return resolveChatActorConversationRoleIds(input).includes("room_manager")
}

export function canChatActorPostMessages(input: {
  conversation: ChatConversationRecord
  accessGrants: ChatConversationAccessGrant[]
  actorId: string
  openMode: ChatOpenMode
}): boolean {
  if (!isJoinedConversationActor(input.conversation, input.actorId, input.openMode)) {
    return false
  }
  if (input.conversation.lifecycleState === "archived") {
    return false
  }
  if (input.conversation.postingPolicy !== "restricted") {
    return true
  }

  return canChatActorModerateMessages(input)
}
