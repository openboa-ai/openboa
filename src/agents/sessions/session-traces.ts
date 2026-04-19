import type { SessionEvent } from "../schema/runtime.js"

export interface SessionTraceSummary {
  wakeId: string
  startedAt: string
  updatedAt: string
  eventCount: number
  eventTypes: string[]
  latestSummary: string | null
}

function compareIsoDescending(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left)
}

function summarizeTrace(events: SessionEvent[]): string | null {
  const latestIdle = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "session.status_idle" }> =>
        event.type === "session.status_idle",
    )
  if (latestIdle?.summary) {
    return latestIdle.summary
  }
  const latestAgentMessage = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "agent.message" }> =>
        event.type === "agent.message",
    )
  if (latestAgentMessage?.summary) {
    return latestAgentMessage.summary
  }
  const latestSpanCompletion = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "span.completed" }> =>
        event.type === "span.completed" && event.spanKind === "wake",
    )
  if (latestSpanCompletion?.summary) {
    return latestSpanCompletion.summary
  }
  const latestToolUse = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "agent.tool_use" }> =>
        event.type === "agent.tool_use",
    )
  if (latestToolUse?.toolName) {
    return `tool:${latestToolUse.toolName}`
  }
  const latestToolSpan = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "span.completed" | "span.started" }> =>
        (event.type === "span.completed" || event.type === "span.started") &&
        event.spanKind === "tool",
    )
  if (latestToolSpan?.name) {
    return latestToolSpan.type === "span.completed"
      ? `tool:${latestToolSpan.name}:${latestToolSpan.result}`
      : `tool:${latestToolSpan.name}:running`
  }
  const latestStatusChange = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "session.status_changed" }> =>
        event.type === "session.status_changed",
    )
  return latestStatusChange
    ? `${latestStatusChange.fromStatus}->${latestStatusChange.toStatus}`
    : null
}

export function summarizeSessionTraces(
  events: SessionEvent[],
  limit?: number,
): SessionTraceSummary[] {
  const grouped = new Map<string, SessionEvent[]>()

  for (const event of events) {
    if (!event.wakeId || event.wakeId.trim().length === 0) {
      continue
    }
    const existing = grouped.get(event.wakeId) ?? []
    existing.push(event)
    grouped.set(event.wakeId, existing)
  }

  const traces = [...grouped.entries()]
    .map(([wakeId, traceEvents]) => {
      const ordered = [...traceEvents].sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      )
      return {
        wakeId,
        startedAt: ordered[0]?.createdAt ?? "",
        updatedAt: ordered.at(-1)?.createdAt ?? "",
        eventCount: ordered.length,
        eventTypes: [...new Set(ordered.map((event) => event.type))],
        latestSummary: summarizeTrace(ordered),
      } satisfies SessionTraceSummary
    })
    .sort((left, right) => compareIsoDescending(left.updatedAt, right.updatedAt))

  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return traces.slice(0, Math.floor(limit))
  }
  return traces
}
