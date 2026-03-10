import { join } from "node:path"

import { appendJsonl, readJsonl } from "./jsonl.js"

export interface ChatRecord {
  type: "inbound" | "outbound"
  chatId: string
  sessionId: string
  agentId: string
  sender: {
    kind: "human" | "agent"
    id: string
  }
  recipient: {
    kind: "human" | "agent"
    id: string
  }
  message: string
  timestamp: string
}

export class ChatStore {
  constructor(private readonly workspaceDir: string) {}

  filePath(chatId: string): string {
    return join(this.workspaceDir, ".openboa", "chat", "chats", `${chatId}.jsonl`)
  }

  async append(record: ChatRecord): Promise<void> {
    await appendJsonl(this.filePath(record.chatId), record)
  }

  async list(chatId: string): Promise<ChatRecord[]> {
    return readJsonl<ChatRecord>(this.filePath(chatId))
  }
}
