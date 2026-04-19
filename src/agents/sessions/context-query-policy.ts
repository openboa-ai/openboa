import type { SessionEvent, SessionEventType } from "../schema/runtime.js"
import type { SessionStore } from "./session-store.js"

const DEFAULT_BOOTSTRAP_CONVERSATION_LIMIT = 48
const DEFAULT_BOOTSTRAP_RUNTIME_LIMIT = 12
const DEFAULT_REWIND_CONVERSATION_LIMIT = 12
const DEFAULT_REWIND_RUNTIME_LIMIT = 4
const DEFAULT_DELTA_CONVERSATION_LIMIT = 24
const DEFAULT_DELTA_RUNTIME_LIMIT = 8

export const SESSION_CONTEXT_CONVERSATION_EVENT_TYPES = [
  "user.message",
  "agent.message",
] as const satisfies SessionEventType[]

export const SESSION_CONTEXT_RUNTIME_EVENT_TYPES = [
  "user.define_outcome",
  "user.interrupt",
  "user.tool_confirmation",
  "user.custom_tool_result",
  "session.child_created",
  "session.child_idle",
  "session.status_changed",
  "session.status_idle",
  "span.completed",
  "agent.tool_use",
  "agent.custom_tool_use",
] as const satisfies SessionEventType[]

export const SESSION_CONTEXT_EVENT_TYPES = [
  ...SESSION_CONTEXT_CONVERSATION_EVENT_TYPES,
  ...SESSION_CONTEXT_RUNTIME_EVENT_TYPES,
] as const satisfies SessionEventType[]

export interface SessionContextQueryPolicy {
  bootstrapConversationLimit?: number
  bootstrapRuntimeLimit?: number
  rewindConversationLimit?: number
  rewindRuntimeLimit?: number
  deltaConversationLimit?: number
  deltaRuntimeLimit?: number
}

function sortAndDedupeProcessedEvents(events: SessionEvent[]): SessionEvent[] {
  const deduped = new Map<string, SessionEvent>()
  for (const event of events) {
    if (event.processedAt === null) {
      continue
    }
    if (
      !SESSION_CONTEXT_EVENT_TYPES.includes(
        event.type as (typeof SESSION_CONTEXT_EVENT_TYPES)[number],
      )
    ) {
      continue
    }
    deduped.set(event.id, event)
  }
  return [...deduped.values()].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )
}

function tailProcessedEvents(
  events: SessionEvent[],
  limit: number,
  types: readonly SessionEventType[],
): SessionEvent[] {
  const processed = sortAndDedupeProcessedEvents(events).filter((event) =>
    types.includes(event.type),
  )
  return processed.slice(-limit)
}

export async function loadSessionContextEvents(input: {
  sessionId: string
  processedEvents: SessionEvent[]
  lastContextEventId: string | null
  sessionStore: Pick<SessionStore, "listEvents">
  policy?: SessionContextQueryPolicy
}): Promise<SessionEvent[]> {
  const bootstrapConversationLimit =
    input.policy?.bootstrapConversationLimit ?? DEFAULT_BOOTSTRAP_CONVERSATION_LIMIT
  const bootstrapRuntimeLimit =
    input.policy?.bootstrapRuntimeLimit ?? DEFAULT_BOOTSTRAP_RUNTIME_LIMIT
  const rewindConversationLimit =
    input.policy?.rewindConversationLimit ?? DEFAULT_REWIND_CONVERSATION_LIMIT
  const rewindRuntimeLimit = input.policy?.rewindRuntimeLimit ?? DEFAULT_REWIND_RUNTIME_LIMIT
  const deltaConversationLimit =
    input.policy?.deltaConversationLimit ?? DEFAULT_DELTA_CONVERSATION_LIMIT
  const deltaRuntimeLimit = input.policy?.deltaRuntimeLimit ?? DEFAULT_DELTA_RUNTIME_LIMIT

  if (!input.lastContextEventId) {
    return sortAndDedupeProcessedEvents([
      ...tailProcessedEvents(
        input.processedEvents,
        bootstrapConversationLimit,
        SESSION_CONTEXT_CONVERSATION_EVENT_TYPES,
      ),
      ...tailProcessedEvents(
        input.processedEvents,
        bootstrapRuntimeLimit,
        SESSION_CONTEXT_RUNTIME_EVENT_TYPES,
      ),
    ])
  }

  const anchorEvent =
    input.processedEvents.find((event) => event.id === input.lastContextEventId) ?? null
  if (!anchorEvent) {
    return sortAndDedupeProcessedEvents([
      ...tailProcessedEvents(
        input.processedEvents,
        bootstrapConversationLimit,
        SESSION_CONTEXT_CONVERSATION_EVENT_TYPES,
      ),
      ...tailProcessedEvents(
        input.processedEvents,
        bootstrapRuntimeLimit,
        SESSION_CONTEXT_RUNTIME_EVENT_TYPES,
      ),
    ])
  }

  const [
    rewindConversationEvents,
    rewindRuntimeEvents,
    deltaConversationEvents,
    deltaRuntimeEvents,
  ] = await Promise.all([
    input.sessionStore.listEvents(input.sessionId, {
      beforeEventId: input.lastContextEventId,
      includeProcessed: true,
      limit: rewindConversationLimit,
      types: [...SESSION_CONTEXT_CONVERSATION_EVENT_TYPES],
    }),
    input.sessionStore.listEvents(input.sessionId, {
      beforeEventId: input.lastContextEventId,
      includeProcessed: true,
      limit: rewindRuntimeLimit,
      types: [...SESSION_CONTEXT_RUNTIME_EVENT_TYPES],
    }),
    input.sessionStore.listEvents(input.sessionId, {
      afterEventId: input.lastContextEventId,
      includeProcessed: true,
      limit: deltaConversationLimit,
      types: [...SESSION_CONTEXT_CONVERSATION_EVENT_TYPES],
    }),
    input.sessionStore.listEvents(input.sessionId, {
      afterEventId: input.lastContextEventId,
      includeProcessed: true,
      limit: deltaRuntimeLimit,
      types: [...SESSION_CONTEXT_RUNTIME_EVENT_TYPES],
    }),
  ])

  return sortAndDedupeProcessedEvents([
    ...rewindConversationEvents,
    ...rewindRuntimeEvents,
    anchorEvent,
    ...deltaConversationEvents,
    ...deltaRuntimeEvents,
  ])
}
