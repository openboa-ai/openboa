export type AgentHistoryRole = "user" | "assistant"
export type AgentHistoryKind = "conversation" | "runtime_note"

export interface AgentHistoryRecord {
  role: AgentHistoryRole
  kind: AgentHistoryKind
  message: string
  timestamp: string
}

export interface BuiltContext {
  tokenBudget: number
  estimatedTokens: number
  totalHistoryCount: number
  totalConversationCount: number
  totalRuntimeNoteCount: number
  droppedConversationCount: number
  droppedRuntimeNoteCount: number
  protectedConversationContinuityCount: number
  selectedHistory: AgentHistoryRecord[]
  conversationHistory: AgentHistoryRecord[]
  runtimeNotes: AgentHistoryRecord[]
  transcript: string
}

export function emptyBuiltContext(tokenBudget = 0): BuiltContext {
  return {
    tokenBudget,
    estimatedTokens: 0,
    totalHistoryCount: 0,
    totalConversationCount: 0,
    totalRuntimeNoteCount: 0,
    droppedConversationCount: 0,
    droppedRuntimeNoteCount: 0,
    protectedConversationContinuityCount: 0,
    selectedHistory: [],
    conversationHistory: [],
    runtimeNotes: [],
    transcript: "",
  }
}
