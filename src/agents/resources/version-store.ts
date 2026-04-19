import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"

export interface SubstrateArtifactVersionRecord {
  versionId: string
  agentId: string
  sessionId: string
  sourcePath: string
  targetPath: string
  createdAt: string
  contentHash: string
  sizeBytes: number
  wakeId: string | null
  preview: string
}

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function normalizePreview(content: string): string {
  const trimmed = content.replace(/\s+/gu, " ").trim()
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`
}

export class SubstrateArtifactVersionStore {
  constructor(private readonly companyDir: string) {}

  async recordPromotion(input: {
    agentId: string
    sessionId: string
    sourcePath: string
    targetPath: string
    content: string
    createdAt: string
    wakeId?: string | null
  }): Promise<SubstrateArtifactVersionRecord> {
    const record: SubstrateArtifactVersionRecord = {
      versionId: makeUuidV7(),
      agentId: input.agentId,
      sessionId: input.sessionId,
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      createdAt: input.createdAt,
      contentHash: computeHash(input.content),
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      wakeId: input.wakeId ?? null,
      preview: normalizePreview(input.content),
    }
    await Promise.all([
      appendJsonl(this.historyPath(input.agentId), record),
      this.writeContent(input.agentId, record.versionId, input.content),
    ])
    return record
  }

  async listVersions(input: {
    agentId: string
    targetPath: string
    limit?: number
  }): Promise<SubstrateArtifactVersionRecord[]> {
    const all = await readJsonl<SubstrateArtifactVersionRecord>(this.historyPath(input.agentId))
    const filtered = all.filter((record) => record.targetPath === input.targetPath).reverse()
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
        ? Math.floor(input.limit)
        : filtered.length
    return filtered.slice(0, limit)
  }

  async latestVersion(input: {
    agentId: string
    targetPath: string
  }): Promise<SubstrateArtifactVersionRecord | null> {
    const listed = await this.listVersions({
      ...input,
      limit: 1,
    })
    return listed[0] ?? null
  }

  async readVersion(input: {
    agentId: string
    versionId: string
  }): Promise<{ record: SubstrateArtifactVersionRecord; content: string } | null> {
    const all = await readJsonl<SubstrateArtifactVersionRecord>(this.historyPath(input.agentId))
    const record = all.find((entry) => entry.versionId === input.versionId)
    if (!record) {
      return null
    }
    try {
      const content = await readFile(this.contentPath(input.agentId, input.versionId), "utf8")
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

  private historyPath(agentId: string): string {
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "workspace",
      ".openboa-substrate-versions",
      "history.jsonl",
    )
  }

  private contentPath(agentId: string, versionId: string): string {
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "workspace",
      ".openboa-substrate-versions",
      "content",
      `${versionId}.md`,
    )
  }

  private async writeContent(agentId: string, versionId: string, content: string): Promise<void> {
    const path = this.contentPath(agentId, versionId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, "utf8")
  }
}
