import { join } from "node:path"

import { appendJsonl, readJsonl } from "./jsonl.js"

export interface SessionCheckpoint {
  checkpointId: string
  previousCheckpointId: string | null
  createdAt: string
}

export interface SessionRecord {
  kind: "turn.completed"
  chatId: string
  sessionId: string
  agentId: string
  requestMessage: string
  responseMessage: string
  authMode: "none" | "codex-env" | "codex-oauth"
  checkpoint: SessionCheckpoint
}

export class SessionStore {
  constructor(private readonly workspaceDir: string) {}

  filePath(agentId: string, sessionId: string): string {
    return join(this.workspaceDir, ".openboa", "agents", agentId, "sessions", `${sessionId}.jsonl`)
  }

  async append(record: SessionRecord): Promise<void> {
    await appendJsonl(this.filePath(record.agentId, record.sessionId), record)
  }

  async list(agentId: string, sessionId: string): Promise<SessionRecord[]> {
    return readJsonl<SessionRecord>(this.filePath(agentId, sessionId))
  }

  async latestCheckpoint(agentId: string, sessionId: string): Promise<SessionCheckpoint | null> {
    const all = await this.list(agentId, sessionId)
    if (all.length === 0) {
      return null
    }

    return all[all.length - 1].checkpoint
  }
}
