import type { ChatRecord } from "./storage/chat-store.js"

export interface BuiltContext {
  tokenBudget: number
  estimatedTokens: number
  selectedHistory: ChatRecord[]
  transcript: string
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function renderRecord(record: ChatRecord): string {
  return `${record.sender.kind}:${record.sender.id} -> ${record.recipient.kind}:${record.recipient.id}: ${record.message}`
}

export function buildContext(
  history: ChatRecord[],
  systemPrompt: string,
  incomingMessage: string,
  tokenBudget: number,
): BuiltContext {
  const available = Math.max(
    1,
    tokenBudget - estimateTokens(systemPrompt) - estimateTokens(incomingMessage),
  )

  const selected: ChatRecord[] = []
  let used = 0

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index]
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
    transcript: selected.map(renderRecord).join("\n"),
  }
}
