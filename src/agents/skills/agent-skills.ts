import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { buildRetrievalQuery, scoreRetrievalText } from "../retrieval/query.js"

export interface SkillEntry {
  name: string
  description: string
  preview: string | null
  filePath: string
  baseDir: string
  source: string
}

export interface SkillSearchHit {
  name: string
  description: string
  preview: string | null
  source: string
  filePath: string
  baseDir: string
  score: number
  reasons: string[]
}

export interface SkillReadResult {
  name: string
  description: string
  preview: string | null
  source: string
  filePath: string
  baseDir: string
  content: string
  truncated: boolean
}

export interface AgentSkillsConfig {
  enabled?: boolean
  directories?: string[]
  include?: string[]
  maxPromptEntries?: number
}

interface SkillDirSpec {
  dir: string
  source: string
}

function defaultSkillDirs(companyDir: string, env: NodeJS.ProcessEnv): SkillDirSpec[] {
  const codexHome = env.CODEX_HOME?.trim()
  const dirs: SkillDirSpec[] = []
  if (codexHome) {
    dirs.push({
      dir: join(codexHome, "skills"),
      source: "codex-home",
    })
  }
  dirs.push({
    dir: join(companyDir, ".agents", "skills"),
    source: "company-agents",
  })
  dirs.push({
    dir: join(companyDir, ".openboa", "skills"),
    source: "company-openboa",
  })
  return dirs
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  let entries: Dirent[]
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[]
  } catch {
    return files
  }

  for (const entry of entries) {
    const nextPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findSkillFiles(nextPath)
      files.push(...nested)
      continue
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(nextPath)
    }
  }

  return files
}

function extractSkillField(raw: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "mi").exec(raw)
  return match?.[1]?.trim()
}

function extractSkillPreview(raw: string): string | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const previewLines = lines.filter(
    (line) =>
      !line.startsWith("---") && !line.startsWith("name:") && !line.startsWith("description:"),
  )
  if (previewLines.length === 0) {
    return null
  }
  const preview = previewLines.slice(0, 3).join(" ").replace(/\s+/gu, " ").trim()
  return preview.length > 220 ? `${preview.slice(0, 217)}...` : preview
}

async function loadSkillEntry(filePath: string, source: string): Promise<SkillEntry | null> {
  const raw = await readFile(filePath, "utf8")
  const name = extractSkillField(raw, "name") ?? filePath.split("/").slice(-2, -1)[0]
  const description =
    extractSkillField(raw, "description") ??
    raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("---") && !line.startsWith("#")) ??
    "No description provided."

  if (!name.trim()) {
    return null
  }

  return {
    name: name.trim(),
    description: description.trim(),
    preview: extractSkillPreview(raw),
    filePath,
    baseDir: filePath.replace(/\/SKILL\.md$/, ""),
    source,
  }
}

export async function loadCompanySkillEntries(
  companyDir: string,
  config?: AgentSkillsConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SkillEntry[]> {
  if (config?.enabled === false) {
    return []
  }

  const requestedDirs = Array.isArray(config?.directories)
    ? config.directories
        .map((dir) => dir.trim())
        .filter((dir) => dir.length > 0)
        .map((dir) => ({ dir, source: "agent-config" }))
    : defaultSkillDirs(companyDir, env)

  const loaded = new Map<string, SkillEntry>()
  for (const spec of requestedDirs) {
    const files = await findSkillFiles(spec.dir)
    for (const filePath of files) {
      const entry = await loadSkillEntry(filePath, spec.source)
      if (!entry) {
        continue
      }
      loaded.set(entry.name, entry)
    }
  }

  const entries = Array.from(loaded.values()).sort((a, b) => a.name.localeCompare(b.name))
  const include = Array.isArray(config?.include)
    ? config.include.map((entry) => entry.trim()).filter(Boolean)
    : undefined
  if (include === undefined) {
    return entries
  }
  if (include.length === 0) {
    return []
  }
  const allow = new Set(include)
  return entries.filter((entry) => allow.has(entry.name))
}

export async function resolveSkillsPromptForRun(
  companyDir: string,
  config?: AgentSkillsConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const entries = await loadCompanySkillEntries(companyDir, config, env)
  if (entries.length === 0) {
    return ""
  }

  const maxEntries = Math.max(1, config?.maxPromptEntries ?? 8)
  const selected = entries.slice(0, maxEntries)
  const lines = selected.map((entry) => `- ${entry.name}: ${entry.description}`)
  return ["Available skills:", ...lines].join("\n")
}

export function searchSkillEntries(
  entries: SkillEntry[],
  value: string,
  limit = 8,
): SkillSearchHit[] {
  const query = buildRetrievalQuery(value)
  if (!query) {
    return []
  }

  return entries
    .map((entry) => {
      const combined = `${entry.name}\n${entry.description}\n${entry.source}`
      const match = scoreRetrievalText(combined, query)
      if (match.score <= 0) {
        return null
      }
      return {
        name: entry.name,
        description: entry.description,
        preview: entry.preview,
        source: entry.source,
        filePath: entry.filePath,
        baseDir: entry.baseDir,
        score: match.score,
        reasons: match.reasons,
      } satisfies SkillSearchHit
    })
    .filter((entry): entry is SkillSearchHit => entry !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.name.localeCompare(right.name)
    })
    .slice(0, limit)
}

export function findSkillEntryByName(entries: SkillEntry[], name: string): SkillEntry | null {
  const normalized = name.trim()
  if (!normalized) {
    return null
  }
  return entries.find((entry) => entry.name === normalized) ?? null
}

export async function readSkillEntry(
  entry: SkillEntry,
  options?: {
    maxChars?: number
  },
): Promise<SkillReadResult> {
  const raw = await readFile(entry.filePath, "utf8")
  const maxChars =
    typeof options?.maxChars === "number" &&
    Number.isFinite(options.maxChars) &&
    options.maxChars > 0
      ? Math.floor(options.maxChars)
      : 24_000
  const truncated = raw.length > maxChars
  return {
    name: entry.name,
    description: entry.description,
    preview: entry.preview,
    source: entry.source,
    filePath: entry.filePath,
    baseDir: entry.baseDir,
    content: truncated ? raw.slice(0, maxChars) : raw,
    truncated,
  }
}
