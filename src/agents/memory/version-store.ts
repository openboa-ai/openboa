import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"
import type { RuntimeMemoryWritableTarget, RuntimeMemoryWriteMode } from "./runtime-memory-store.js"

export type ManagedVersionedMemoryTarget = RuntimeMemoryWritableTarget | "workspace_memory_notes"

export interface ManagedMemoryVersionRecord {
  versionId: string
  agentId: string
  sessionId: string | null
  target: ManagedVersionedMemoryTarget
  createdAt: string
  source: "memory_write" | "memory_promote_note"
  mode: RuntimeMemoryWriteMode
  contentHash: string
  sizeBytes: number
  wakeId: string | null
  preview: string
}

function normalizePreview(content: string): string {
  const trimmed = content.replace(/\s+/gu, " ").trim()
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`
}

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export class ManagedMemoryVersionStore {
  constructor(private readonly companyDir: string) {}

  async recordVersion(input: {
    agentId: string
    sessionId: string | null
    target: ManagedVersionedMemoryTarget
    content: string
    createdAt: string
    source: "memory_write" | "memory_promote_note"
    mode: RuntimeMemoryWriteMode
    wakeId?: string | null
  }): Promise<ManagedMemoryVersionRecord> {
    const record: ManagedMemoryVersionRecord = {
      versionId: makeUuidV7(),
      agentId: input.agentId,
      sessionId: input.sessionId,
      target: input.target,
      createdAt: input.createdAt,
      source: input.source,
      mode: input.mode,
      contentHash: computeHash(input.content),
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      wakeId: input.wakeId ?? null,
      preview: normalizePreview(input.content),
    }

    await Promise.all([
      appendJsonl(this.historyPath(input.agentId, input.sessionId, input.target), record),
      this.writeContent(
        input.agentId,
        input.sessionId,
        input.target,
        record.versionId,
        input.content,
      ),
    ])

    return record
  }

  async listVersions(input: {
    agentId: string
    sessionId: string | null
    target: ManagedVersionedMemoryTarget
    limit?: number
  }): Promise<ManagedMemoryVersionRecord[]> {
    const records = await readJsonl<ManagedMemoryVersionRecord>(
      this.historyPath(input.agentId, input.sessionId, input.target),
    )
    const ordered = [...records].reverse()
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
        ? Math.floor(input.limit)
        : ordered.length
    return ordered.slice(0, limit)
  }

  async latestVersion(input: {
    agentId: string
    sessionId: string | null
    target: ManagedVersionedMemoryTarget
  }): Promise<ManagedMemoryVersionRecord | null> {
    const records = await this.listVersions({
      ...input,
      limit: 1,
    })
    return records[0] ?? null
  }

  async readVersion(input: {
    agentId: string
    sessionId: string | null
    target: ManagedVersionedMemoryTarget
    versionId: string
  }): Promise<{ record: ManagedMemoryVersionRecord; content: string } | null> {
    const records = await readJsonl<ManagedMemoryVersionRecord>(
      this.historyPath(input.agentId, input.sessionId, input.target),
    )
    const record = records.find((entry) => entry.versionId === input.versionId)
    if (!record) {
      return null
    }
    try {
      const content = await readFile(
        this.contentPath(input.agentId, input.sessionId, input.target, input.versionId),
        "utf8",
      )
      return { record, content }
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null
      }
      throw error
    }
  }

  private historyPath(
    agentId: string,
    sessionId: string | null,
    target: ManagedVersionedMemoryTarget,
  ): string {
    if (target === "workspace_memory_notes") {
      return join(
        this.companyDir,
        ".openboa",
        "agents",
        agentId,
        "workspace",
        ".openboa-memory-versions",
        `${target}.jsonl`,
      )
    }
    if (!sessionId) {
      throw new Error(`sessionId is required for target=${target}`)
    }
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "sessions",
      sessionId,
      "runtime",
      ".memory-versions",
      `${target}.jsonl`,
    )
  }

  private contentPath(
    agentId: string,
    sessionId: string | null,
    target: ManagedVersionedMemoryTarget,
    versionId: string,
  ): string {
    if (target === "workspace_memory_notes") {
      return join(
        this.companyDir,
        ".openboa",
        "agents",
        agentId,
        "workspace",
        ".openboa-memory-versions",
        target,
        `${versionId}.md`,
      )
    }
    if (!sessionId) {
      throw new Error(`sessionId is required for target=${target}`)
    }
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "sessions",
      sessionId,
      "runtime",
      ".memory-versions",
      target,
      `${versionId}.md`,
    )
  }

  private async writeContent(
    agentId: string,
    sessionId: string | null,
    target: ManagedVersionedMemoryTarget,
    versionId: string,
    content: string,
  ): Promise<void> {
    const filePath = this.contentPath(agentId, sessionId, target, versionId)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, "utf8")
  }
}
