import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"
import type { AgentResolvedLearning } from "../runtime/loop-directive.js"
import {
  DEFAULT_MEMORY_FILENAME,
  seedAgentWorkspaceBootstrapFiles,
  syncAgentWorkspaceRuntimeLearnings,
} from "../workspace/bootstrap-files.js"

export interface AgentLearningRecord {
  kind: "runtime.learning.captured"
  id: string
  agentId: string
  createdAt: string
  sessionId: string
  sourceEventId: string | null
  sourceReason: string
  learning: AgentResolvedLearning
}

function buildLearningSignature(learning: AgentResolvedLearning): string {
  return [learning.kind, learning.title, learning.detail]
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join("::")
}

export class AgentLearningsStore {
  constructor(private readonly companyDir: string) {}

  lessonsPath(agentId: string): string {
    return join(this.companyDir, ".openboa", "agents", agentId, "learn", "lessons.jsonl")
  }

  correctionsPath(agentId: string): string {
    return join(this.companyDir, ".openboa", "agents", agentId, "learn", "corrections.jsonl")
  }

  errorsPath(agentId: string): string {
    return join(this.companyDir, ".openboa", "agents", agentId, "learn", "errors.jsonl")
  }

  workspaceMemoryPath(agentId: string): string {
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "workspace",
      DEFAULT_MEMORY_FILENAME,
    )
  }

  async list(agentId: string): Promise<AgentLearningRecord[]> {
    const [lessons, corrections, errors] = await Promise.all([
      readJsonl<AgentLearningRecord>(this.lessonsPath(agentId)),
      readJsonl<AgentLearningRecord>(this.correctionsPath(agentId)),
      readJsonl<AgentLearningRecord>(this.errorsPath(agentId)),
    ])

    return [...lessons, ...corrections, ...errors].sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    )
  }

  async capture(params: {
    agentId: string
    sessionId: string
    createdAt: string
    sourceEventId?: string | null
    sourceReason: string
    learnings: AgentResolvedLearning[]
  }): Promise<AgentLearningRecord[]> {
    if (params.learnings.length === 0) {
      await this.syncWorkspaceMemory(params.agentId)
      return []
    }

    const existing = await this.list(params.agentId)
    const seen = new Set(
      existing.map(
        (record) => record.learning.dedupeKey ?? buildLearningSignature(record.learning),
      ),
    )

    const captured: AgentLearningRecord[] = []
    for (const learning of params.learnings) {
      const lookupKey = learning.dedupeKey ?? buildLearningSignature(learning)
      if (seen.has(lookupKey)) {
        continue
      }

      const record: AgentLearningRecord = {
        kind: "runtime.learning.captured",
        id: makeUuidV7(),
        agentId: params.agentId,
        createdAt: params.createdAt,
        sessionId: params.sessionId,
        sourceEventId: params.sourceEventId ?? null,
        sourceReason: params.sourceReason,
        learning,
      }
      await appendJsonl(this.pathForKind(params.agentId, learning.kind), record)
      seen.add(lookupKey)
      captured.push(record)
    }

    await this.syncWorkspaceMemory(params.agentId)
    return captured
  }

  async syncWorkspaceMemory(agentId: string): Promise<void> {
    const learnings = await this.list(agentId)
    const promoted = learnings
      .filter((record) => record.learning.promoteToMemory)
      .map((record) => ({
        kind: record.learning.kind,
        title: record.learning.title,
        detail: record.learning.detail,
      }))
    await syncAgentWorkspaceRuntimeLearnings(this.companyDir, agentId, promoted)
  }

  async readWorkspaceMemory(agentId: string): Promise<string> {
    await seedAgentWorkspaceBootstrapFiles(this.companyDir, agentId)
    return readFile(this.workspaceMemoryPath(agentId), "utf8")
  }

  private pathForKind(agentId: string, kind: AgentResolvedLearning["kind"]): string {
    switch (kind) {
      case "correction":
        return this.correctionsPath(agentId)
      case "error":
        return this.errorsPath(agentId)
      default:
        return this.lessonsPath(agentId)
    }
  }
}
