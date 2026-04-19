import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, join, posix as pathPosix, relative, resolve } from "node:path"
import { sandboxLockPathForRoot } from "../sandbox/sandbox.js"
import type { ResourceAttachment, ResourceAttachmentKind, Session } from "../schema/runtime.js"

function normalizeRelativePath(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error("Path must not be empty")
  }
  if (trimmed.startsWith("/")) {
    throw new Error("Path must be relative to the mounted resource")
  }
  const normalized = pathPosix.normalize(trimmed)
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Path ${value} escapes the mounted resource`)
  }
  return normalized
}

function normalizeResourceScopedPath(resourceMountPath: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error("Path must not be empty")
  }

  const normalizedMountPath = pathPosix.normalize(resourceMountPath)
  const normalizedInput = pathPosix.normalize(trimmed)
  if (normalizedInput === normalizedMountPath) {
    return "."
  }
  if (normalizedInput.startsWith(`${normalizedMountPath}/`)) {
    return normalizeRelativePath(normalizedInput.slice(normalizedMountPath.length + 1))
  }
  return normalizeRelativePath(trimmed)
}

function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function computeBufferHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex")
}

const STAGED_SUBSTRATE_MANIFEST_RELATIVE_PATH = ".openboa-runtime/staged-substrate.json"

interface StagedSubstrateManifestEntry {
  sourcePath: string
  sourceContentHash: string
  targetContentHash: string
  stagedAt: string
}

interface StagedSubstrateManifest {
  entries: Record<string, StagedSubstrateManifestEntry>
}

export interface StagedSubstrateDraftStatus {
  sessionPath: string
  substratePath: string
  stagedAt: string
  draftExists: boolean
  substrateExists: boolean
  draftContentHash: string | null
  substrateContentHash: string | null
  sourceChangedSinceStage: boolean
  draftChangedSinceStage: boolean
  status: "ready" | "in_sync" | "draft_missing" | "substrate_missing"
}

export function requireResourceAttachment(
  resources: ResourceAttachment[],
  kind: ResourceAttachmentKind,
): ResourceAttachment {
  const resource = resources.find((candidate) => candidate.kind === kind)
  if (!resource) {
    throw new Error(`Resource ${kind} is not attached to the current session`)
  }
  return resource
}

export function resolveAttachedResourcePath(
  resource: ResourceAttachment,
  relativePath: string,
): {
  relativePath: string
  actualPath: string
} {
  const normalizedPath = normalizeResourceScopedPath(resource.mountPath, relativePath)
  const actualPath = resolve(resource.sourceRef, normalizedPath)
  const relativeToRoot = relative(resolve(resource.sourceRef), actualPath)
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${pathPosix.sep}`) ||
    relativeToRoot.includes(`${pathPosix.sep}..${pathPosix.sep}`)
  ) {
    throw new Error(`Path ${relativePath} escapes resource root ${resource.mountPath}`)
  }
  return {
    relativePath: normalizedPath,
    actualPath,
  }
}

export async function promoteSessionWorkspaceArtifact(input: {
  session: Session
  sourcePath: string
  targetPath?: string | null
  overwrite?: boolean
}): Promise<{
  sourcePath: string
  targetPath: string
  bytes: number
}> {
  const sessionWorkspace = requireResourceAttachment(input.session.resources, "session_workspace")
  const agentSubstrate = requireResourceAttachment(
    input.session.resources,
    "agent_workspace_substrate",
  )

  const source = resolveAttachedResourcePath(sessionWorkspace, input.sourcePath)
  const target = resolveAttachedResourcePath(
    agentSubstrate,
    input.targetPath?.trim() || source.relativePath,
  )
  const sourceStat = await stat(source.actualPath)
  if (!sourceStat.isFile()) {
    throw new Error(`Source path ${input.sourcePath} is not a file`)
  }
  if (!input.overwrite) {
    const existing = await stat(target.actualPath).catch(() => null)
    if (existing) {
      throw new Error(
        `Target ${target.relativePath} already exists in the shared substrate; pass overwrite=true to replace it`,
      )
    }
  }
  await withResourceWriteLease(
    {
      sessionId: input.session.id,
      resource: agentSubstrate,
    },
    async () => {
      await mkdir(dirname(target.actualPath), { recursive: true })
      await copyFile(source.actualPath, target.actualPath)
    },
  )
  await reconcileStagedSubstrateManifestAfterPromotion({
    session: input.session,
    sessionPath: source.relativePath,
    substratePath: target.relativePath,
  })
  return {
    sourcePath: source.relativePath,
    targetPath: target.relativePath,
    bytes: sourceStat.size,
  }
}

