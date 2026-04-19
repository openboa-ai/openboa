import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const DEFAULT_AGENTS_FILENAME = "AGENTS.md"
export const DEFAULT_SOUL_FILENAME = "SOUL.md"
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md"
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md"
export const DEFAULT_USER_FILENAME = "USER.md"
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md"
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md"
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md"
export const DEFAULT_MEMORY_ALT_FILENAME = "memory.md"
export const MEMORY_NOTES_SECTION_START = "<!-- OPENBOA_MEMORY_NOTES:START -->"
export const MEMORY_NOTES_SECTION_END = "<!-- OPENBOA_MEMORY_NOTES:END -->"
export const RUNTIME_LEARNINGS_SECTION_START = "<!-- OPENBOA_RUNTIME_LEARNINGS:START -->"
export const RUNTIME_LEARNINGS_SECTION_END = "<!-- OPENBOA_RUNTIME_LEARNINGS:END -->"

export const DEFAULT_WORKSPACE_BOOTSTRAP_FILES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
] as const

export type WorkspaceBootstrapFileName = (typeof DEFAULT_WORKSPACE_BOOTSTRAP_FILES)[number]

export interface WorkspaceBootstrapEntry {
  name: string
  content: string
}

type WorkspaceBootstrapSectionEntry = readonly [WorkspaceBootstrapFileName, string | null]

export interface WorkspaceRuntimeLearningEntry {
  kind: "lesson" | "correction" | "error"
  title: string
  detail: string
}

export type WorkspaceMemoryWriteMode = "replace" | "append"

function normalizeTemplate(text: string): string {
  return `${text.trim()}\n`
}

function templateContent(name: WorkspaceBootstrapFileName, agentId: string): string {
  switch (name) {
    case DEFAULT_AGENTS_FILENAME:
      return normalizeTemplate(`
# AGENTS.md

You are ${agentId}, an openboa agent.

- Treat this workspace as private operating context.
- Prefer one bounded action at a time.
- Promote business-relevant results through higher layers instead of hiding them in scratch notes.
- Keep runtime continuity high signal.
`)
    case DEFAULT_SOUL_FILENAME:
      return normalizeTemplate(`
# SOUL.md

- Calm
- Reliable
- Bounded
- Honest about uncertainty
- Quiet when no useful action is justified
`)
    case DEFAULT_TOOLS_FILENAME:
      return normalizeTemplate(`
# TOOLS.md

- Use only the tools that are currently available in runtime.
- Prefer the narrowest tool that solves the current bounded move.
- Do not assume tool side effects succeeded unless the result confirms them.
`)
    case DEFAULT_IDENTITY_FILENAME:
      return normalizeTemplate(`
# IDENTITY.md

- Agent id: \`${agentId}\`
- Runtime role: openboa worker
- Default mode: bounded, self-directed execution
`)
    case DEFAULT_USER_FILENAME:
      return normalizeTemplate(`
# USER.md

The primary operator is the openboa builder working in this repository.

- Be concise.
- Preserve repo intent.
- Escalate only when a decision has real product or safety consequences.
`)
    case DEFAULT_HEARTBEAT_FILENAME:
      return normalizeTemplate(`
# HEARTBEAT.md

For session wakes and orchestrator-driven revisits:

1. Read the pending session events carefully.
2. Read current runtime continuity before acting.
3. Choose one bounded move or let the session go idle.
4. If later revisit is needed, request a queued wake explicitly.
`)
    case DEFAULT_BOOTSTRAP_FILENAME:
      return normalizeTemplate(`
# BOOTSTRAP.md

This workspace was seeded automatically.

- Personalize these files if this agent needs a stronger identity.
- Keep durable guidance in markdown files, not only in chat history.
- Delete or shrink this file once the workspace bootstrap is no longer needed.
`)
    case DEFAULT_MEMORY_FILENAME:
      return normalizeTemplate(`
# MEMORY.md

Curated long-term memory for ${agentId}.

- Durable preferences
- Stable constraints
- Reusable lessons worth keeping across sessions

## Promoted Runtime Learnings
${RUNTIME_LEARNINGS_SECTION_START}
_No promoted runtime learnings yet._
${RUNTIME_LEARNINGS_SECTION_END}

## Managed Memory Notes
${MEMORY_NOTES_SECTION_START}
_No managed memory notes yet._
${MEMORY_NOTES_SECTION_END}
`)
  }
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, {
      encoding: "utf8",
      flag: "wx",
    })
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error
    }
  }
}

