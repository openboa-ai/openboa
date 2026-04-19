import type { TranscriptRecord } from "./protocol.js"

export interface BuiltContext {
  tokenBudget: number
  estimatedTokens: number
  selectedHistory: TranscriptRecord[]
  conversationHistory: TranscriptRecord[]
  runtimeNotes: TranscriptRecord[]
  transcript: string
}

export function emptyBuiltContext(tokenBudget = 0): BuiltContext {
  return {
    tokenBudget,
    estimatedTokens: 0,
    selectedHistory: [],
    conversationHistory: [],
    runtimeNotes: [],
    transcript: "",
  }
}