export async function stageSubstrateArtifactToSessionWorkspace(input: {
  session: Session
  sourcePath: string
  targetPath?: string | null
  overwrite?: boolean
}): Promise<{
  sourcePath: string
  targetPath: string
  bytes: number
  reusedExisting: boolean
  divergedFromSource: boolean
  sourceContentHash: string
  targetContentHash: string
}> {
  const sessionWorkspace = requireResourceAttachment(input.session.resources, "session_workspace")
  const agentSubstrate = requireResourceAttachment(
    input.session.resources,
    "agent_workspace_substrate",
  )

  const source = resolveAttachedResourcePath(agentSubstrate, input.sourcePath)
  const target = resolveAttachedResourcePath(
    sessionWorkspace,
    input.targetPath?.trim() || source.relativePath,
  )
  const sourceStat = await stat(source.actualPath)
  if (!sourceStat.isFile()) {
    throw new Error(`Source path ${input.sourcePath} is not a file`)
  }
  const sourceContent = await readFile(source.actualPath)
  const sourceContentHash = computeBufferHash(sourceContent)
  let reusedExisting = false
  let divergedFromSource = false
  let targetContentHash = sourceContentHash
  await withResourceWriteLease(
    {
      sessionId: input.session.id,
      resource: sessionWorkspace,
    },
    async () => {
      await mkdir(dirname(target.actualPath), { recursive: true })
      const existing = await stat(target.actualPath).catch(() => null)
      const manifest = await readStagedSubstrateManifest(sessionWorkspace)
      const manifestEntry = manifest.entries[target.relativePath] ?? null
      if (existing && !input.overwrite) {
        if (manifestEntry?.sourcePath !== source.relativePath) {
          throw new Error(
            `Target ${target.relativePath} already exists in the session workspace; pass overwrite=true to replace it`,
          )
        }
        reusedExisting = true
        targetContentHash = computeBufferHash(await readFile(target.actualPath))
        divergedFromSource = targetContentHash !== sourceContentHash
      } else {
        await copyFile(source.actualPath, target.actualPath)
      }
      if (!reusedExisting) {
        targetContentHash = sourceContentHash
      }
      manifest.entries[target.relativePath] = {
        sourcePath: source.relativePath,
        sourceContentHash,
        targetContentHash,
        stagedAt: new Date().toISOString(),
      }
      await writeStagedSubstrateManifest(sessionWorkspace, manifest)
    },
  )
  return {
    sourcePath: source.relativePath,
    targetPath: target.relativePath,
    bytes: sourceStat.size,
    reusedExisting,
    divergedFromSource,
    sourceContentHash,
    targetContentHash,
  }
}