async function maybeReadText(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, "utf8")
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export function resolveAgentWorkspaceDir(companyDir: string, agentId: string): string {
  return join(companyDir, ".openboa", "agents", agentId, "workspace")
}

async function ensureSeededAgentWorkspaceDir(companyDir: string, agentId: string): Promise<string> {
  await seedAgentWorkspaceBootstrapFiles(companyDir, agentId)
  return resolveAgentWorkspaceDir(companyDir, agentId)
}

export async function seedAgentWorkspaceBootstrapFiles(
  companyDir: string,
  agentId: string,
): Promise<void> {
  const workspaceDir = resolveAgentWorkspaceDir(companyDir, agentId)
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(join(workspaceDir, "memory"), { recursive: true })

  for (const fileName of DEFAULT_WORKSPACE_BOOTSTRAP_FILES) {
    await writeFileIfMissing(join(workspaceDir, fileName), templateContent(fileName, agentId))
  }
}

export async function loadAgentWorkspaceBootstrapSections(
  companyDir: string,
  agentId: string,
): Promise<string[]> {
  const entries = await loadAgentWorkspaceBootstrapEntries(companyDir, agentId)
  return entries.map((entry) => `## ${entry.name}\n\n${entry.content}`)
}

export async function loadAgentWorkspaceBootstrapEntries(
  companyDir: string,
  agentId: string,
): Promise<WorkspaceBootstrapEntry[]> {
  const workspaceDir = await ensureSeededAgentWorkspaceDir(companyDir, agentId)
  const memory =
    (await maybeReadText(join(workspaceDir, DEFAULT_MEMORY_FILENAME))) ??
    (await maybeReadText(join(workspaceDir, DEFAULT_MEMORY_ALT_FILENAME)))

  const fileContents = await Promise.all([
    maybeReadText(join(workspaceDir, DEFAULT_AGENTS_FILENAME)),
    maybeReadText(join(workspaceDir, DEFAULT_SOUL_FILENAME)),
    maybeReadText(join(workspaceDir, DEFAULT_TOOLS_FILENAME)),
    maybeReadText(join(workspaceDir, DEFAULT_IDENTITY_FILENAME)),
    maybeReadText(join(workspaceDir, DEFAULT_USER_FILENAME)),
    maybeReadText(join(workspaceDir, DEFAULT_HEARTBEAT_FILENAME)),
    maybeReadText(join(workspaceDir, DEFAULT_BOOTSTRAP_FILENAME)),
  ])

  const sections: WorkspaceBootstrapSectionEntry[] = [
    [DEFAULT_AGENTS_FILENAME, fileContents[0]],
    [DEFAULT_SOUL_FILENAME, fileContents[1]],
    [DEFAULT_TOOLS_FILENAME, fileContents[2]],
    [DEFAULT_IDENTITY_FILENAME, fileContents[3]],
    [DEFAULT_USER_FILENAME, fileContents[4]],
    [DEFAULT_HEARTBEAT_FILENAME, fileContents[5]],
    [DEFAULT_BOOTSTRAP_FILENAME, fileContents[6]],
    [DEFAULT_MEMORY_FILENAME, memory],
  ] as const

  return sections
    .filter(
      (entry): entry is readonly [WorkspaceBootstrapFileName, string] =>
        typeof entry[1] === "string",
    )
    .map(([name, content]) => ({
      name,
      content,
    }))
}

function renderRuntimeLearningsSection(entries: WorkspaceRuntimeLearningEntry[]): string {
  if (entries.length === 0) {
    return [
      RUNTIME_LEARNINGS_SECTION_START,
      "_No promoted runtime learnings yet._",
      RUNTIME_LEARNINGS_SECTION_END,
    ].join("\n")
  }

  return [
    RUNTIME_LEARNINGS_SECTION_START,
    ...entries.map((entry) => `- [${entry.kind}] ${entry.title}\n  - ${entry.detail}`),
    RUNTIME_LEARNINGS_SECTION_END,
  ].join("\n")
}

