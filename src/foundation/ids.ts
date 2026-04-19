import { version as uuidVersion, v7 as uuidv7, validate as validateUuid } from "uuid"

export function makeId(prefix: string): string {
  return `${prefix}-${uuidv7()}`
}

export function makeUuidV7(): string {
  return uuidv7()
}

export function isUuidV7(value: string | undefined | null): boolean {
  if (!value?.trim()) {
    return false
  }
  return validateUuid(value) && uuidVersion(value) === 7
}

export function directRoomId(agentId: string): string {
  return `dm:${agentId}`
}

export function parseDirectRoomRef(roomId: string | undefined | null): string[] {
  const trimmed = roomId?.trim()
  if (!trimmed?.startsWith("dm:")) {
    return []
  }
  const payload = trimmed.slice(3).trim()
  if (!payload) {
    return []
  }
  return payload
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
}

export function normalizeRoomId(roomId: string | undefined | null): string {
  const trimmed = roomId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : "general"
}