export async function compareSessionWorkspaceArtifactToSubstrate(input: {
  session: Session
  sessionPath: string
  substratePath?: string | null
  maxPreviewLines?: number
}): Promise<{
  sessionPath: string
  substratePath: string
  substrateExists: boolean
  identical: boolean
  sessionCharCount: number
  substrateCharCount: number
  sessionContentHash: string
  substrateContentHash: string | null
  differingLineCount: number
  preview: Array<{
    line: number
    session: string
    substrate: string
  }>
}> {
  const sessionWorkspace = requireResourceAttachment(input.session.resources, "session_workspace")
  const agentSubstrate = requireResourceAttachment(
    input.session.resources,
    "agent_workspace_substrate",
  )
  const sessionFile = resolveAttachedResourcePath(sessionWorkspace, input.sessionPath)
  const substrateFile = resolveAttachedResourcePath(
    agentSubstrate,
    input.substratePath?.trim() || sessionFile.relativePath,
  )
  const sessionText = await readFile(sessionFile.actualPath, "utf8")
  const substrateText = await readFile(substrateFile.actualPath, "utf8").catch(() => null)
  const sessionLines = sessionText.split("\n")
  const substrateLines = substrateText?.split("\n") ?? []
  const differingLineCount = countDifferingLines(sessionLines, substrateLines)
  return {
    sessionPath: sessionFile.relativePath,
    substratePath: substrateFile.relativePath,
    substrateExists: substrateText !== null,
    identical: substrateText !== null && sessionText === substrateText,
    sessionCharCount: sessionText.length,
    substrateCharCount: substrateText?.length ?? 0,
    sessionContentHash: computeContentHash(sessionText),
    substrateContentHash: substrateText !== null ? computeContentHash(substrateText) : null,
    differingLineCount,
    preview: buildDiffPreview(
      sessionLines,
      substrateLines,
      typeof input.maxPreviewLines === "number" && input.maxPreviewLines > 0
        ? Math.floor(input.maxPreviewLines)
        : 12,
    ),
  }
}

export async function listStagedSubstrateDrafts(input: {
  session: Session
}): Promise<StagedSubstrateDraftStatus[]> {
  const sessionWorkspace = requireResourceAttachment(input.session.resources, "session_workspace")
  const agentSubstrate = requireResourceAttachment(
    input.session.resources,
    "agent_workspace_substrate",
  )
  const manifest = await readStagedSubstrateManifest(sessionWorkspace)
  const entries = Object.entries(manifest.entries)
  const results = await Promise.all(
    entries.map(async ([sessionPath, entry]): Promise<StagedSubstrateDraftStatus> => {
      const sessionFile = resolveAttachedResourcePath(sessionWorkspace, sessionPath)
      const substrateFile = resolveAttachedResourcePath(agentSubstrate, entry.sourcePath)
      const draftContent = await readFile(sessionFile.actualPath).catch(() => null)
      const substrateContent = await readFile(substrateFile.actualPath).catch(() => null)
      const draftContentHash = draftContent ? computeBufferHash(draftContent) : null
      const substrateContentHash = substrateContent ? computeBufferHash(substrateContent) : null
      return {
        sessionPath,
        substratePath: entry.sourcePath,
        stagedAt: entry.stagedAt,
        draftExists: draftContent !== null,
        substrateExists: substrateContent !== null,
        draftContentHash,
        substrateContentHash,
        sourceChangedSinceStage:
          substrateContentHash !== null && substrateContentHash !== entry.sourceContentHash,
        draftChangedSinceStage:
          draftContentHash !== null && draftContentHash !== entry.targetContentHash,
        status:
          draftContentHash === null
            ? "draft_missing"
            : substrateContentHash === null
              ? "substrate_missing"
              : draftContentHash === substrateContentHash
                ? "in_sync"
                : "ready",
      }
    }),
  )
  return results.sort((left, right) => left.sessionPath.localeCompare(right.sessionPath))
}

export async function restoreSessionWorkspaceArtifactVersion(input: {
  session: Session
  targetPath: string
  content: string
  overwrite?: boolean
}): Promise<{
  targetPath: string
  bytes: number
}> {
  const agentSubstrate = requireResourceAttachment(
    input.session.resources,
    "agent_workspace_substrate",
  )
  const target = resolveAttachedResourcePath(agentSubstrate, input.targetPath)
  if (!input.overwrite) {
    const existing = await stat(target.actualPath).catch(() => null)
    if (existing) {
      throw new Error(
        `Target ${target.relativePath} already exists in the shared substrate; pass overwrite=true to replace it`,
      )
    }
  }
  await withResourceWriteLease(
    {
      sessionId: input.session.id,
      resource: agentSubstrate,
    },
    async () => {
      await mkdir(dirname(target.actualPath), { recursive: true })
      await writeFile(target.actualPath, input.content, "utf8")
    },
  )
  return {
    targetPath: target.relativePath,
    bytes: Buffer.byteLength(input.content, "utf8"),
  }
}

