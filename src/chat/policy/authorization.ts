import type {
  ChatConversationRecord,
  ChatGrantBindingRecord,
  ChatRoleId,
  ChatRoomMembershipRecord,
} from "../core/model.js"

export type ChatActionId =
  | "chat.grant.manage"
  | "room.read"
  | "room.join"
  | "room.leave"
  | "message.create"
  | "message.edit"
  | "message.redact"
  | "message.react"
  | "message.mass_mention"
  | "room.settings.update"
  | "room.archive"
  | "room.membership.manage"
  | "room.grant.manage"

export type ChatScopeActionId = Extract<ChatActionId, "chat.grant.manage">
export type ConversationActionId = Exclude<ChatActionId, ChatScopeActionId>

export interface ChatRoleDefinition {
  roleId: ChatRoleId
  actions: readonly ChatActionId[]
}

const PARTICIPANT_ACTIONS = [
  "room.read",
  "room.join",
  "room.leave",
  "message.create",
  "message.edit",
  "message.redact",
  "message.react",
] as const
const ROOM_MANAGER_ACTIONS = [
  ...PARTICIPANT_ACTIONS,
  "message.mass_mention",
  "room.settings.update",
  "room.archive",
  "room.membership.manage",
  "room.grant.manage",
] as const

export const CHAT_ROLE_DEFINITIONS: readonly ChatRoleDefinition[] = [
  {
    roleId: "viewer",
    actions: ["room.read"],
  },
  {
    roleId: "participant",
    actions: PARTICIPANT_ACTIONS,
  },
  {
    roleId: "room_manager",
    actions: ROOM_MANAGER_ACTIONS,
  },
  {
    roleId: "chat_admin",
    actions: ["chat.grant.manage", ...ROOM_MANAGER_ACTIONS],
  },
] as const

const ACTIONS_BY_ROLE = new Map(
  CHAT_ROLE_DEFINITIONS.map((definition) => [definition.roleId, new Set(definition.actions)]),
)

function uniqueRoleIds(roleIds: ChatRoleId[]): ChatRoleId[] {
  return Array.from(new Set(roleIds))
}

function isActiveBinding(binding: ChatGrantBindingRecord): boolean {
  return binding.bindingState === "active"
}

function roleAllows(roleId: ChatRoleId, action: ChatActionId): boolean {
  return ACTIONS_BY_ROLE.get(roleId)?.has(action) ?? false
}

export interface ChatGrantResolutionScope {
  scopeKind: "chat" | "conversation"
  conversationId?: string | null
}

export function resolveScopedRoleIds(
  bindings: ChatGrantBindingRecord[],
  scope: ChatGrantResolutionScope,
): ChatRoleId[] {
  return uniqueRoleIds(
    bindings
      .filter(isActiveBinding)
      .filter(
        (binding) =>
          (binding.scopeKind === "chat" &&
            (scope.scopeKind === "chat" || scope.scopeKind === "conversation")) ||
          (scope.scopeKind === "conversation" &&
            binding.scopeKind === "conversation" &&
            binding.conversationId === scope.conversationId),
      )
      .map((binding) => binding.roleId),
  )
}

export function resolveConversationRoleIds(
  bindings: ChatGrantBindingRecord[],
  conversationId: string,
): ChatRoleId[] {
  return resolveScopedRoleIds(bindings, {
    scopeKind: "conversation",
    conversationId,
  })
}

export function resolveChatRoleIds(bindings: ChatGrantBindingRecord[]): ChatRoleId[] {
  return resolveScopedRoleIds(bindings, { scopeKind: "chat" })
}

export interface ChatPermissionInput {
  actorId: string
  bindings: ChatGrantBindingRecord[]
  action: ChatScopeActionId
}

export interface ChatPermissionDecision {
  allowed: boolean
  reason: string
  roleIds: ChatRoleId[]
}

export function evaluateChatAction(input: ChatPermissionInput): ChatPermissionDecision {
  const roleIds = resolveChatRoleIds(input.bindings)
  if (!roleIds.some((roleId) => roleAllows(roleId, input.action))) {
    return {
      allowed: false,
      reason: `No active role grants ${input.action}`,
      roleIds,
    }
  }

  return {
    allowed: true,
    reason: `Role grant allows ${input.action}`,
    roleIds,
  }
}

export interface ConversationPermissionInput {
  room: ChatConversationRecord
  actorId: string
  bindings: ChatGrantBindingRecord[]
  membership: ChatRoomMembershipRecord | null
  action: ConversationActionId
}

