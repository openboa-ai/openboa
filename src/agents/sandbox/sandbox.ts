import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { mkdir, open, readdir, readFile, stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, posix as pathPosix, relative, resolve } from "node:path"
import type {
  ResourceAttachment,
  Sandbox,
  SandboxDescription,
  SandboxExecutionResult,
} from "../schema/runtime.js"

interface MountedResource {
  resource: ResourceAttachment
  rootPath: string
}

interface SandboxPathResolution {
  mount: MountedResource
  virtualPath: string
  actualPath: string
}

interface PersistentShellHandle {
  shellId: string
  sessionId: string
  shellPath: string
  mountPath: string
  mountRootPath: string
  mountRealRootPath: string
  startedAt: string
  cwdVirtualPath: string
  baseEnv: Record<string, string>
  envDiff: Record<string, string>
  process: ReturnType<typeof spawn>
  commandCount: number
  lastCommandAt: string | null
  currentCommand: string | null
  currentCommandStartedAt: string | null
  currentStdoutPreview: string | null
  currentStderrPreview: string | null
  updatedAt: string
  status: "active" | "closed"
  queue: Promise<unknown>
  currentExecution: Promise<{
    text: string
    output: unknown
    usage: Record<string, number>
  }> | null
}

interface ActivePersistentShellStreams {
  stdin: NonNullable<PersistentShellHandle["process"]["stdin"]>
  stdout: NonNullable<PersistentShellHandle["process"]["stdout"]>
  stderr: NonNullable<PersistentShellHandle["process"]["stderr"]>
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toVirtualPath(value: unknown): string {
  const requested = normalizeOptionalString(value) ?? "/workspace"
  const normalized = requested.startsWith("/")
    ? pathPosix.normalize(requested)
    : pathPosix.normalize(pathPosix.join("/workspace", requested))
  return normalized.startsWith("/") ? normalized : `/${normalized}`
}

function trimText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${String(value.length - maxChars)} chars]`
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

async function openWritableFile(actualPath: string): Promise<Awaited<ReturnType<typeof open>>> {
  return open(actualPath, "a+", 0o600)
}

async function writeUtf8FileWithSecureCreate(actualPath: string, content: string): Promise<void> {
  const handle = await openWritableFile(actualPath)
  try {
    await overwriteUtf8Handle(handle, content)
  } finally {
    await handle.close()
  }
}

async function overwriteUtf8Handle(
  handle: Awaited<ReturnType<typeof open>>,
  content: string,
): Promise<void> {
  await handle.truncate(0)
  await handle.write(content, 0, "utf8")
}

async function appendUtf8FileWithSecureCreate(actualPath: string, content: string): Promise<void> {
  const handle = await openWritableFile(actualPath)
  try {
    await handle.appendFile(content, "utf8")
  } finally {
    await handle.close()
  }
}

function sliceTextByLines(input: {
  content: string
  startLine?: number
  lineCount?: number
  tailLines?: number
}): {
  content: string
  lineWindow:
    | { mode: "head" | "tail"; count: number }
    | { mode: "range"; startLine: number; count: number }
    | null
  truncatedByLines: boolean
  totalLineCount: number
  selectedLineCount: number
} {
  const { content } = input
  const startLine = normalizePositiveInteger(input.startLine)
  const lineCount = normalizePositiveInteger(input.lineCount)
  const tailLines = normalizePositiveInteger(input.tailLines)
  if (lineCount && tailLines) {
    throw new Error("read_text accepts either lineCount or tailLines, not both")
  }
  if (startLine && tailLines) {
    throw new Error("read_text cannot combine startLine with tailLines")
  }
  const lines = content.split(/\r?\n/u)
  if (startLine && lineCount) {
    const count = lineCount
    const selected = lines.slice(startLine - 1, startLine - 1 + count)
    return {
      content: selected.join("\n"),
      lineWindow: { mode: "range", startLine, count },
      truncatedByLines: selected.length < lines.length,
      totalLineCount: lines.length,
      selectedLineCount: selected.length,
    }
  }
  if (lineCount) {
    const count = lineCount
    const selected = lines.slice(0, count)
    return {
      content: selected.join("\n"),
      lineWindow: { mode: "head", count },
      truncatedByLines: selected.length < lines.length,
      totalLineCount: lines.length,
      selectedLineCount: selected.length,
    }
  }
  if (tailLines) {
    const count = tailLines
    const selected = lines.slice(-count)
    return {
      content: selected.join("\n"),
      lineWindow: { mode: "tail", count },
      truncatedByLines: selected.length < lines.length,
      totalLineCount: lines.length,
      selectedLineCount: selected.length,
    }
  }
  return {
    content,
    lineWindow: null,
    truncatedByLines: false,
    totalLineCount: lines.length,
    selectedLineCount: lines.length,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&")
}

function buildGlobMatcher(pattern: string): (candidate: string) => boolean {
  const normalizedPattern = pattern.replace(/\\/gu, "/").trim()
  if (normalizedPattern.length === 0) {
    throw new Error("glob_entries requires a non-empty pattern")
  }
  const matchBasenameOnly = !normalizedPattern.includes("/")
  let regexSource = "^"
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const current = normalizedPattern[index]
    if (current === "*") {
      const next = normalizedPattern[index + 1]
      if (next === "*") {
        regexSource += ".*"
        index += 1
      } else {
        regexSource += "[^/]*"
      }
      continue
    }
    if (current === "?") {
      regexSource += "[^/]"
      continue
    }
    regexSource += escapeRegExp(current)
  }
  regexSource += "$"
  const regex = new RegExp(regexSource, "u")
  return (candidate: string) => {
    const normalizedCandidate = candidate.replace(/\\/gu, "/")
    const subject = matchBasenameOnly
      ? pathPosix.basename(normalizedCandidate)
      : normalizedCandidate
    return regex.test(subject)
  }
}

const READ_ONLY_COMMANDS = new Set([
  "pwd",
  "env",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "basename",
  "dirname",
  "realpath",
])
const WRITABLE_SHELL_KINDS = new Set(["session_workspace", "repo_mount"])
const SAFE_VAULT_COMMANDS = new Set(["pwd", "ls"])
const PROTECTED_ENV_KEYS = new Set([
  "PATH",
  "LANG",
  "TMPDIR",
  "OPENBOA_SESSION_ID",
  "OPENBOA_WORKSPACE_CWD",
])
const TRANSIENT_SHELL_ENV_KEYS = new Set(["PWD", "OLDPWD", "SHLVL", "_"])
const PERSISTENT_SHELL_PATH = process.env.SHELL ?? "/bin/zsh"
const PERSISTENT_SHELL_FLAGS = ["/bin/zsh", "/usr/bin/zsh"].includes(PERSISTENT_SHELL_PATH)
  ? ["-f"]
  : []

function tokenizeSimpleShellCommand(command: string): string[] | null {
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    return null
  }
  const tokens: string[] = []
  const tokenPattern = /"([^"\\]*)"|'([^'\\]*)'|([^\s"'\\]+)/gu
  let lastIndex = 0
  while (true) {
    const match = tokenPattern.exec(trimmed)
    if (match === null) {
      break
    }
    const between = trimmed.slice(lastIndex, match.index)
    if (between.trim().length > 0) {
      return null
    }
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
    lastIndex = tokenPattern.lastIndex
  }
  if (trimmed.slice(lastIndex).trim().length > 0) {
    return null
  }
  return tokens.length > 0 ? tokens : null
}

export function projectSimpleShellCommand(command: string): {
  command: string
  args: string[]
} | null {
  const tokens = tokenizeSimpleShellCommand(command)
  if (!tokens || tokens.length === 0) {
    return null
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*=.*/u.test(tokens[0])) {
    return null
  }
  const [commandName, ...args] = tokens
  return {
    command: commandName,
    args,
  }
}

export function projectReadOnlyShellCommand(command: string): {
  command: string
  args: string[]
} | null {
  const projected = projectSimpleShellCommand(command)
  if (!projected) {
    return null
  }
  try {
    validateReadOnlyCommand(projected.command, projected.args)
    return {
      command: projected.command,
      args: projected.args,
    }
  } catch {
    return null
  }
}

export function buildReadOnlyBashAlternative(input: {
  command: string | null
  cwd?: string | null
  fallbackCwd?: string | null
  timeoutMs?: unknown
  maxOutputChars?: unknown
  rationale: string
}): {
  tool: "bash"
  args: Record<string, unknown>
  rationale: string
} | null {
  const projected = input.command ? projectReadOnlyShellCommand(input.command) : null
  if (!projected) {
    return null
  }
  const args: Record<string, unknown> = {
    command: projected.command,
    args: projected.args,
    cwd:
      normalizeOptionalString(input.cwd) ??
      normalizeOptionalString(input.fallbackCwd) ??
      "/workspace",
  }
  if (
    typeof input.timeoutMs === "number" &&
    Number.isFinite(input.timeoutMs) &&
    input.timeoutMs > 0
  ) {
    args.timeoutMs = input.timeoutMs
  }
  if (
    typeof input.maxOutputChars === "number" &&
    Number.isFinite(input.maxOutputChars) &&
    input.maxOutputChars > 0
  ) {
    args.maxOutputChars = input.maxOutputChars
  }
  return {
    tool: "bash",
    args,
    rationale: input.rationale,
  }
}

function validateReadOnlyCommand(command: string, args: string[]): void {
  if (!READ_ONLY_COMMANDS.has(command)) {
    throw new Error(
      `run_command only allows read-only commands: ${Array.from(READ_ONLY_COMMANDS).join(", ")}`,
    )
  }
  if (command === "pwd" && args.length > 0) {
    throw new Error("pwd does not accept arguments in run_command")
  }
  if (command === "env" && args.length > 0) {
    throw new Error("env does not accept arguments in run_command")
  }
}

function validateCommandArgsAgainstMount(
  command: string,
  args: string[],
  resolution: SandboxPathResolution,
): string[] {
  if (command === "pwd" || command === "env") {
    return []
  }
  return args.map((arg) => {
    if (arg.startsWith("-")) {
      return arg
    }
    const path = arg.startsWith("/")
      ? pathPosix.normalize(arg)
      : pathPosix.normalize(pathPosix.join(resolution.virtualPath, arg))
    const nestedResolution = resolutionForCommandPath(path, resolution.mount)
    return nestedResolution.actualPath
  })
}

function resolutionForCommandPath(
  virtualPath: string,
  mount: MountedResource,
): SandboxPathResolution {
  const relativePath =
    virtualPath === mount.resource.mountPath
      ? ""
      : pathPosix.relative(mount.resource.mountPath, virtualPath)
  const actualPath = resolve(mount.rootPath, relativePath)
  const relativeToRoot = relative(mount.rootPath, actualPath)
  if (relativeToRoot.startsWith("..") || relativeToRoot.includes(`..${pathPosix.sep}`)) {
    throw new Error(`Command path ${virtualPath} escapes mounted root ${mount.resource.mountPath}`)
  }
  return {
    mount,
    virtualPath,
    actualPath,
  }
}

function pathTouchesMount(actualPath: string, mount: MountedResource): boolean {
  const relativeToRoot = relative(mount.rootPath, actualPath)
  return (
    relativeToRoot === "" ||
    (!relativeToRoot.startsWith("..") && !relativeToRoot.includes(`..${pathPosix.sep}`))
  )
}

function shellMountPathPattern(mountPath: string): RegExp {
  const escapedMountPath = escapeRegExp(mountPath)
  return new RegExp(`(^|[\\s"'=:(\\[{,])(${escapedMountPath}(?:\\/[^\\s"'\\]\\[){}:,;]+)?)`, "gu")
}

function normalizeSandboxEnvOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  const env = value as Record<string, unknown>
  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      throw new Error(`Invalid shell environment key: ${key}`)
    }
    if (PROTECTED_ENV_KEYS.has(key) || key.startsWith("OPENBOA_")) {
      throw new Error(`Shell environment key ${key} is protected`)
    }
    if (typeof rawValue !== "string") {
      throw new Error(`Shell environment value for ${key} must be a string`)
    }
    normalized[key] = rawValue
  }
  return normalized
}

