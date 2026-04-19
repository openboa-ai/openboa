import type { BuiltContext } from "../../context.js"
import type { TranscriptRecord } from "../../transcript.js"

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function renderRecord(record: TranscriptRecord): string {
  const speakerRole = record.speakerRole ?? (record.sender.kind === "system" ? "system" : "user")
  return `${speakerRole}:${record.sender.kind}: ${record.message}`
}

export function buildContext(
  history: TranscriptRecord[],
  systemPrompt: string,
  incomingMessage: string,
  tokenBudget: number,
): BuiltContext {
  const available = Math.max(
    1,
    tokenBudget - estimateTokens(systemPrompt) - estimateTokens(incomingMessage),
  )

  const selected: TranscriptRecord[] = []
  let used = 0

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index]
    if (!candidate) {
      continue
    }
    const cost = estimateTokens(renderRecord(candidate))
    if (used + cost > available) {
      continue
    }

    selected.unshift(candidate)
    used += cost
  }

  return {
    tokenBudget,
    estimatedTokens: used,
    selectedHistory: selected,
    conversationHistory: selected,
    runtimeNotes: [],
    transcript: selected.map(renderRecord).join("\n"),
  }
}