async function withResourceWriteLease<T>(
  input: {
    sessionId: string
    resource: ResourceAttachment
  },
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = sandboxLockPathForRoot(resolve(input.resource.sourceRef))
  await mkdir(dirname(lockPath), { recursive: true })
  try {
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          sessionId: input.sessionId,
          resourceId: input.resource.id,
          mountPath: input.resource.mountPath,
          sourceRef: resolve(input.resource.sourceRef),
        },
        null,
        2,
      ),
      { encoding: "utf8", flag: "wx" },
    )
  } catch {
    throw new Error(`Shared substrate ${input.resource.mountPath} is currently busy`)
  }
  try {
    return await operation()
  } finally {
    await unlink(lockPath).catch(() => {})
  }
}

function countDifferingLines(left: string[], right: string[]): number {
  let count = 0
  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength; index += 1) {
    if ((left[index] ?? "") !== (right[index] ?? "")) {
      count += 1
    }
  }
  return count
}

async function readStagedSubstrateManifest(
  sessionWorkspace: ResourceAttachment,
): Promise<StagedSubstrateManifest> {
  const manifestPath = join(
    resolve(sessionWorkspace.sourceRef),
    STAGED_SUBSTRATE_MANIFEST_RELATIVE_PATH,
  )
  const raw = await readFile(manifestPath, "utf8").catch(() => null)
  if (!raw) {
    return { entries: {} }
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, StagedSubstrateManifestEntry> }
    return {
      entries:
        parsed.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)
          ? parsed.entries
          : {},
    }
  } catch {
    return { entries: {} }
  }
}

async function writeStagedSubstrateManifest(
  sessionWorkspace: ResourceAttachment,
  manifest: StagedSubstrateManifest,
): Promise<void> {
  const manifestPath = join(
    resolve(sessionWorkspace.sourceRef),
    STAGED_SUBSTRATE_MANIFEST_RELATIVE_PATH,
  )
  await mkdir(dirname(manifestPath), { recursive: true })
  const tempPath = join(dirname(manifestPath), `staged-substrate.${Date.now()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  await rename(tempPath, manifestPath)
}

async function reconcileStagedSubstrateManifestAfterPromotion(input: {
  session: Session
  sessionPath: string
  substratePath: string
}): Promise<void> {
  const sessionWorkspace = requireResourceAttachment(input.session.resources, "session_workspace")
  await withResourceWriteLease(
    {
      sessionId: input.session.id,
      resource: sessionWorkspace,
    },
    async () => {
      const manifest = await readStagedSubstrateManifest(sessionWorkspace)
      const entry = manifest.entries[input.sessionPath]
      if (!entry || entry.sourcePath !== input.substratePath) {
        return
      }
      const sessionFile = resolveAttachedResourcePath(sessionWorkspace, input.sessionPath)
      const draftContent = await readFile(sessionFile.actualPath).catch(() => null)
      if (!draftContent) {
        delete manifest.entries[input.sessionPath]
        await writeStagedSubstrateManifest(sessionWorkspace, manifest)
        return
      }
      const contentHash = computeBufferHash(draftContent)
      manifest.entries[input.sessionPath] = {
        sourcePath: input.substratePath,
        sourceContentHash: contentHash,
        targetContentHash: contentHash,
        stagedAt: new Date().toISOString(),
      }
      await writeStagedSubstrateManifest(sessionWorkspace, manifest)
    },
  )
}

function buildDiffPreview(left: string[], right: string[], maxPreviewLines: number) {
  const preview: Array<{ line: number; session: string; substrate: string }> = []
  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength && preview.length < maxPreviewLines; index += 1) {
    const sessionLine = left[index] ?? ""
    const substrateLine = right[index] ?? ""
    if (sessionLine === substrateLine) {
      continue
    }
    preview.push({
      line: index + 1,
      session: sessionLine,
      substrate: substrateLine,
    })
  }
  return preview
}
