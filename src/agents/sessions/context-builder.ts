import type { AgentHistoryRecord, BuiltContext } from "../context/model.js"
import type { SessionEvent } from "../schema/runtime.js"

const RUNTIME_NOTE_PREFIX = "[session-event]"
const MAX_RUNTIME_NOTE_LENGTH = 180
const MIN_CONVERSATION_CONTINUITY_RECORDS = 2

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function renderRecord(record: AgentHistoryRecord): string {
  return `${record.role}:${record.kind}: ${record.message}`
}

function isRuntimeNoteRecord(record: AgentHistoryRecord): boolean {
  return record.kind === "runtime_note"
}

function compactInlineText(value: string, maxLength = MAX_RUNTIME_NOTE_LENGTH): string {
  const normalized = value.replace(/\s+/gu, " ").trim()
  if (normalized.length === 0) {
    return "empty"
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized
}

function compactStructuredValue(value: unknown): string {
  if (typeof value === "string") {
    return compactInlineText(value)
  }
  try {
    return compactInlineText(JSON.stringify(value))
  } catch {
    return compactInlineText(String(value))
  }
}

function renderRuntimeNote(event: SessionEvent): string | null {
  switch (event.type) {
    case "user.message":
    case "agent.message":
    case "span.started":
      return null
    case "span.completed":
      return `${RUNTIME_NOTE_PREFIX} span.completed kind=${event.spanKind} name=${event.name} result=${event.result}${event.summary ? ` summary=${compactInlineText(event.summary)}` : ""}`
    case "user.define_outcome":
      return `${RUNTIME_NOTE_PREFIX} user.define_outcome title=${compactInlineText(event.outcome.title, 80)} detail=${compactInlineText(event.outcome.detail ?? "none", 80)} success=${compactInlineText(event.outcome.successCriteria.join(" | ") || "none", 80)}`
    case "user.interrupt":
      return `${RUNTIME_NOTE_PREFIX} user.interrupt${event.note ? ` note=${compactInlineText(event.note, 80)}` : ""}`
    case "user.tool_confirmation":
      return `${RUNTIME_NOTE_PREFIX} user.tool_confirmation ${event.toolName} request=${event.requestId} allowed=${String(event.allowed)}${event.note ? ` note=${compactInlineText(event.note, 80)}` : ""}`
    case "user.custom_tool_result":
      return `${RUNTIME_NOTE_PREFIX} user.custom_tool_result ${event.toolName} request=${event.requestId} output=${compactInlineText(event.output)}`
    case "session.child_created":
      return `${RUNTIME_NOTE_PREFIX} session.child_created child=${event.childSessionId}${event.outcomeTitle ? ` outcome=${compactInlineText(event.outcomeTitle, 80)}` : ""} message=${compactInlineText(event.message)}`
    case "session.child_idle":
      return `${RUNTIME_NOTE_PREFIX} session.child_idle child=${event.childSessionId} stopReason=${event.childStopReason} cycles=${String(event.executedCycles)} summary=${compactInlineText(event.summary)}`
    case "agent.custom_tool_use":
      return `${RUNTIME_NOTE_PREFIX} agent.custom_tool_use ${event.toolName} request=${event.requestId} input=${compactStructuredValue(event.input)}`
    case "agent.tool_use":
      return `${RUNTIME_NOTE_PREFIX} agent.tool_use ${event.toolName}${event.requestId ? ` request=${event.requestId}` : ""} ownership=${event.ownership} permission=${event.permissionPolicy}${event.output ? ` output=${compactInlineText(event.output)}` : ""}`
    case "session.status_changed":
      return `${RUNTIME_NOTE_PREFIX} session.status_changed ${event.fromStatus}->${event.toStatus} reason=${event.reason}`
    case "session.status_idle":
      return `${RUNTIME_NOTE_PREFIX} session.status_idle reason=${event.reason} summary=${compactInlineText(event.summary)}${event.blockingEventIds && event.blockingEventIds.length > 0 ? ` blocking=${event.blockingEventIds.join(",")}` : ""}`
  }
}

function toHistoryRecords(events: SessionEvent[]): AgentHistoryRecord[] {
  const history: AgentHistoryRecord[] = []

  for (const event of events) {
    if (event.type === "user.message") {
      history.push({
        role: "user",
        kind: "conversation",
        message: event.message,
        timestamp: event.createdAt,
      })
      continue
    }
    if (event.type === "agent.message") {
      history.push({
        role: "assistant",
        kind: "conversation",
        message: event.message,
        timestamp: event.createdAt,
      })
      continue
    }

    const runtimeNote = renderRuntimeNote(event)
    if (runtimeNote) {
      const isInbound =
        event.type === "user.interrupt" ||
        event.type === "user.tool_confirmation" ||
        event.type === "user.custom_tool_result"
      history.push({
        role: isInbound ? "user" : "assistant",
        kind: "runtime_note",
        message: runtimeNote,
        timestamp: event.createdAt,
      })
    }
  }

  return history
}

export function summarizePendingEvent(event: SessionEvent): string {
  switch (event.type) {
    case "user.message":
      return `user.message: ${event.message}`
    case "user.define_outcome":
      return `user.define_outcome: ${event.outcome.title}${event.outcome.detail ? ` — ${event.outcome.detail}` : ""}`
    case "user.interrupt":
      return `user.interrupt${event.note ? `: ${event.note}` : ""}`
    case "span.started":
      return `span.started: ${event.spanKind}/${event.name}${event.summary ? ` (${event.summary})` : ""}`
    case "span.completed":
      return `span.completed: ${event.spanKind}/${event.name} result=${event.result}${event.summary ? ` (${event.summary})` : ""}`
    case "user.tool_confirmation":
      return `user.tool_confirmation: ${event.toolName} request=${event.requestId} allowed=${String(event.allowed)}${event.note ? ` note=${event.note}` : ""}`
    case "user.custom_tool_result":
      return `user.custom_tool_result: ${event.toolName} request=${event.requestId} output=${event.output}`
    case "session.child_created":
      return `session.child_created: ${event.childSessionId}${event.outcomeTitle ? ` (${event.outcomeTitle})` : ""}`
    case "session.child_idle":
      return `session.child_idle: ${event.childSessionId} (${event.childStopReason}) ${event.summary}`
    case "agent.custom_tool_use":
      return `agent.custom_tool_use: ${event.toolName} request=${event.requestId}`
    case "agent.tool_use":
      return `agent.tool_use: ${event.toolName}${event.requestId ? ` request=${event.requestId}` : ""}`
    case "session.status_changed":
      return `session.status_changed: ${event.fromStatus} -> ${event.toStatus} (${event.reason})`
    case "session.status_idle":
      return `session.status_idle: ${event.reason} (${event.summary})${event.blockingEventIds && event.blockingEventIds.length > 0 ? ` [blocking=${event.blockingEventIds.join(",")}]` : ""}`
    case "agent.message":
      return `agent.message: ${event.summary}`
  }
}

export function buildSessionContext(input: {
  events: SessionEvent[]
  sessionId: string
  agentId: string
  systemPrompt: string
  incomingMessage: string
  tokenBudget: number
  supplementalHistory?: AgentHistoryRecord[]
}): BuiltContext {
  const history = [...toHistoryRecords(input.events), ...(input.supplementalHistory ?? [])].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  )
  const available = Math.max(
    1,
    input.tokenBudget - estimateTokens(input.systemPrompt) - estimateTokens(input.incomingMessage),
  )

  const selectedIndexes = new Set<number>()
  let used = 0
  const conversationIndexes = history
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !isRuntimeNoteRecord(record))
    .map(({ index }) => index)
  const continuityIndexes = conversationIndexes.slice(-MIN_CONVERSATION_CONTINUITY_RECORDS)

  for (const index of continuityIndexes) {
    const candidate = history[index]
    if (!candidate) {
      continue
    }
    const cost = estimateTokens(renderRecord(candidate))
    if (used + cost > available) {
      continue
    }
    selectedIndexes.add(index)
    used += cost
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index]
    if (!candidate) {
      continue
    }
    if (selectedIndexes.has(index)) {
      continue
    }
    const cost = estimateTokens(renderRecord(candidate))
    if (used + cost > available) {
      continue
    }
    selectedIndexes.add(index)
    used += cost
  }

  const selected = history.filter((_, index) => selectedIndexes.has(index))
  const selectedConversationCount = selected.filter((record) => !isRuntimeNoteRecord(record)).length
  const selectedRuntimeNoteCount = selected.filter((record) => isRuntimeNoteRecord(record)).length

  return {
    tokenBudget: input.tokenBudget,
    estimatedTokens: used,
    totalHistoryCount: history.length,
    totalConversationCount: conversationIndexes.length,
    totalRuntimeNoteCount: history.length - conversationIndexes.length,
    droppedConversationCount: Math.max(0, conversationIndexes.length - selectedConversationCount),
    droppedRuntimeNoteCount: Math.max(
      0,
      history.length - conversationIndexes.length - selectedRuntimeNoteCount,
    ),
    protectedConversationContinuityCount: continuityIndexes.length,
    selectedHistory: selected,
    conversationHistory: selected.filter((record) => !isRuntimeNoteRecord(record)),
    runtimeNotes: selected.filter((record) => isRuntimeNoteRecord(record)),
    transcript: selected.map(renderRecord).join("\n"),
  }
}