export class LocalSandbox implements Sandbox {
  private static persistentShells = new Map<string, PersistentShellHandle>()
  private provisionedResources: ResourceAttachment[] = []
  private mountedResources: MountedResource[] = []
  private sessionId: string | null = null

  async provision(resources: ResourceAttachment[]): Promise<void> {
    this.provisionedResources = [...resources]
    this.mountedResources = [...resources]
      .map((resource) => ({
        resource,
        rootPath: resolve(resource.sourceRef),
      }))
      .sort((left, right) => right.resource.mountPath.length - left.resource.mountPath.length)
    this.sessionId =
      resources
        .find((resource) => resource.kind === "session_runtime_memory")
        ?.sourceRef.match(/\/sessions\/([^/]+)\/runtime$/u)?.[1] ?? null
  }

  async describe(): Promise<SandboxDescription> {
    return {
      kind: "local-workspace-fs",
      summary:
        "Local workspace-backed sandbox. It can inspect mounted resources and read or write inside provisioned read-write mounts such as /workspace, while denying access outside mounted roots.",
      provisionedResourceCount: this.provisionedResources.length,
      resources: this.provisionedResources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        mountPath: resource.mountPath,
        access: resource.access,
        scope: typeof resource.metadata?.scope === "string" ? resource.metadata.scope : undefined,
      })),
      constraints: [
        "Only provisioned mounts are visible.",
        "Read-only mounts can be inspected but not mutated.",
        "Writes are serialized per mounted root with an advisory lease.",
        "run_command is shell=false and limited to allowlisted read-only commands.",
        "run_shell is permission-gated and limited to writable execution mounts such as /workspace.",
      ],
      actions: [
        {
          name: "inspect",
          description: "Inspect the mounted resource map and hand policy.",
          access: "read_only",
        },
        {
          name: "list_dir",
          description: "List directories and files inside a mounted root.",
          access: "read_only",
        },
        {
          name: "read_text",
          description: "Read a text file from a mounted root.",
          access: "read_only",
        },
        {
          name: "write_text",
          description: "Write a text file under a read-write mounted root.",
          access: "read_write",
        },
        {
          name: "append_text",
          description: "Append text under a read-write mounted root.",
          access: "read_write",
        },
        {
          name: "replace_text",
          description: "Replace exact text inside a file under a read-write mounted root.",
          access: "read_write",
        },
        {
          name: "mkdir",
          description: "Create directories under a read-write mounted root.",
          access: "read_write",
        },
        {
          name: "stat",
          description: "Inspect a path inside a mounted root.",
          access: "read_only",
        },
        {
          name: "find_entries",
          description: "Search for file or directory names under a mounted root.",
          access: "read_only",
        },
        {
          name: "glob_entries",
          description:
            "Match file or directory paths under a mounted root with a glob pattern, optionally filtering by kind.",
          access: "read_only",
        },
        {
          name: "grep_text",
          description: "Search text content under a mounted root.",
          access: "read_only",
        },
        {
          name: "run_command",
          description: "Run an allowlisted read-only non-shell command inside a mounted root.",
          access: "read_only",
        },
        {
          name: "run_shell",
          description:
            "Run a bounded shell command inside a writable execution mount such as /workspace.",
          access: "read_write",
        },
        {
          name: "inspect_persistent_shell",
          description:
            "Inspect the current session-scoped persistent shell process metadata, if one is active.",
          access: "read_only",
        },
        {
          name: "open_persistent_shell",
          description:
            "Open or reuse one session-scoped persistent shell process rooted in a writable execution mount.",
          access: "read_write",
        },
        {
          name: "exec_persistent_shell",
          description:
            "Execute one command through the session-scoped persistent shell process while preserving shell cwd and environment drift.",
          access: "read_write",
        },
        {
          name: "close_persistent_shell",
          description: "Close the active session-scoped persistent shell process.",
          access: "read_write",
        },
        {
          name: "wait_persistent_shell",
          description:
            "Wait for the active session-scoped persistent shell command to finish, or return bounded running status if it is still busy.",
          access: "read_only",
        },
      ],
      commandPolicy: {
        shell: true,
        allowlistedCommands: [...READ_ONLY_COMMANDS],
        cwdScope: "cwd must resolve inside a provisioned mounted root",
        maxTimeoutMs: 60_000,
        exposedEnvKeys: ["PATH", "LANG", "TMPDIR", "OPENBOA_SESSION_ID", "OPENBOA_WORKSPACE_CWD"],
      },
      actionExamples: [
        {
          name: "inspect",
          description: "Return the current mounted resource map and access policy.",
          inputExample: {
            focus: "workspace mounts",
          },
        },
        {
          name: "list_dir",
          description: "List files or folders inside a mounted resource such as /workspace.",
          inputExample: {
            path: "/workspace",
            limit: 20,
          },
        },
        {
          name: "read_text",
          description:
            "Read a text file from a mounted resource, optionally as a bounded head or tail line preview.",
          inputExample: {
            path: "/workspace/agent/AGENTS.md",
            lineCount: 20,
          },
        },
        {
          name: "glob_entries",
          description:
            "Match file or directory paths under a mounted resource with an optional kind filter.",
          inputExample: {
            path: "/workspace",
            pattern: "**/*.md",
            kind: "file",
          },
        },
        {
          name: "write_text",
          description: "Write a text file inside a read-write mounted resource.",
          inputExample: {
            path: "/workspace/notes/todo.md",
            content: "Capture a durable note here.",
          },
        },
        {
          name: "append_text",
          description: "Append text to an existing file inside a read-write mounted resource.",
          inputExample: {
            path: "/workspace/MEMORY.md",
            content: "\n- Durable lesson worth keeping",
          },
        },
        {
          name: "mkdir",
          description: "Create a directory inside a read-write mounted resource.",
          inputExample: {
            path: "/workspace/notes",
            recursive: true,
          },
        },
        {
          name: "replace_text",
          description:
            "Replace exact text inside a file within a read-write mounted resource without rewriting the entire file by hand.",
          inputExample: {
            path: "/workspace/notes/todo.md",
            oldText: "TODO",
            newText: "DONE",
            replaceAll: false,
          },
        },
        {
          name: "find_entries",
          description: "Recursively search for file or directory names under a mounted resource.",
          inputExample: {
            path: "/workspace",
            query: "memory",
            limit: 20,
          },
        },
        {
          name: "glob_entries",
          description:
            "Match file or directory paths under a mounted resource using a glob pattern, optionally filtering by kind.",
          inputExample: {
            path: "/workspace",
            pattern: "**/*.md",
            kind: "file",
            limit: 20,
          },
        },
        {
          name: "grep_text",
          description: "Recursively search text content under a mounted resource.",
          inputExample: {
            path: "/workspace",
            query: "session log",
            regex: false,
            limit: 10,
          },
        },
        {
          name: "run_command",
          description:
            "Run a bounded read-only non-shell command with a working directory inside a mounted resource such as /workspace.",
          inputExample: {
            command: "pwd",
            args: [],
            cwd: "/workspace",
            timeoutMs: 5000,
          },
        },
        {
          name: "run_shell",
          description:
            "Run a bounded shell command inside a writable session hand after confirmation.",
          inputExample: {
            command: "printf 'hello from shell' > notes/hello.txt",
            cwd: "/workspace",
            timeoutMs: 5000,
          },
        },
        {
          name: "open_persistent_shell",
          description:
            "Open one reusable shell process for multi-step shell work inside the same session hand.",
          inputExample: {
            cwd: "/workspace",
          },
        },
        {
          name: "exec_persistent_shell",
          description:
            "Run a command through the reusable session-scoped shell so cwd/export changes persist across steps.",
          inputExample: {
            command:
              "export SESSION_NOTE=persistent && cd notes && printf '%s' \"$SESSION_NOTE\" > kept.txt",
            timeoutMs: 5000,
          },
        },
        {
          name: "close_persistent_shell",
          description:
            "Close the active reusable shell process when the multi-step shell loop is done.",
          inputExample: {},
        },
        {
          name: "wait_persistent_shell",
          description:
            "Wait for the current reusable shell command to finish, returning either the completed result or bounded running status.",
          inputExample: {
            timeoutMs: 1000,
          },
        },
      ],
    }
  }

  async execute(name: string, input: unknown): Promise<SandboxExecutionResult> {
    try {
      const result = await this.executeChecked(name, input)
      return {
        ok: true,
        name,
        text: typeof result.text === "string" ? result.text : null,
        output: result.output,
        artifacts: [],
        usage: result.usage,
        error: null,
      }
    } catch (error) {
      return {
        ok: false,
        name,
        text: null,
        artifacts: [],
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
        error: {
          code: "sandbox_access_denied",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      }
    }
  }

  private async executeChecked(
    name: string,
    input: unknown,
  ): Promise<{
    text: string | null
    output: unknown
    usage: Record<string, number>
  }> {
    const record = asObjectRecord(input)
    switch (name) {
      case "inspect":
        return {
          text: [
            `sandbox=${name}`,
            `resources=${this.provisionedResources.length}`,
            JSON.stringify(
              this.provisionedResources.map((resource) => ({
                id: resource.id,
                kind: resource.kind,
                mountPath: resource.mountPath,
                access: resource.access,
              })),
              null,
              2,
            ),
          ].join("\n"),
          output: {
            provisionedResourceCount: this.provisionedResources.length,
            resources: this.provisionedResources.map((resource) => ({
              id: resource.id,
              kind: resource.kind,
              mountPath: resource.mountPath,
              access: resource.access,
              scope:
                typeof resource.metadata?.scope === "string" ? resource.metadata.scope : undefined,
            })),
          },
          usage: {
            provisionedResourceCount: this.provisionedResources.length,
          },
        }
      case "list_dir":
        return this.listDirectory(record)
      case "read_text":
        return this.readText(record)
      case "write_text":
        return this.writeText(record)
      case "append_text":
        return this.appendText(record)
      case "replace_text":
        return this.replaceText(record)
      case "mkdir":
        return this.makeDirectory(record)
      case "stat":
        return this.statPath(record)
      case "find_entries":
        return this.findEntries(record)
      case "glob_entries":
        return this.globEntries(record)
      case "grep_text":
        return this.grepText(record)
      case "run_command":
        return this.runCommand(record)
      case "run_shell":
        return this.runShell(record)
      case "inspect_persistent_shell":
        return this.inspectPersistentShell()
      case "open_persistent_shell":
        return this.openPersistentShell(record)
      case "exec_persistent_shell":
        return this.execPersistentShell(record)
      case "close_persistent_shell":
        return this.closePersistentShell()
      case "wait_persistent_shell":
        return this.waitPersistentShell(record)
      default:
        throw new Error(`Unknown sandbox action: ${name}`)
    }
  }

  private resolveMountedPath(value: unknown, mode: "read" | "write"): SandboxPathResolution {
    const virtualPath = toVirtualPath(value)
    const mount = this.findMount(virtualPath)
    if (!mount) {
      throw new Error(`Path ${virtualPath} is outside provisioned sandbox mounts`)
    }
    if (mode === "write" && mount.resource.access !== "read_write") {
      throw new Error(`Path ${virtualPath} is mounted read-only`)
    }
    const relativePath =
      virtualPath === mount.resource.mountPath
        ? ""
        : pathPosix.relative(mount.resource.mountPath, virtualPath)
    const actualPath = resolve(mount.rootPath, relativePath)
    const relativeToRoot = relative(mount.rootPath, actualPath)
    if (relativeToRoot.startsWith("..") || relativeToRoot.includes(`..${pathPosix.sep}`)) {
      throw new Error(`Path ${virtualPath} escapes mounted root ${mount.resource.mountPath}`)
    }
    return {
      mount,
      virtualPath,
      actualPath,
    }
  }

  private findMount(virtualPath: string): MountedResource | null {
    for (const mount of this.mountedResources) {
      if (
        virtualPath === mount.resource.mountPath ||
        virtualPath.startsWith(`${mount.resource.mountPath}/`)
      ) {
        return mount
      }
    }
    return null
  }

  private async listDirectory(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "read")
    const limit =
      typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0
        ? Math.floor(record.limit)
        : 100
    const entries = await readdir(resolution.actualPath, { withFileTypes: true })
    const listed = entries.slice(0, limit).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      path:
        resolution.virtualPath === "/"
          ? `/${entry.name}`
          : pathPosix.join(resolution.virtualPath, entry.name),
    }))
    const nestedMounts = this.directChildMountEntries(resolution.virtualPath)
    const deduped = [...listed]
    for (const mountEntry of nestedMounts) {
      if (!deduped.some((entry) => entry.path === mountEntry.path)) {
        deduped.push(mountEntry)
      }
    }
    return {
      text: asListText({
        action: "list_dir",
        path: resolution.virtualPath,
        entries: deduped,
      }),
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        count: deduped.length,
        entries: deduped,
      },
      usage: {
        listedEntries: deduped.length,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async readText(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "read")
    if (resolution.mount.resource.kind === "vault") {
      throw new Error(
        `Direct vault content reads are blocked for ${resolution.virtualPath}; pass the mounted path into a bounded tool or command that consumes the secret without echoing it.`,
      )
    }
    const maxChars =
      typeof record.maxChars === "number" && Number.isFinite(record.maxChars) && record.maxChars > 0
        ? Math.floor(record.maxChars)
        : 12000
    const lineCount =
      typeof record.lineCount === "number" &&
      Number.isFinite(record.lineCount) &&
      record.lineCount > 0
        ? Math.floor(record.lineCount)
        : undefined
    const startLine =
      typeof record.startLine === "number" &&
      Number.isFinite(record.startLine) &&
      record.startLine > 0
        ? Math.floor(record.startLine)
        : undefined
    const tailLines =
      typeof record.tailLines === "number" &&
      Number.isFinite(record.tailLines) &&
      record.tailLines > 0
        ? Math.floor(record.tailLines)
        : undefined
    const content = await readFile(resolution.actualPath, "utf8")
    const sliced = sliceTextByLines({ content, startLine, lineCount, tailLines })
    const text = trimText(sliced.content, maxChars)
    return {
      text,
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        content: text,
        truncated: sliced.truncatedByLines || text.length !== sliced.content.length,
        charCount: content.length,
        totalLineCount: sliced.totalLineCount,
        selectedLineCount: sliced.selectedLineCount,
        ...(sliced.lineWindow ? { lineWindow: sliced.lineWindow } : {}),
      },
      usage: {
        readChars: Math.min(sliced.content.length, maxChars),
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async writeText(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "write")
    const content = typeof record.content === "string" ? record.content : ""
    await this.withWriteLease(resolution, async () => {
      await mkdir(dirname(resolution.actualPath), { recursive: true })
      await writeUtf8FileWithSecureCreate(resolution.actualPath, content)
    })
    return {
      text: `Wrote ${String(content.length)} chars to ${resolution.virtualPath}`,
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        charCount: content.length,
        operation: "write_text",
      },
      usage: {
        writtenChars: content.length,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async appendText(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "write")
    const content = typeof record.content === "string" ? record.content : ""
    await this.withWriteLease(resolution, async () => {
      await mkdir(dirname(resolution.actualPath), { recursive: true })
      await appendUtf8FileWithSecureCreate(resolution.actualPath, content)
    })
    return {
      text: `Appended ${String(content.length)} chars to ${resolution.virtualPath}`,
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        charCount: content.length,
        operation: "append_text",
      },
      usage: {
        appendedChars: content.length,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async replaceText(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "write")
    const oldText = typeof record.oldText === "string" ? record.oldText : ""
    if (oldText.length === 0) {
      throw new Error("replace_text requires a non-empty oldText")
    }
    const newText = typeof record.newText === "string" ? record.newText : ""
    const replaceAll = record.replaceAll === true

    const outcome = await this.withWriteLease(resolution, async () => {
      const handle = await open(resolution.actualPath, "r+")
      try {
        const current = await handle.readFile("utf8")
        const occurrences = current.split(oldText).length - 1
        if (occurrences === 0) {
          throw new Error(
            `replace_text could not find the requested text in ${resolution.virtualPath}`,
          )
        }
        const nextContent = replaceAll
          ? current.split(oldText).join(newText)
          : current.replace(oldText, newText)
        await overwriteUtf8Handle(handle, nextContent)
        return {
          occurrences,
          replacements: replaceAll ? occurrences : 1,
          charCount: nextContent.length,
        }
      } finally {
        await handle.close()
      }
    })

    return {
      text: `Replaced ${String(outcome.replacements)} occurrence(s) in ${resolution.virtualPath}`,
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        operation: "replace_text",
        replaceAll,
        occurrences: outcome.occurrences,
        replacements: outcome.replacements,
        charCount: outcome.charCount,
      },
      usage: {
        replacedOccurrences: outcome.replacements,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async makeDirectory(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "write")
    const recursive = record.recursive !== false
    await this.withWriteLease(resolution, async () => {
      await mkdir(resolution.actualPath, { recursive })
    })
    return {
      text: `Created directory ${resolution.virtualPath}`,
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        recursive,
        operation: "mkdir",
      },
      usage: {
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async statPath(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "read")
    const currentStat = await stat(resolution.actualPath)
    return {
      text: [
        `path=${resolution.virtualPath}`,
        `kind=${currentStat.isDirectory() ? "directory" : currentStat.isFile() ? "file" : "other"}`,
        `size=${String(currentStat.size)}`,
      ].join("\n"),
      output: {
        path: resolution.virtualPath,
        mountPath: resolution.mount.resource.mountPath,
        kind: currentStat.isDirectory() ? "directory" : currentStat.isFile() ? "file" : "other",
        size: currentStat.size,
        mtime: currentStat.mtime.toISOString(),
      },
      usage: {
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async findEntries(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "read")
    const query = normalizeOptionalString(record.query)
    if (!query) {
      throw new Error("find_entries requires a non-empty query")
    }
    const limit =
      typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0
        ? Math.floor(record.limit)
        : 40
    const entries = await this.walkEntries(resolution.virtualPath, resolution.actualPath, limit, {
      query,
      contentQuery: null,
      pathMatcher: null,
      contentRegex: null,
      caseSensitive: false,
      kind: null,
    })
    return {
      text: [
        `sandbox=find_entries`,
        `path=${resolution.virtualPath}`,
        `query=${query}`,
        ...entries.map((entry) => `${entry.kind}\t${entry.path}`),
      ].join("\n"),
      output: {
        path: resolution.virtualPath,
        query,
        count: entries.length,
        entries,
      },
      usage: {
        matchedEntries: entries.length,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async globEntries(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "read")
    const pattern = normalizeOptionalString(record.pattern)
    if (!pattern) {
      throw new Error("glob_entries requires a non-empty pattern")
    }
    const limit =
      typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0
        ? Math.floor(record.limit)
        : 40
    const kind =
      record.kind === "file" || record.kind === "directory"
        ? (record.kind as "file" | "directory")
        : null
    const matcher = buildGlobMatcher(pattern)
    const entries = await this.walkEntries(resolution.virtualPath, resolution.actualPath, limit, {
      query: null,
      contentQuery: null,
      pathMatcher: matcher,
      contentRegex: null,
      caseSensitive: false,
      kind,
    })
    return {
      text: [
        `sandbox=glob_entries`,
        `path=${resolution.virtualPath}`,
        `pattern=${pattern}`,
        ...entries.map((entry) => `${entry.kind}\t${entry.path}`),
      ].join("\n"),
      output: {
        path: resolution.virtualPath,
        pattern,
        kind,
        count: entries.length,
        entries,
      },
      usage: {
        matchedEntries: entries.length,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async grepText(record: Record<string, unknown>) {
    const resolution = this.resolveMountedPath(record.path, "read")
    if (resolution.mount.resource.kind === "vault") {
      throw new Error(
        `Direct vault content search is blocked for ${resolution.virtualPath}; inspect vault structure only and avoid echoing secret material.`,
      )
    }
    const query = normalizeOptionalString(record.query)
    if (!query) {
      throw new Error("grep_text requires a non-empty query")
    }
    const regex = record.regex === true
    const caseSensitive = record.caseSensitive === true
    const limit =
      typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0
        ? Math.floor(record.limit)
        : 20
    const matches = await this.walkEntries(resolution.virtualPath, resolution.actualPath, limit, {
      query: null,
      contentQuery: query,
      pathMatcher: null,
      contentRegex: regex ? new RegExp(query, caseSensitive ? "u" : "iu") : null,
      caseSensitive,
      kind: "file",
    })
    return {
      text: [
        `sandbox=grep_text`,
        `path=${resolution.virtualPath}`,
        `query=${query}`,
        `regex=${String(regex)}`,
        ...matches.map((entry) => `${entry.path}\t${entry.preview ?? ""}`),
      ].join("\n"),
      output: {
        path: resolution.virtualPath,
        query,
        regex,
        caseSensitive,
        count: matches.length,
        matches,
      },
      usage: {
        matchedEntries: matches.length,
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async runCommand(record: Record<string, unknown>) {
    const command = normalizeOptionalString(record.command)
    if (!command) {
      throw new Error("run_command requires a non-empty command")
    }
    const args = Array.isArray(record.args)
      ? record.args.filter((value): value is string => typeof value === "string")
      : []
    validateReadOnlyCommand(command, args)
    const resolution = this.resolveMountedPath(record.cwd ?? "/workspace", "read")
    const validatedArgs = validateCommandArgsAgainstMount(command, args, resolution)
    const touchesVault =
      resolution.mount.resource.kind === "vault" ||
      validatedArgs.some((arg) =>
        this.mountedResources.some(
          (mount) => mount.resource.kind === "vault" && pathTouchesMount(arg, mount),
        ),
      )
    if (touchesVault && !SAFE_VAULT_COMMANDS.has(command)) {
      throw new Error(
        `run_command only allows ${Array.from(SAFE_VAULT_COMMANDS).join(", ")} when vault mounts are involved`,
      )
    }
    const timeoutMs =
      typeof record.timeoutMs === "number" &&
      Number.isFinite(record.timeoutMs) &&
      record.timeoutMs > 0
        ? Math.min(Math.floor(record.timeoutMs), 60_000)
        : 15_000
    const maxOutputChars =
      typeof record.maxOutputChars === "number" &&
      Number.isFinite(record.maxOutputChars) &&
      record.maxOutputChars > 0
        ? Math.min(Math.floor(record.maxOutputChars), 40_000)
        : 12_000
    const envOverrides = normalizeSandboxEnvOverrides(record.env)

    const startedAt = Date.now()
    const result = await executeBoundedCommand({
      command,
      args: validatedArgs,
      cwd: resolution.actualPath,
      timeoutMs,
      maxOutputChars,
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        OPENBOA_SESSION_ID: this.sessionId ?? "",
        OPENBOA_WORKSPACE_CWD: resolution.virtualPath,
        ...envOverrides,
      },
    })
    return {
      text: [
        `command=${command}`,
        `cwd=${resolution.virtualPath}`,
        `exitCode=${String(result.exitCode)}`,
        `timedOut=${String(result.timedOut)}`,
        result.stdout ? `stdout=${trimText(result.stdout, 400)}` : "",
        result.stderr ? `stderr=${trimText(result.stderr, 400)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      output: {
        command,
        args: validatedArgs,
        cwd: resolution.virtualPath,
        envKeys: Object.keys(envOverrides),
        mountPath: resolution.mount.resource.mountPath,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startedAt,
      },
      usage: {
        provisionedResourceCount: this.provisionedResources.length,
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length,
      },
    }
  }

  private async runShell(record: Record<string, unknown>) {
    const command = normalizeOptionalString(record.command)
    if (!command) {
      throw new Error("run_shell requires a non-empty command")
    }
    const resolvedCommand = this.rewriteVirtualMountPathsInShellCommand(command)
    const resolution = this.resolveMountedPath(record.cwd ?? "/workspace", "write")
    if (!WRITABLE_SHELL_KINDS.has(resolution.mount.resource.kind)) {
      throw new Error(
        `run_shell only allows writable execution mounts: ${Array.from(WRITABLE_SHELL_KINDS).join(", ")}`,
      )
    }
    const timeoutMs =
      typeof record.timeoutMs === "number" &&
      Number.isFinite(record.timeoutMs) &&
      record.timeoutMs > 0
        ? Math.min(Math.floor(record.timeoutMs), 60_000)
        : 15_000
    const maxOutputChars =
      typeof record.maxOutputChars === "number" &&
      Number.isFinite(record.maxOutputChars) &&
      record.maxOutputChars > 0
        ? Math.min(Math.floor(record.maxOutputChars), 40_000)
        : 12_000
    const envOverrides = normalizeSandboxEnvOverrides(record.env)

    return this.withWriteLease(resolution, async () => {
      const startedAt = Date.now()
      const result = await executeBoundedShell({
        command: resolvedCommand,
        cwd: resolution.actualPath,
        timeoutMs,
        maxOutputChars,
        env: {
          PATH: process.env.PATH,
          LANG: process.env.LANG,
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
          OPENBOA_SESSION_ID: this.sessionId ?? "",
          OPENBOA_WORKSPACE_CWD: resolution.virtualPath,
          ...envOverrides,
        },
      })
      return {
        text: [
          "command=shell",
          resolvedCommand !== command ? "rewroteVirtualPaths=true" : "",
          `cwd=${resolution.virtualPath}`,
          `exitCode=${String(result.exitCode)}`,
          `timedOut=${String(result.timedOut)}`,
          `shell=${result.shellPath}`,
          result.stdout ? `stdout=${trimText(result.stdout, 400)}` : "",
          result.stderr ? `stderr=${trimText(result.stderr, 400)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        output: {
          command,
          rewroteVirtualPaths: resolvedCommand !== command,
          cwd: resolution.virtualPath,
          envKeys: Object.keys(envOverrides),
          mountPath: resolution.mount.resource.mountPath,
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
          shellPath: result.shellPath,
          durationMs: Date.now() - startedAt,
        },
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
          stdoutChars: result.stdout.length,
          stderrChars: result.stderr.length,
        },
      }
    })
  }

  private persistentShellKey(): string {
    if (!this.sessionId) {
      throw new Error("persistent shell requires a provisioned session runtime resource")
    }
    return this.sessionId
  }

  private buildPersistentShellBaseEnv(
    resolution: SandboxPathResolution,
    envOverrides: Record<string, string>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries({
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        OPENBOA_SESSION_ID: this.sessionId ?? "",
        OPENBOA_WORKSPACE_CWD: resolution.virtualPath,
        ...envOverrides,
      }).filter((entry): entry is [string, string] => Boolean(entry[1])),
    )
  }

  private shellMetadata(handle: PersistentShellHandle) {
    return {
      shellId: handle.shellId,
      shellPath: handle.shellPath,
      mountPath: handle.mountPath,
      cwd: handle.cwdVirtualPath,
      startedAt: handle.startedAt,
      updatedAt: handle.updatedAt,
      lastCommandAt: handle.lastCommandAt,
      commandCount: handle.commandCount,
      busy: handle.currentCommand !== null,
      currentCommand: handle.currentCommand,
      currentCommandStartedAt: handle.currentCommandStartedAt,
      currentStdoutPreview: handle.currentStdoutPreview,
      currentStderrPreview: handle.currentStderrPreview,
      envKeys: Object.keys(handle.envDiff),
      status: handle.status,
    }
  }

  private requirePersistentShellStreams(
    handle: PersistentShellHandle,
  ): ActivePersistentShellStreams {
    const { stdin, stdout, stderr } = handle.process
    if (!stdin || !stdout || !stderr) {
      throw new Error("persistent shell streams are unavailable")
    }
    return { stdin, stdout, stderr }
  }

  private realPathOrSelf(path: string): string {
    try {
      return realpathSync.native(path)
    } catch {
      return path
    }
  }

  private virtualPathFromActualPath(handle: PersistentShellHandle, actualPath: string): string {
    const normalizedActualPath = this.realPathOrSelf(resolve(actualPath))
    const relativeToRoot = relative(handle.mountRealRootPath, normalizedActualPath)
    if (relativeToRoot.startsWith("..") || relativeToRoot.includes(`..${pathPosix.sep}`)) {
      return handle.cwdVirtualPath
    }
    return relativeToRoot === ""
      ? handle.mountPath
      : pathPosix.join(handle.mountPath, relativeToRoot.split(pathPosix.sep).join("/"))
  }

  private rewriteVirtualMountPathsInShellCommand(command: string): string {
    let rewritten = command
    for (const mount of this.mountedResources) {
      const pattern = shellMountPathPattern(mount.resource.mountPath)
      rewritten = rewritten.replace(
        pattern,
        (_match, prefix: string, matchedVirtualPath: string) => {
          const resolved = resolutionForCommandPath(pathPosix.normalize(matchedVirtualPath), mount)
          return `${prefix}${resolved.actualPath}`
        },
      )
    }
    return rewritten
  }

  private async openPersistentShell(record: Record<string, unknown>) {
    const key = this.persistentShellKey()
    const restart = record.restart === true
    const resolution = this.resolveMountedPath(record.cwd ?? "/workspace", "write")
    if (!WRITABLE_SHELL_KINDS.has(resolution.mount.resource.kind)) {
      throw new Error(
        `open_persistent_shell only allows writable execution mounts: ${Array.from(WRITABLE_SHELL_KINDS).join(", ")}`,
      )
    }
    const envOverrides = normalizeSandboxEnvOverrides(record.env)
    const existing = LocalSandbox.persistentShells.get(key)
    if (existing && existing.status === "active" && !restart) {
      return {
        text: `persistent shell ready: ${existing.shellId}`,
        output: this.shellMetadata(existing),
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
      }
    }
    if (existing && restart) {
      await this.closePersistentShellHandle(existing)
    }
    const baseEnv = this.buildPersistentShellBaseEnv(resolution, envOverrides)
    const child = spawn(PERSISTENT_SHELL_PATH, PERSISTENT_SHELL_FLAGS, {
      cwd: resolution.actualPath,
      env: baseEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const streams = this.requirePersistentShellStreams({
      shellId: "pending",
      sessionId: key,
      shellPath: PERSISTENT_SHELL_PATH,
      mountPath: resolution.mount.resource.mountPath,
      mountRootPath: resolution.mount.rootPath,
      mountRealRootPath: this.realPathOrSelf(resolution.mount.rootPath),
      startedAt: "",
      cwdVirtualPath: resolution.virtualPath,
      baseEnv,
      envDiff: envOverrides,
      process: child,
      commandCount: 0,
      lastCommandAt: null,
      currentCommand: null,
      currentCommandStartedAt: null,
      currentStdoutPreview: null,
      currentStderrPreview: null,
      updatedAt: "",
      status: "active",
      queue: Promise.resolve(),
      currentExecution: null,
    })
    streams.stdin.setDefaultEncoding("utf8")
    streams.stdout.setEncoding("utf8")
    streams.stderr.setEncoding("utf8")
    const now = new Date().toISOString()
    const handle: PersistentShellHandle = {
      shellId: createHash("sha256")
        .update(`${key}:${now}:${resolution.virtualPath}`)
        .digest("hex")
        .slice(0, 16),
      sessionId: key,
      shellPath: PERSISTENT_SHELL_PATH,
      mountPath: resolution.mount.resource.mountPath,
      mountRootPath: resolution.mount.rootPath,
      mountRealRootPath: this.realPathOrSelf(resolution.mount.rootPath),
      startedAt: now,
      cwdVirtualPath: resolution.virtualPath,
      baseEnv,
      envDiff: envOverrides,
      process: child,
      commandCount: 0,
      lastCommandAt: null,
      currentCommand: null,
      currentCommandStartedAt: null,
      currentStdoutPreview: null,
      currentStderrPreview: null,
      updatedAt: now,
      status: "active",
      queue: Promise.resolve(),
      currentExecution: null,
    }
    child.on("close", () => {
      handle.status = "closed"
      handle.updatedAt = new Date().toISOString()
      const current = LocalSandbox.persistentShells.get(key)
      if (current?.shellId === handle.shellId) {
        LocalSandbox.persistentShells.delete(key)
      }
    })
    child.on("error", () => {
      handle.status = "closed"
      handle.updatedAt = new Date().toISOString()
      const current = LocalSandbox.persistentShells.get(key)
      if (current?.shellId === handle.shellId) {
        LocalSandbox.persistentShells.delete(key)
      }
    })
    LocalSandbox.persistentShells.set(key, handle)
    return {
      text: `opened persistent shell ${handle.shellId}`,
      output: this.shellMetadata(handle),
      usage: {
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async inspectPersistentShell() {
    const key = this.persistentShellKey()
    const handle = LocalSandbox.persistentShells.get(key)
    return {
      text: handle ? `persistent shell ready: ${handle.shellId}` : "no active persistent shell",
      output: {
        active: Boolean(handle && handle.status === "active"),
        persistentShell: handle ? this.shellMetadata(handle) : null,
      },
      usage: {
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private resolutionForPersistentShell(handle: PersistentShellHandle): SandboxPathResolution {
    const mount = this.mountedResources.find(
      (candidate) =>
        candidate.resource.mountPath === handle.mountPath &&
        candidate.rootPath === handle.mountRootPath,
    )
    if (!mount) {
      throw new Error(`persistent shell mount ${handle.mountPath} is no longer provisioned`)
    }
    return {
      mount,
      virtualPath: handle.mountPath,
      actualPath: handle.mountRootPath,
    }
  }

  private async execPersistentShell(record: Record<string, unknown>) {
    const command = normalizeOptionalString(record.command)
    if (!command) {
      throw new Error("exec_persistent_shell requires a non-empty command")
    }
    const resolvedCommand = this.rewriteVirtualMountPathsInShellCommand(command)
    const timeoutMs =
      typeof record.timeoutMs === "number" &&
      Number.isFinite(record.timeoutMs) &&
      record.timeoutMs > 0
        ? Math.min(Math.floor(record.timeoutMs), 60_000)
        : 15_000
    const maxOutputChars =
      typeof record.maxOutputChars === "number" &&
      Number.isFinite(record.maxOutputChars) &&
      record.maxOutputChars > 0
        ? Math.min(Math.floor(record.maxOutputChars), 40_000)
        : 12_000
    const opened = await this.openPersistentShell({
      cwd: record.cwd,
      env: record.env,
      restart: record.restart,
    })
    const shellId =
      opened.output && typeof opened.output === "object" && !Array.isArray(opened.output)
        ? ((opened.output as Record<string, unknown>).shellId as string | undefined)
        : undefined
    const key = this.persistentShellKey()
    const handle = LocalSandbox.persistentShells.get(key)
    if (!shellId || !handle || handle.shellId !== shellId || handle.status !== "active") {
      throw new Error("persistent shell is not available")
    }
    const mountResolution = this.resolutionForPersistentShell(handle)
    const queued = handle.queue.then(() =>
      this.withWriteLease(mountResolution, () =>
        this.executePersistentShellCommand(
          handle,
          command,
          resolvedCommand,
          timeoutMs,
          maxOutputChars,
        ),
      ),
    )
    const currentExecution = queued.then((result) => result)
    handle.currentExecution = currentExecution.finally(() => {
      if (handle.currentExecution === currentExecution) {
        handle.currentExecution = null
      }
    })
    void handle.currentExecution.catch(() => {})
    handle.queue = queued.catch(() => {})
    return queued
  }

  private async closePersistentShell() {
    const key = this.persistentShellKey()
    const handle = LocalSandbox.persistentShells.get(key)
    if (!handle) {
      return {
        text: "no active persistent shell",
        output: {
          closed: false,
        },
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
      }
    }
    await this.closePersistentShellHandle(handle)
    return {
      text: `closed persistent shell ${handle.shellId}`,
      output: {
        closed: true,
        shellId: handle.shellId,
      },
      usage: {
        provisionedResourceCount: this.provisionedResources.length,
      },
    }
  }

  private async waitPersistentShell(record: Record<string, unknown>) {
    const key = this.persistentShellKey()
    const handle = LocalSandbox.persistentShells.get(key)
    const timeoutMs =
      typeof record.timeoutMs === "number" &&
      Number.isFinite(record.timeoutMs) &&
      record.timeoutMs >= 0
        ? Math.min(Math.floor(record.timeoutMs), 60_000)
        : 1_000
    if (!handle) {
      return {
        text: "no active persistent shell",
        output: {
          status: "idle",
          persistentShell: null,
          result: null,
        },
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
      }
    }
    if (!handle.currentExecution || handle.currentCommand === null) {
      return {
        text: `persistent shell idle: ${handle.shellId}`,
        output: {
          status: "idle",
          persistentShell: this.shellMetadata(handle),
          result: null,
        },
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
      }
    }

    const timeoutResult = Symbol("timeout")
    const waited = await Promise.race([
      handle.currentExecution.then((result) => ({ kind: "completed" as const, result })),
      new Promise<typeof timeoutResult>((resolvePromise) =>
        setTimeout(() => resolvePromise(timeoutResult), timeoutMs),
      ),
    ]).catch((error: unknown) => ({
      kind: "error" as const,
      error: error instanceof Error ? error.message : String(error),
    }))

    if (waited === timeoutResult) {
      return {
        text: `persistent shell still running: ${handle.currentCommand ?? "unknown command"}`,
        output: {
          status: "running",
          persistentShell: this.shellMetadata(handle),
          result: null,
        },
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
      }
    }

    if (waited.kind === "error") {
      return {
        text: `persistent shell error: ${waited.error}`,
        output: {
          status: "error",
          persistentShell: this.shellMetadata(handle),
          error: waited.error,
        },
        usage: {
          provisionedResourceCount: this.provisionedResources.length,
        },
      }
    }

    return {
      text: waited.result.text,
      output: {
        status: "completed",
        persistentShell: this.shellMetadata(handle),
        result: waited.result.output,
      },
      usage: waited.result.usage,
    }
  }

  private async closePersistentShellHandle(handle: PersistentShellHandle): Promise<void> {
    handle.status = "closed"
    handle.currentCommand = null
    handle.currentCommandStartedAt = null
    handle.currentStdoutPreview = null
    handle.currentStderrPreview = null
    handle.currentExecution = null
    handle.updatedAt = new Date().toISOString()
    if (!handle.process.killed) {
      handle.process.kill("SIGTERM")
    }
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        if (!handle.process.killed) {
          handle.process.kill("SIGKILL")
        }
        resolvePromise()
      }, 250)
      handle.process.once("close", () => {
        clearTimeout(timer)
        resolvePromise()
      })
    }).catch(() => {})
  }

  private async executePersistentShellCommand(
    handle: PersistentShellHandle,
    command: string,
    resolvedCommand: string,
    timeoutMs: number,
    maxOutputChars: number,
  ) {
    if (handle.status !== "active") {
      throw new Error("persistent shell is not active")
    }
    const commandId = createHash("sha256")
      .update(`${handle.shellId}:${Date.now()}:${command}`)
      .digest("hex")
      .slice(0, 12)
    const exitMarker = `__OPENBOA_EXIT_${commandId}__`
    const cwdMarker = `__OPENBOA_CWD_${commandId}__`
    const envBeginMarker = `__OPENBOA_ENV_BEGIN_${commandId}__`
    const envEndMarker = `__OPENBOA_ENV_END_${commandId}__`
    const startedAt = Date.now()
    handle.currentCommand = command
    handle.currentCommandStartedAt = new Date(startedAt).toISOString()
    handle.currentStdoutPreview = null
    handle.currentStderrPreview = null
    handle.updatedAt = handle.currentCommandStartedAt

    return await new Promise<{
      text: string
      output: unknown
      usage: Record<string, number>
    }>((resolvePromise, rejectPromise) => {
      const streams = this.requirePersistentShellStreams(handle)
      let stdout = ""
      let stderr = ""
      let finished = false

      const truncate = (current: string, chunk: string) =>
        (current + chunk).slice(0, maxOutputChars)

      const cleanup = () => {
        clearTimeout(timer)
        streams.stdout.off("data", onStdout)
        streams.stderr.off("data", onStderr)
        handle.process.off("close", onClose)
        handle.process.off("error", onError)
      }

      const finalizeIfReady = () => {
        const exitMatch = stdout.match(new RegExp(`${escapeRegExp(exitMarker)}\\s+(-?\\d+)`, "u"))
        const cwdMatch = stdout.match(new RegExp(`${escapeRegExp(cwdMarker)}\\s+([^\\n\\r]+)`, "u"))
        const envMatch = stdout.match(
          new RegExp(
            `${escapeRegExp(envBeginMarker)}\\n([\\s\\S]*?)\\n${escapeRegExp(envEndMarker)}`,
            "u",
          ),
        )
        if (!exitMatch || !cwdMatch || !envMatch) {
          return
        }
        finished = true
        cleanup()
        const rawEnv = envMatch[1]
        const observedEnv = Object.fromEntries(
          rawEnv
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && line.includes("="))
            .map((line) => {
              const separator = line.indexOf("=")
              return [line.slice(0, separator), line.slice(separator + 1)] as const
            }),
        )
        const nextActualCwd =
          typeof observedEnv.PWD === "string" && observedEnv.PWD.trim().length > 0
            ? observedEnv.PWD.trim()
            : cwdMatch[1].trim()
        const nextEnv = Object.fromEntries(
          Object.entries(observedEnv)
            .filter(([key]) => !PROTECTED_ENV_KEYS.has(key) && !key.startsWith("OPENBOA_"))
            .filter(([key]) => !TRANSIENT_SHELL_ENV_KEYS.has(key))
            .filter(([key, value]) => handle.baseEnv[key] !== value),
        )
        handle.envDiff = nextEnv
        handle.cwdVirtualPath = this.virtualPathFromActualPath(handle, nextActualCwd)
        handle.commandCount += 1
        handle.lastCommandAt = new Date().toISOString()
        handle.updatedAt = handle.lastCommandAt
        handle.currentCommand = null
        handle.currentCommandStartedAt = null
        handle.currentStdoutPreview = null
        handle.currentStderrPreview = null
        const cleanedStdout = stdout
          .replace(new RegExp(`\\n?${escapeRegExp(exitMarker)}\\s+-?\\d+\\n?`, "u"), "\n")
          .replace(new RegExp(`\\n?${escapeRegExp(cwdMarker)}\\s+[^\\n\\r]+\\n?`, "u"), "\n")
          .replace(
            new RegExp(
              `\\n?${escapeRegExp(envBeginMarker)}\\n[\\s\\S]*?\\n${escapeRegExp(envEndMarker)}\\n?`,
              "u",
            ),
            "\n",
          )
          .trim()
        resolvePromise({
          text: [
            "command=persistent-shell",
            resolvedCommand !== command ? "rewroteVirtualPaths=true" : "",
            `cwd=${handle.cwdVirtualPath}`,
            `exitCode=${exitMatch[1]}`,
            `shell=${handle.shellPath}`,
            cleanedStdout ? `stdout=${trimText(cleanedStdout, 400)}` : "",
            stderr ? `stderr=${trimText(stderr, 400)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          output: {
            shellId: handle.shellId,
            command,
            rewroteVirtualPaths: resolvedCommand !== command,
            cwd: handle.cwdVirtualPath,
            envKeys: Object.keys(handle.envDiff),
            env: {
              ...handle.baseEnv,
              ...handle.envDiff,
            },
            exitCode: Number.parseInt(exitMatch[1] ?? "0", 10),
            timedOut: false,
            stdout: cleanedStdout,
            stderr,
            shellPath: handle.shellPath,
            startedAt: handle.startedAt,
            updatedAt: handle.updatedAt,
            lastCommandAt: handle.lastCommandAt,
            durationMs: Date.now() - startedAt,
            commandCount: handle.commandCount,
            status: handle.status,
            persistent: true,
          },
          usage: {
            provisionedResourceCount: this.provisionedResources.length,
            stdoutChars: cleanedStdout.length,
            stderrChars: stderr.length,
          },
        })
      }

      const onStdout = (chunk: string | Buffer) => {
        stdout = truncate(stdout, String(chunk))
        handle.currentStdoutPreview = trimText(stdout, 400)
        handle.updatedAt = new Date().toISOString()
        finalizeIfReady()
      }
      const onStderr = (chunk: string | Buffer) => {
        stderr = truncate(stderr, String(chunk))
        handle.currentStderrPreview = trimText(stderr, 400)
        handle.updatedAt = new Date().toISOString()
      }
      const onClose = () => {
        if (finished) {
          return
        }
        cleanup()
        handle.status = "closed"
        handle.currentCommand = null
        handle.currentCommandStartedAt = null
        handle.currentStdoutPreview = null
        handle.currentStderrPreview = null
        rejectPromise(new Error("persistent shell closed before command completion"))
      }
      const onError = (error: Error) => {
        if (finished) {
          return
        }
        cleanup()
        handle.status = "closed"
        handle.currentCommand = null
        handle.currentCommandStartedAt = null
        handle.currentStdoutPreview = null
        handle.currentStderrPreview = null
        rejectPromise(error)
      }

      const timer = setTimeout(() => {
        if (finished) {
          return
        }
        cleanup()
        handle.status = "closed"
        handle.currentCommand = null
        handle.currentCommandStartedAt = null
        handle.currentStdoutPreview = null
        handle.currentStderrPreview = null
        handle.process.kill("SIGTERM")
        rejectPromise(new Error("persistent shell command timed out"))
      }, timeoutMs)

      streams.stdout.on("data", onStdout)
      streams.stderr.on("data", onStderr)
      handle.process.on("close", onClose)
      handle.process.on("error", onError)

      streams.stdin.write(
        [
          resolvedCommand,
          "__openboa_exit=$?",
          '__openboa_cwd="$(pwd)"',
          `printf '${exitMarker} %s\\n' "$__openboa_exit"`,
          `printf '${cwdMarker} %s\\n' "$__openboa_cwd"`,
          `printf '${envBeginMarker}\\n'`,
          "env",
          `printf '${envEndMarker}\\n'`,
          "",
        ].join("\n"),
      )
    })
  }

  private async walkEntries(
    virtualRoot: string,
    actualRoot: string,
    limit: number,
    mode: {
      query: string | null
      contentQuery: string | null
      pathMatcher: ((candidate: string) => boolean) | null
      contentRegex: RegExp | null
      caseSensitive: boolean
      kind: "file" | "directory" | null
    },
  ): Promise<
    Array<{
      path: string
      kind: "directory" | "file"
      preview?: string
    }>
  > {
    const results: Array<{
      path: string
      kind: "directory" | "file"
      preview?: string
    }> = []
    const queue: Array<{ virtualPath: string; actualPath: string }> = [
      { virtualPath: virtualRoot, actualPath: actualRoot },
    ]
    const loweredQuery = mode.query?.toLowerCase() ?? null
    const loweredContentQuery = mode.caseSensitive
      ? (mode.contentQuery ?? null)
      : (mode.contentQuery?.toLowerCase() ?? null)

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()
      if (!current) {
        break
      }
      const entries = await readdir(current.actualPath, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= limit) {
          break
        }
        const entryVirtualPath =
          current.virtualPath === "/"
            ? `/${entry.name}`
            : pathPosix.join(current.virtualPath, entry.name)
        const entryActualPath = resolve(current.actualPath, entry.name)
        const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
        if (kind === "other") {
          continue
        }
        if (entry.isDirectory()) {
          queue.push({ virtualPath: entryVirtualPath, actualPath: entryActualPath })
        }
        if (mode.pathMatcher) {
          const relativePath = pathPosix.relative(virtualRoot, entryVirtualPath) || entry.name
          const kindMatches = mode.kind ? mode.kind === kind : true
          if (
            kindMatches &&
            (mode.pathMatcher(relativePath) || mode.pathMatcher(entryVirtualPath))
          ) {
            results.push({ path: entryVirtualPath, kind })
          }
          continue
        }
        if (loweredQuery) {
          if (mode.kind && mode.kind !== kind) {
            continue
          }
          const haystack = `${entryVirtualPath}\n${entry.name}`.toLowerCase()
          if (haystack.includes(loweredQuery)) {
            results.push({ path: entryVirtualPath, kind })
          }
          continue
        }
        if (!loweredContentQuery || !entry.isFile()) {
          continue
        }
        const fileContent = await readFile(entryActualPath, "utf8").catch(() => null)
        if (!fileContent) {
          continue
        }
        const haystack = mode.caseSensitive ? fileContent : fileContent.toLowerCase()
        const index = mode.contentRegex
          ? fileContent.search(mode.contentRegex)
          : haystack.indexOf(loweredContentQuery)
        if (index < 0) {
          continue
        }
        const preview = trimText(
          fileContent.slice(Math.max(0, index - 80), Math.min(fileContent.length, index + 160)),
          240,
        ).replace(/\s+/g, " ")
        results.push({
          path: entryVirtualPath,
          kind: "file",
          preview,
        })
      }
    }

    return results
  }

  private directChildMountEntries(
    virtualPath: string,
  ): Array<{ name: string; kind: "directory"; path: string }> {
    return this.mountedResources
      .filter((mount) => mount.resource.mountPath !== virtualPath)
      .flatMap((mount) => {
        const parent = pathPosix.dirname(mount.resource.mountPath)
        if (parent !== virtualPath) {
          return []
        }
        return [
          {
            name: pathPosix.basename(mount.resource.mountPath),
            kind: "directory" as const,
            path: mount.resource.mountPath,
          },
        ]
      })
  }

  private async withWriteLease<T>(
    resolution: SandboxPathResolution,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = sandboxLockPathForRoot(resolution.mount.rootPath)
    await mkdir(dirname(lockPath), { recursive: true })
    const owner = JSON.stringify(
      {
        sessionId: this.sessionId,
        mountPath: resolution.mount.resource.mountPath,
        rootPath: resolution.mount.rootPath,
      },
      null,
      2,
    )
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(lockPath, "wx", 0o600)
      await handle.writeFile(`${owner}\n`, "utf8")
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error(
          `Write access to ${resolution.mount.resource.mountPath} is currently busy with another session`,
        )
      }
      throw error
    } finally {
      await handle?.close().catch(() => {})
    }

    try {
      return await operation()
    } finally {
      await unlink(lockPath).catch(() => {})
    }
  }
}

function asListText(input: {
  action: string
  path: string
  entries: Array<{ name: string; kind: string; path: string }>
}): string {
  return [
    `sandbox=${input.action}`,
    `path=${input.path}`,
    ...input.entries.map((entry) => `${entry.kind}\t${entry.path}`),
  ].join("\n")
}

export function sandboxLockPathForRoot(rootPath: string): string {
  return join(resolve(rootPath), ".openboa-locks", "write.lock")
}

async function executeBoundedCommand(input: {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  maxOutputChars: number
  env: Record<string, string | undefined>
}): Promise<{
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: Object.fromEntries(
        Object.entries(input.env).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    const truncate = (current: string, chunk: string) =>
      (current + chunk).slice(0, input.maxOutputChars)

    child.stdout.on("data", (chunk) => {
      stdout = truncate(stdout, String(chunk))
    })
    child.stderr.on("data", (chunk) => {
      stderr = truncate(stderr, String(chunk))
    })
    child.on("error", (error) => {
      rejectPromise(error)
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, input.timeoutMs)

    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolvePromise({
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
      })
    })
  })
}

async function executeBoundedShell(input: {
  command: string
  cwd: string
  timeoutMs: number
  maxOutputChars: number
  env: Record<string, string | undefined>
}): Promise<{
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  shellPath: string
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const shellPath = process.env.SHELL ?? "/bin/sh"
    const child = spawn(shellPath, ["-lc", input.command], {
      cwd: input.cwd,
      env: Object.fromEntries(
        Object.entries(input.env).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    const truncate = (current: string, chunk: string) =>
      (current + chunk).slice(0, input.maxOutputChars)

    child.stdout.on("data", (chunk) => {
      stdout = truncate(stdout, String(chunk))
    })
    child.stderr.on("data", (chunk) => {
      stderr = truncate(stderr, String(chunk))
    })
    child.on("error", (error) => {
      rejectPromise(error)
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, input.timeoutMs)

    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolvePromise({
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
        shellPath,
      })
    })
  })
}