function renderManagedMemoryNotesSection(content: string | null): string {
  const normalized = content?.trim()
  return [
    MEMORY_NOTES_SECTION_START,
    normalized && normalized.length > 0 ? normalized : "_No managed memory notes yet._",
    MEMORY_NOTES_SECTION_END,
  ].join("\n")
}

function upsertDelimitedSection(params: {
  current: string
  sectionStart: string
  sectionEnd: string
  heading: string
  renderedSection: string
}): string {
  if (params.current.includes(params.sectionStart) && params.current.includes(params.sectionEnd)) {
    const pattern = new RegExp(`${params.sectionStart}[\\s\\S]*?${params.sectionEnd}`, "u")
    return params.current.replace(pattern, params.renderedSection)
  }
  return [params.current.trimEnd(), "", params.heading, params.renderedSection].join("\n")
}

export async function syncAgentWorkspaceRuntimeLearnings(
  companyDir: string,
  agentId: string,
  entries: WorkspaceRuntimeLearningEntry[],
): Promise<void> {
  const workspaceDir = await ensureSeededAgentWorkspaceDir(companyDir, agentId)
  const memoryPath = join(workspaceDir, DEFAULT_MEMORY_FILENAME)
  const current =
    (await maybeReadText(memoryPath)) ?? templateContent(DEFAULT_MEMORY_FILENAME, agentId).trim()
  const renderedSection = renderRuntimeLearningsSection(entries)

  const nextContent = upsertDelimitedSection({
    current,
    sectionStart: RUNTIME_LEARNINGS_SECTION_START,
    sectionEnd: RUNTIME_LEARNINGS_SECTION_END,
    heading: "## Promoted Runtime Learnings",
    renderedSection,
  })

  await writeFile(memoryPath, `${nextContent.trimEnd()}\n`, "utf8")
}

export async function readAgentWorkspaceManagedMemoryNotes(
  companyDir: string,
  agentId: string,
): Promise<string | null> {
  const workspaceDir = await ensureSeededAgentWorkspaceDir(companyDir, agentId)
  const memoryPath = join(workspaceDir, DEFAULT_MEMORY_FILENAME)
  const current =
    (await maybeReadText(memoryPath)) ?? templateContent(DEFAULT_MEMORY_FILENAME, agentId).trim()
  const pattern = new RegExp(
    `${MEMORY_NOTES_SECTION_START}\\n([\\s\\S]*?)\\n${MEMORY_NOTES_SECTION_END}`,
    "u",
  )
  const match = pattern.exec(current)
  const notes = match?.[1]?.trim() ?? ""
  if (!notes || notes === "_No managed memory notes yet._") {
    return null
  }
  return notes
}

export async function writeAgentWorkspaceManagedMemoryNotes(params: {
  companyDir: string
  agentId: string
  content: string
  mode?: WorkspaceMemoryWriteMode
}): Promise<string> {
  const workspaceDir = await ensureSeededAgentWorkspaceDir(params.companyDir, params.agentId)
  const memoryPath = join(workspaceDir, DEFAULT_MEMORY_FILENAME)
  const current =
    (await maybeReadText(memoryPath)) ??
    templateContent(DEFAULT_MEMORY_FILENAME, params.agentId).trim()
  const existingNotes = await readAgentWorkspaceManagedMemoryNotes(
    params.companyDir,
    params.agentId,
  )
  const normalizedContent = params.content.trim()
  const nextNotes =
    params.mode === "append" && existingNotes
      ? `${existingNotes.trimEnd()}\n${normalizedContent}`
      : normalizedContent
  const nextContent = upsertDelimitedSection({
    current,
    sectionStart: MEMORY_NOTES_SECTION_START,
    sectionEnd: MEMORY_NOTES_SECTION_END,
    heading: "## Managed Memory Notes",
    renderedSection: renderManagedMemoryNotesSection(nextNotes),
  })
  await writeFile(memoryPath, `${nextContent.trimEnd()}\n`, "utf8")
  return nextNotes
}