export interface ConversationPermissionDecision {
  allowed: boolean
  reason: string
  roleIds: ChatRoleId[]
  isJoined: boolean
}

export function evaluateConversationAction(
  input: ConversationPermissionInput,
): ConversationPermissionDecision {
  const roleIds = resolveConversationRoleIds(input.bindings, input.room.conversationId)
  const roleSet = new Set(roleIds)
  const isJoined = input.membership?.membershipState === "joined"

  if (input.action === "room.read") {
    if (input.room.visibility === "public") {
      return {
        allowed: true,
        reason: "Public rooms are readable without an explicit grant",
        roleIds,
        isJoined,
      }
    }
    if (roleIds.length > 0) {
      return {
        allowed: true,
        reason: `Explicit grant allows ${input.actorId} to read the room`,
        roleIds,
        isJoined,
      }
    }
    return {
      allowed: false,
      reason: "Private rooms require an explicit grant",
      roleIds,
      isJoined,
    }
  }

  if (input.action === "room.join") {
    if (input.room.lifecycleState === "archived") {
      return {
        allowed: false,
        reason: "Archived rooms cannot accept new joins",
        roleIds,
        isJoined,
      }
    }
    if (input.room.visibility === "public") {
      return {
        allowed: true,
        reason: "Public rooms can be joined directly",
        roleIds,
        isJoined,
      }
    }
    if (roleIds.some((roleId) => roleAllows(roleId, "room.join"))) {
      return {
        allowed: true,
        reason: "Explicit participant access allows joining this private room",
        roleIds,
        isJoined,
      }
    }
    return {
      allowed: false,
      reason: "Joining a private room requires participant access",
      roleIds,
      isJoined,
    }
  }

  if (!roleIds.some((roleId) => roleAllows(roleId, input.action))) {
    return {
      allowed: false,
      reason: `No active role grants ${input.action}`,
      roleIds,
      isJoined,
    }
  }

  if (input.action === "room.leave") {
    return isJoined
      ? {
          allowed: true,
          reason: "Joined participants can leave their rooms",
          roleIds,
          isJoined,
        }
      : {
          allowed: false,
          reason: "Only joined participants can leave a room",
          roleIds,
          isJoined,
        }
  }

  if (
    input.action === "message.create" ||
    input.action === "message.edit" ||
    input.action === "message.redact"
  ) {
    if (!isJoined) {
      return {
        allowed: false,
        reason:
          input.action === "message.create"
            ? "Only joined participants can post messages"
            : input.action === "message.edit"
              ? "Only joined participants can edit messages"
              : "Only joined participants can redact messages",
        roleIds,
        isJoined,
      }
    }
    if (input.room.lifecycleState === "archived") {
      return {
        allowed: false,
        reason: "Archived rooms are read-only",
        roleIds,
        isJoined,
      }
    }
    if (
      input.action === "message.create" &&
      input.room.postingPolicy === "restricted" &&
      !roleSet.has("room_manager") &&
      !roleSet.has("chat_admin")
    ) {
      return {
        allowed: false,
        reason: "Restricted rooms only allow room managers to post",
        roleIds,
        isJoined,
      }
    }
    return {
      allowed: true,
      reason:
        input.action === "message.create"
          ? "Joined participant can post in this room"
          : input.action === "message.edit"
            ? "Joined participant can edit messages in this room"
            : "Joined participant can redact messages in this room",
      roleIds,
      isJoined,
    }
  }

  if (input.action === "message.react") {
    if (!isJoined) {
      return {
        allowed: false,
        reason: "Only joined participants can react to messages",
        roleIds,
        isJoined,
      }
    }
    if (input.room.lifecycleState === "archived") {
      return {
        allowed: false,
        reason: "Archived rooms are read-only",
        roleIds,
        isJoined,
      }
    }
    return {
      allowed: true,
      reason: "Joined participant can react in this room",
      roleIds,
      isJoined,
    }
  }

  if (input.action === "message.mass_mention") {
    if (!isJoined) {
      return {
        allowed: false,
        reason: "Only joined participants can use mass mention",
        roleIds,
        isJoined,
      }
    }
    if (input.room.lifecycleState === "archived") {
      return {
        allowed: false,
        reason: "Archived rooms are read-only",
        roleIds,
        isJoined,
      }
    }
  }

  return {
    allowed: true,
    reason: `Role grant allows ${input.action}`,
    roleIds,
    isJoined,
  }
}
