const DEFAULT_FALLBACK_ACTOR_ID = "local-actor"

export function defaultChatActorId(): string {
  const configured = process.env.OPENBOA_DEFAULT_ACTOR_ID?.trim()
  return configured && configured.length > 0 ? configured : DEFAULT_FALLBACK_ACTOR_ID
}

export function resolveChatActorId(value?: string | null): string {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : defaultChatActorId()
}
