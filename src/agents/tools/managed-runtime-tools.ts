import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, posix as pathPosix } from "node:path"
import { makeUuidV7 } from "../../foundation/ids.js"
import { nowIsoString } from "../../foundation/time.js"
import { type ContextBudgetSnapshot, summarizeContextPressure } from "../context/context-budget.js"
import type { AgentLearningsStore } from "../memory/learnings-store.js"
import { searchAgentMemory } from "../memory/memory-search.js"
import type { RuntimeMemorySnapshot, RuntimeMemoryStore } from "../memory/runtime-memory-store.js"
import {
  listManagedMemoryStores,
  listWritableManagedMemoryStores,
  resolveManagedMemoryStore,
} from "../memory/store-registry.js"
import {
  ManagedMemoryVersionStore,
  type ManagedVersionedMemoryTarget,
} from "../memory/version-store.js"
import {
  applyLiveShellOutcomeGuard,
  evaluateSessionOutcome,
  type SessionOutcomeEvaluation,
} from "../outcomes/outcome-evaluate.js"
import { deriveSessionActiveOutcome, gradeSessionOutcome } from "../outcomes/outcome-grade.js"
import { resolveSessionWorkspaceDir } from "../resources/default-resources.js"
import {
  compareSessionWorkspaceArtifactToSubstrate,
  listStagedSubstrateDrafts,
  promoteSessionWorkspaceArtifact,
  requireResourceAttachment,
  resolveAttachedResourcePath,
  restoreSessionWorkspaceArtifactVersion,
  stageSubstrateArtifactToSessionWorkspace,
} from "../resources/resource-access.js"
import { SubstrateArtifactVersionStore } from "../resources/version-store.js"
import { computeSessionRelationAffinity, matchesSessionLineageFilter } from "../retrieval/query.js"
import { presentRetrievalSearchResult, searchCrossSessionRecall } from "../retrieval/search.js"
import { buildReadOnlyBashAlternative, projectSimpleShellCommand } from "../sandbox/sandbox.js"
import type {
  Environment,
  PendingEvent,
  Sandbox,
  Session,
  SessionEvent,
  SessionEventType,
  SessionOutcomeDefinition,
  SessionSpanKind,
  SessionSpanResult,
  SessionToolConfirmationRequest,
} from "../schema/runtime.js"
import { searchAgentSessionContext } from "../sessions/session-context-search.js"
import type { SessionSnapshot, SessionStore } from "../sessions/session-store.js"
import { searchAgentSessionTraces } from "../sessions/session-trace-search.js"
import { summarizeSessionTraces } from "../sessions/session-traces.js"
import type { AgentSkillsConfig, SkillEntry } from "../skills/agent-skills.js"
import {
  findSkillEntryByName,
  loadCompanySkillEntries,
  readSkillEntry,
  searchSkillEntries,
} from "../skills/agent-skills.js"
import {
  readAgentWorkspaceManagedMemoryNotes,
  writeAgentWorkspaceManagedMemoryNotes,
} from "../workspace/bootstrap-files.js"
import {
  type AgentRuntimeToolDefinition,
  createRuntimeToolDefinition,
  ToolConfirmationRequiredError,
} from "./runtime-tool.js"
import { isToolAllowed, type ToolPolicyLike } from "./tool-policy.js"

interface BuildManagedRuntimeToolsInput {
  companyDir: string
  environment: Environment
  session: Session
  wakeId: string
  pendingEvents: PendingEvent[]
  sessionStore: SessionStore
  memoryStore: RuntimeMemoryStore
  runtimeMemorySnapshot?: Awaited<ReturnType<RuntimeMemoryStore["read"]>>
  learningsStore: AgentLearningsStore
  sandbox: Sandbox
  toolPolicy?: ToolPolicyLike
  sandboxEnabled: boolean
  skillsConfig?: AgentSkillsConfig
  contextBudgetRef?: {
    current: ContextBudgetSnapshot | null
  }
  onRunChildSession?: (input: { childSessionId: string; maxCycles: number }) => Promise<{
    cycles: number
    executed: number
    loopStopReason: "idle" | "max_cycles"
    session: Session
    response: string | null
    childStopReason: string
    queuedWakeIds: string[]
    processedEventIds: string[]
  }>
  onToolUse?: (event: Extract<SessionEvent, { type: "agent.tool_use" }>) => Promise<void>
  onSpanEvent?: (
    event: Extract<SessionEvent, { type: "span.started" | "span.completed" }>,
  ) => Promise<void>
}

function normalizePositiveIntegerArg(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function computeTextHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function computeEnvironmentFingerprint(environment: Environment): string {
  return computeTextHash(
    JSON.stringify({
      id: environment.id,
      name: environment.name,
      kind: environment.kind,
      sandbox: environment.sandbox,
      workspaceMountDefaults: environment.workspaceMountDefaults,
    }),
  )
}

function computeSessionResourceContractFingerprint(session: Session): string {
  return computeTextHash(
    JSON.stringify(
      session.resources.map((resource) => ({
        kind: resource.kind,
        mountPath: resource.mountPath,
        access: resource.access,
        scope: typeof resource.metadata?.scope === "string" ? resource.metadata.scope : null,
        prompt: typeof resource.metadata?.prompt === "string" ? resource.metadata.prompt : null,
      })),
    ),
  )
}

function resolveSharedSubstrateTarget(input: { session: Session; targetPath: string }): {
  resource: ReturnType<typeof requireResourceAttachment>
  relativePath: string
  actualPath: string
} {
  const resource = requireResourceAttachment(input.session.resources, "agent_workspace_substrate")
  const resolved = resolveAttachedResourcePath(resource, input.targetPath)
  return {
    resource,
    relativePath: resolved.relativePath,
    actualPath: resolved.actualPath,
  }
}

async function executeSandboxActionOrThrow(
  sandbox: Sandbox,
  action: string,
  input: Record<string, unknown>,
) {
  const result = await sandbox.execute(action, input)
  if (!result.ok) {
    throw new Error(result.error?.message ?? `sandbox action ${action} failed`)
  }
  return result
}

function buildSandboxExecutionResultSchema() {
  return {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      name: { type: "string" },
      text: { type: ["string", "null"] },
      output: {},
      artifacts: {
        type: "array",
        items: { type: "object" },
      },
      usage: { type: "object" },
      error: { type: ["object", "null"] },
    },
  } as const
}

function normalizeLimit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

const PROTECTED_SHELL_ENV_KEYS = new Set([
  "PATH",
  "LANG",
  "TMPDIR",
  "OPENBOA_SESSION_ID",
  "OPENBOA_WORKSPACE_CWD",
])

function normalizeShellEnvKey(value: unknown): string {
  const key = normalizeOptionalText(value)
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    throw new Error("shell environment keys must match [A-Za-z_][A-Za-z0-9_]*")
  }
  if (PROTECTED_SHELL_ENV_KEYS.has(key) || key.startsWith("OPENBOA_")) {
    throw new Error(`shell environment key ${key} is protected`)
  }
  return key
}

function normalizeOutcomeEvaluationStatus(
  value: unknown,
): "missing_outcome" | "blocked" | "not_ready" | "uncertain" | "fail" | "pass" | null {
  return value === "missing_outcome" ||
    value === "blocked" ||
    value === "not_ready" ||
    value === "uncertain" ||
    value === "fail" ||
    value === "pass"
    ? value
    : null
}

function normalizeOutcomeEvaluationTrend(
  value: unknown,
): "first_iteration" | "improving" | "stable" | "regressing" | null {
  return value === "first_iteration" ||
    value === "improving" ||
    value === "stable" ||
    value === "regressing"
    ? value
    : null
}

function outcomeTrendPriority(value: unknown): number {
  switch (value) {
    case "improving":
      return 3
    case "first_iteration":
      return 2
    case "stable":
      return 1
    case "regressing":
      return 0
    default:
      return -1
  }
}

function summarizeShellEnv(env: Record<string, string> | null | undefined) {
  const entries = Object.entries(env ?? {})
  return {
    count: entries.length,
    keys: entries.map(([key]) => key),
    values: Object.fromEntries(entries),
  }
}

function buildSkillReadNextStep(name: string) {
  return {
    tool: "skills_read",
    args: { name },
    rationale: "Read the full skill body before relying on it as an operating procedure.",
  }
}

async function resolveSessionContextBudget(input: {
  companyDir: string
  agentId: string
  currentSessionId: string
  targetSessionId: string
  contextBudgetRef?: { current: ContextBudgetSnapshot | null }
}): Promise<{
  contextBudget: ContextBudgetSnapshot | null
  reason: string | null
}> {
  const runtimeDir = join(
    resolveSessionWorkspaceDir(input.companyDir, input.agentId, input.targetSessionId),
    ".openboa-runtime",
  )
  let contextBudget =
    input.targetSessionId === input.currentSessionId
      ? (input.contextBudgetRef?.current ?? null)
      : null
  let reason: string | null = null

  if (!contextBudget) {
    try {
      const artifact = JSON.parse(
        await readFile(join(runtimeDir, "context-budget.json"), "utf8"),
      ) as {
        sessionId: string
        contextBudget: ContextBudgetSnapshot | null
      }
      contextBudget = artifact.contextBudget ?? null
    } catch {
      reason = "Context budget has not been materialized for the requested session yet."
    }
  }

  return { contextBudget, reason }
}

const SHELL_MUTATION_TOOL_NAMES = new Set([
  "shell_set_cwd",
  "shell_set_env",
  "shell_unset_env",
  "shell_open",
  "shell_restart",
  "shell_run",
  "shell_exec",
  "shell_close",
])

interface ResolvedShellMutationPosture {
  shellState: RuntimeMemorySnapshot["shellState"]
  persistentShell: Record<string, unknown> | null
  recoveryPlan: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
  busyPlan: {
    tool: string
    args: Record<string, unknown>
    rationale: string
    allowlistedReadTools: string[]
    evidencePlan: {
      tool: string
      args: Record<string, unknown>
      rationale: string
    }
    avoidTools: string[]
    liveOutputPreview: {
      stdoutPreview: string | null
      stderrPreview: string | null
    } | null
  } | null
  lastCommandPreview: {
    command: string
    args: string[]
    cwd: string
    updatedAt: string
    outputPreview: string | null
    stdoutPreview: string | null
    stderrPreview: string | null
  } | null
}

function normalizeToolArgsPreview(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function resolveReadOnlyShellAlternative(input: {
  toolName: string
  toolArgsPreview: Record<string, unknown> | null
  posture: ResolvedShellMutationPosture
}): {
  tool: string
  args: Record<string, unknown>
  rationale: string
} | null {
  if (!SHELL_MUTATION_TOOL_NAMES.has(input.toolName) || !input.toolArgsPreview) {
    return null
  }
  if (input.toolName !== "shell_run" && input.toolName !== "shell_exec") {
    return null
  }
  return buildReadOnlyBashAlternative({
    command: normalizeOptionalText(input.toolArgsPreview.command),
    cwd: normalizeOptionalText(input.toolArgsPreview.cwd),
    fallbackCwd: input.posture.shellState?.cwd ?? "/workspace",
    timeoutMs: input.toolArgsPreview.timeoutMs,
    maxOutputChars: input.toolArgsPreview.maxOutputChars,
    rationale:
      "The planned shell command fits the bounded read-only command hand. Prefer bash before using the confirmation-gated writable shell surface.",
  })
}

function resolveShellVirtualPath(baseCwd: string, requestedPath: string): string {
  const normalizedBase = baseCwd.startsWith("/") ? pathPosix.normalize(baseCwd) : `/workspace`
  const normalizedRequested = requestedPath.trim()
  if (normalizedRequested.length === 0 || normalizedRequested === ".") {
    return normalizedBase
  }
  const normalized = normalizedRequested.startsWith("/")
    ? pathPosix.normalize(normalizedRequested)
    : pathPosix.normalize(pathPosix.join(normalizedBase, normalizedRequested))
  return normalized.startsWith("/") ? normalized : `/${normalized}`
}

function resolveListingTargetArg(args: string[]): string | null {
  const nonFlagArgs = args.filter((arg) => !arg.startsWith("-"))
  if (nonFlagArgs.length > 1) {
    return null
  }
  if (args.some((arg) => arg.startsWith("-") && !/^-[Aal1]+$/u.test(arg))) {
    return null
  }
  return nonFlagArgs[0] ?? "."
}

function resolveGrepSearchArgs(args: string[]): {
  query: string
  path: string
  caseSensitive: boolean
} | null {
  const flagArgs = args.filter((arg) => arg.startsWith("-"))
  const nonFlagArgs = args.filter((arg) => !arg.startsWith("-"))
  if (nonFlagArgs.length !== 1 && nonFlagArgs.length !== 2) {
    return null
  }
  if (flagArgs.some((arg) => !/^-[niFrR]+$/u.test(arg))) {
    return null
  }
  const caseSensitive = !flagArgs.some((arg) => arg.includes("i"))
  return {
    query: nonFlagArgs[0],
    path: nonFlagArgs[1] ?? ".",
    caseSensitive,
  }
}

function resolveRipgrepSearchArgs(args: string[]): {
  query: string
  path: string
  caseSensitive: boolean
} | null {
  const flagArgs = args.filter((arg) => arg.startsWith("-"))
  const nonFlagArgs = args.filter((arg) => !arg.startsWith("-"))
  if (nonFlagArgs.length !== 1 && nonFlagArgs.length !== 2) {
    return null
  }
  if (flagArgs.some((arg) => !/^-[ni]+$/u.test(arg))) {
    return null
  }
  const caseSensitive = !flagArgs.some((arg) => arg.includes("i"))
  return {
    query: nonFlagArgs[0],
    path: nonFlagArgs[1] ?? ".",
    caseSensitive,
  }
}

function resolveHeadTailReadArgs(
  command: "head" | "tail",
  args: string[],
): {
  path: string
  lineCount?: number
  tailLines?: number
} | null {
  if (args.length === 1) {
    return command === "head" ? { path: args[0], lineCount: 10 } : { path: args[0], tailLines: 10 }
  }
  if (args.length === 3 && args[0] === "-n") {
    const parsedCount = Number.parseInt(args[1] ?? "", 10)
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
      return null
    }
    return command === "head"
      ? { path: args[2], lineCount: parsedCount }
      : { path: args[2], tailLines: parsedCount }
  }
  return null
}

function resolveSedReadArgs(args: string[]): {
  path: string
  startLine: number
  lineCount: number
} | null {
  if (args.length !== 3 || args[0] !== "-n") {
    return null
  }
  const rangeMatch = /^(?<start>\d+),(?<end>\d+)p$/u.exec(args[1] ?? "")
  if (!rangeMatch?.groups) {
    return null
  }
  const startLine = Number.parseInt(rangeMatch.groups.start, 10)
  const endLine = Number.parseInt(rangeMatch.groups.end, 10)
  if (
    !Number.isFinite(startLine) ||
    !Number.isFinite(endLine) ||
    startLine <= 0 ||
    endLine < startLine
  ) {
    return null
  }
  return {
    path: args[2],
    startLine,
    lineCount: endLine - startLine + 1,
  }
}

function resolveFindGlobArgs(args: string[]): {
  path: string
  pattern: string
  kind?: "file" | "directory"
} | null {
  if (args.length === 2 && args[0] === "-name") {
    const pattern = args[1]?.trim()
    if (!pattern) {
      return null
    }
    return {
      path: ".",
      pattern: pattern.includes("/") ? pattern : `**/${pattern}`,
    }
  }
  if (args.length === 3 && args[1] === "-name") {
    const pattern = args[2]?.trim()
    if (!pattern) {
      return null
    }
    return {
      path: args[0],
      pattern: pattern.includes("/") ? pattern : `**/${pattern}`,
    }
  }
  if (
    args.length === 4 &&
    args[0] === "-type" &&
    (args[1] === "f" || args[1] === "d") &&
    args[2] === "-name"
  ) {
    const rawPattern = args[3]?.trim()
    if (!rawPattern) {
      return null
    }
    const basePattern = rawPattern.includes("/") ? rawPattern : `**/${rawPattern}`
    return {
      path: ".",
      pattern: basePattern,
      kind: args[1] === "d" ? "directory" : "file",
    }
  }
  if (
    args.length === 5 &&
    args[1] === "-type" &&
    (args[2] === "f" || args[2] === "d") &&
    args[3] === "-name"
  ) {
    const rawPattern = args[4]?.trim()
    if (!rawPattern) {
      return null
    }
    const basePattern = rawPattern.includes("/") ? rawPattern : `**/${rawPattern}`
    return {
      path: args[0],
      pattern: basePattern,
      kind: args[2] === "d" ? "directory" : "file",
    }
  }
  return null
}

function resolveWordCountReadArgs(args: string[]): {
  path: string
  lineCount: number
} | null {
  if (args.length === 2 && args[0] === "-l") {
    return {
      path: args[1],
      lineCount: 1,
    }
  }
  return null
}

function resolveFirstClassShellAlternative(input: {
  toolName: string
  toolArgsPreview: Record<string, unknown> | null
  posture: ResolvedShellMutationPosture
}): {
  tool: string
  args: Record<string, unknown>
  rationale: string
} | null {
  if (!SHELL_MUTATION_TOOL_NAMES.has(input.toolName) || !input.toolArgsPreview) {
    return null
  }
  if (input.toolName !== "shell_run" && input.toolName !== "shell_exec") {
    return null
  }
  const projected = projectSimpleShellCommand(
    normalizeOptionalText(input.toolArgsPreview.command) ?? "",
  )
  if (!projected) {
    return null
  }
  const cwd =
    normalizeOptionalText(input.toolArgsPreview.cwd) ??
    input.posture.shellState?.cwd ??
    "/workspace"
  if (projected.command === "cat" && projected.args.length === 1) {
    return {
      tool: "read",
      args: {
        path: resolveShellVirtualPath(cwd, projected.args[0]),
      },
      rationale:
        "The planned shell command is a direct file read. Prefer the first-class managed read tool before opening a writable shell path.",
    }
  }
  const linePreview =
    projected.command === "head" || projected.command === "tail"
      ? resolveHeadTailReadArgs(projected.command, projected.args)
      : null
  if (linePreview) {
    return {
      tool: "read",
      args: {
        path: resolveShellVirtualPath(cwd, linePreview.path),
        ...(linePreview.lineCount ? { lineCount: linePreview.lineCount } : {}),
        ...(linePreview.tailLines ? { tailLines: linePreview.tailLines } : {}),
      },
      rationale:
        "The planned shell command is a bounded file preview. Prefer the first-class managed read tool before opening a writable shell path.",
    }
  }
  const rangePreview = projected.command === "sed" ? resolveSedReadArgs(projected.args) : null
  if (rangePreview) {
    return {
      tool: "read",
      args: {
        path: resolveShellVirtualPath(cwd, rangePreview.path),
        startLine: rangePreview.startLine,
        lineCount: rangePreview.lineCount,
      },
      rationale:
        "The planned shell command is a bounded file range preview. Prefer the first-class managed read tool before opening a writable shell path.",
    }
  }
  const listingTarget = projected.command === "ls" ? resolveListingTargetArg(projected.args) : null
  if (projected.command === "ls" && listingTarget) {
    return {
      tool: "glob",
      args: {
        path: resolveShellVirtualPath(cwd, listingTarget),
        pattern: "*",
        limit: 80,
      },
      rationale:
        "The planned shell command is a direct directory listing. Prefer the first-class managed glob tool before opening a writable shell path.",
    }
  }
  const findGlob = projected.command === "find" ? resolveFindGlobArgs(projected.args) : null
  if (projected.command === "find" && findGlob) {
    return {
      tool: "glob",
      args: {
        path: resolveShellVirtualPath(cwd, findGlob.path),
        pattern: findGlob.pattern,
        ...(findGlob.kind ? { kind: findGlob.kind } : {}),
        limit: 80,
      },
      rationale:
        "The planned shell command is a bounded workspace file search. Prefer the first-class managed glob tool before opening a writable shell path.",
    }
  }
  const wordCountRead = projected.command === "wc" ? resolveWordCountReadArgs(projected.args) : null
  if (projected.command === "wc" && wordCountRead) {
    return {
      tool: "read",
      args: {
        path: resolveShellVirtualPath(cwd, wordCountRead.path),
        lineCount: wordCountRead.lineCount,
      },
      rationale:
        "The planned shell command is a bounded line-count inspection. Prefer the first-class managed read tool before opening a writable shell path.",
    }
  }
  const grepSearch = projected.command === "grep" ? resolveGrepSearchArgs(projected.args) : null
  if (projected.command === "grep" && grepSearch) {
    return {
      tool: "grep",
      args: {
        path: resolveShellVirtualPath(cwd, grepSearch.path),
        query: grepSearch.query,
        ...(grepSearch.caseSensitive ? {} : { caseSensitive: false }),
      },
      rationale:
        "The planned shell command is a direct workspace search. Prefer the first-class managed grep tool before opening a writable shell path.",
    }
  }
  const ripgrepSearch = projected.command === "rg" ? resolveRipgrepSearchArgs(projected.args) : null
  if (projected.command === "rg" && ripgrepSearch) {
    return {
      tool: "grep",
      args: {
        path: resolveShellVirtualPath(cwd, ripgrepSearch.path),
        query: ripgrepSearch.query,
        caseSensitive: ripgrepSearch.caseSensitive,
        limit: 40,
      },
      rationale:
        "The planned shell command is a bounded workspace search. Prefer the first-class managed grep tool before opening a writable shell path.",
    }
  }
  return null
}

function buildShellReadFirstAlternatives(input: {
  shellState: RuntimeMemorySnapshot["shellState"]
  shellPosture: ResolvedShellMutationPosture
  contextPressure: {
    level: "low" | "moderate" | "high"
    reasons: string[]
    recommendedTools: string[]
  } | null
  includeShellDescribe?: boolean
  preferredAlternative?: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
}): Array<{
  tool: string
  args: Record<string, unknown>
  rationale: string
}> {
  const cwd = input.shellState?.cwd ?? "/workspace"
  const alternatives: Array<{
    tool: string
    args: Record<string, unknown>
    rationale: string
  }> = [
    ...(input.preferredAlternative ? [input.preferredAlternative] : []),
    ...(input.includeShellDescribe === false
      ? []
      : [
          {
            tool: "shell_describe",
            args: {},
            rationale:
              "Inspect the durable session shell posture before reaching for a writable shell mutation.",
          },
        ]),
    {
      tool: "bash",
      args: {
        command: "pwd",
        cwd,
      },
      rationale:
        "Use the bounded read-only shell hand to confirm the current session working directory first.",
    },
  ]
  if (input.shellPosture.lastCommandPreview || input.shellPosture.busyPlan) {
    alternatives.push({
      tool: "shell_read_last_output",
      args: {},
      rationale:
        "Inspect the latest durable shell output before deciding whether another shell mutation is actually necessary.",
    })
  }
  if (input.contextPressure && input.contextPressure.level !== "low") {
    alternatives.push({
      tool: "session_describe_context",
      args: {},
      rationale:
        "Current context pressure is elevated. Inspect context budget before widening the execution surface.",
    })
  }
  return alternatives
}

async function resolveShellMutationPosture(input: {
  sessionId: string
  currentSessionId: string
  agentId: string
  memoryStore: RuntimeMemoryStore
  sandbox: Sandbox
}): Promise<ResolvedShellMutationPosture> {
  const runtimeMemory = await input.memoryStore.read(input.agentId, input.sessionId)
  let livePersistentShell: Record<string, unknown> | null = null
  if (input.sessionId === input.currentSessionId) {
    try {
      const inspected = await executeSandboxActionOrThrow(
        input.sandbox,
        "inspect_persistent_shell",
        {},
      )
      const output =
        inspected.output && typeof inspected.output === "object" && !Array.isArray(inspected.output)
          ? (inspected.output as Record<string, unknown>)
          : {}
      livePersistentShell =
        output.persistentShell &&
        typeof output.persistentShell === "object" &&
        !Array.isArray(output.persistentShell)
          ? (output.persistentShell as Record<string, unknown>)
          : null
    } catch {
      livePersistentShell = null
    }
  }
  const persistentShell =
    livePersistentShell ??
    (runtimeMemory.shellState?.persistentShell
      ? {
          ...runtimeMemory.shellState.persistentShell,
          status:
            input.sessionId === input.currentSessionId &&
            runtimeMemory.shellState.persistentShell.status === "active"
              ? "closed"
              : runtimeMemory.shellState.persistentShell.status,
        }
      : null)
  const recoveryPlan =
    persistentShell && persistentShell.status === "closed"
      ? {
          tool: "shell_restart",
          args: {
            cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          },
          rationale:
            "The durable session shell state exists but the live shell process is closed. Restart it before relying on shell-local continuity.",
        }
      : persistentShell === null
        ? {
            tool: "shell_open",
            args: {
              cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
            },
            rationale:
              "No persistent shell is active for this session yet. Open one before multi-step shell work that should preserve cwd or exports.",
          }
        : null
  const busyPlan =
    persistentShell && persistentShell.status === "active" && persistentShell.busy === true
      ? {
          tool: "shell_wait",
          args: {
            timeoutMs: 1_000,
          },
          rationale:
            "A persistent shell command is still running. Wait on the live shell first, then prefer bounded read-only shell evidence before issuing another shell mutation.",
          allowlistedReadTools: [
            "shell_wait",
            "shell_describe",
            "shell_history",
            "shell_read_last_output",
            "bash",
            "read",
            "glob",
            "grep",
            "session_get_snapshot",
            "retrieval_search",
          ],
          evidencePlan: {
            tool: "shell_read_last_output",
            args: {},
            rationale:
              "If you only need bounded evidence from the running shell step, inspect the latest durable shell output preview before attempting another shell mutation.",
          },
          avoidTools: ["shell_run", "shell_exec", "shell_restart", "shell_close"],
          liveOutputPreview:
            persistentShell.currentStdoutPreview || persistentShell.currentStderrPreview
              ? {
                  stdoutPreview:
                    typeof persistentShell.currentStdoutPreview === "string"
                      ? persistentShell.currentStdoutPreview
                      : null,
                  stderrPreview:
                    typeof persistentShell.currentStderrPreview === "string"
                      ? persistentShell.currentStderrPreview
                      : null,
                }
              : null,
        }
      : null
  return {
    shellState: runtimeMemory.shellState,
    persistentShell,
    recoveryPlan,
    busyPlan,
    lastCommandPreview: runtimeMemory.shellState?.lastCommand
      ? {
          command: runtimeMemory.shellState.lastCommand.command,
          args: runtimeMemory.shellState.lastCommand.args,
          cwd: runtimeMemory.shellState.lastCommand.cwd,
          updatedAt: runtimeMemory.shellState.lastCommand.updatedAt,
          outputPreview: runtimeMemory.shellState.lastCommand.outputPreview,
          stdoutPreview: runtimeMemory.shellState.lastCommand.stdoutPreview ?? null,
          stderrPreview: runtimeMemory.shellState.lastCommand.stderrPreview ?? null,
        }
      : null,
  }
}

function resolveShellMutationNextStep(input: {
  toolName: string
  posture: ResolvedShellMutationPosture
  preferredReadFirstAlternative?: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
  readOnlyAlternative?: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
}): {
  tool: string
  args: Record<string, unknown>
  rationale: string
} | null {
  if (!SHELL_MUTATION_TOOL_NAMES.has(input.toolName)) {
    return null
  }
  if (input.preferredReadFirstAlternative) {
    return input.preferredReadFirstAlternative
  }
  if (input.readOnlyAlternative) {
    return input.readOnlyAlternative
  }
  if (input.posture.busyPlan) {
    return {
      tool: input.posture.busyPlan.tool,
      args: input.posture.busyPlan.args,
      rationale: input.posture.busyPlan.rationale,
    }
  }
  if (input.toolName === "shell_exec" && input.posture.recoveryPlan) {
    return input.posture.recoveryPlan
  }
  if (input.toolName === "shell_run" || input.toolName === "shell_exec") {
    return {
      tool: "shell_describe",
      args: {},
      rationale:
        "Inspect the current session shell posture first so the next shell step starts from the right cwd, live state, and recent evidence.",
    }
  }
  return null
}

function buildShellArtifactPaths(input: {
  memoryStore: RuntimeMemoryStore
  agentId: string
  sessionId: string
}) {
  return {
    shellStateJson: input.memoryStore.shellRuntimeStatePath(input.agentId, input.sessionId),
    shellHistoryJson: input.memoryStore.shellRuntimeHistoryJsonPath(input.agentId, input.sessionId),
    shellHistoryMarkdown: input.memoryStore.shellRuntimeHistoryMarkdownPath(
      input.agentId,
      input.sessionId,
    ),
    shellLastOutputJson: input.memoryStore.shellRuntimeLastOutputJsonPath(
      input.agentId,
      input.sessionId,
    ),
    shellLastOutputMarkdown: input.memoryStore.shellRuntimeLastOutputMarkdownPath(
      input.agentId,
      input.sessionId,
    ),
  }
}

function findShellCommandById(shellState: RuntimeMemorySnapshot["shellState"], commandId: string) {
  if (!shellState) {
    return null
  }
  if (shellState.lastCommand?.commandId === commandId) {
    return shellState.lastCommand
  }
  return (
    shellState.recentCommands.find(
      (command: NonNullable<RuntimeMemorySnapshot["shellState"]>["recentCommands"][number]) =>
        command.commandId === commandId,
    ) ?? null
  )
}

function buildSessionRuntimeArtifactPaths(input: {
  companyDir: string
  agentId: string
  sessionId: string
}) {
  const runtimeDir = join(
    resolveSessionWorkspaceDir(input.companyDir, input.agentId, input.sessionId),
    ".openboa-runtime",
  )
  return {
    sessionRuntimeJson: join(runtimeDir, "session-runtime.json"),
    sessionRuntimeMarkdown: join(runtimeDir, "session-runtime.md"),
    sessionStatusJson: join(runtimeDir, "session-status.json"),
    contextBudgetJson: join(runtimeDir, "context-budget.json"),
    contextBudgetMarkdown: join(runtimeDir, "context-budget.md"),
    outcomeJson: join(runtimeDir, "outcome.json"),
    outcomeGradeJson: join(runtimeDir, "outcome-grade.json"),
    outcomeGradeMarkdown: join(runtimeDir, "outcome-grade.md"),
    outcomeEvaluationJson: join(runtimeDir, "outcome-evaluation.json"),
    outcomeEvaluationMarkdown: join(runtimeDir, "outcome-evaluation.md"),
    outcomeEvaluationsJson: join(runtimeDir, "outcome-evaluations.json"),
    outcomeEvaluationsMarkdown: join(runtimeDir, "outcome-evaluations.md"),
    outcomeRepairMarkdown: join(runtimeDir, "outcome-repair.md"),
    eventFeedJson: join(runtimeDir, "event-feed.json"),
    eventFeedMarkdown: join(runtimeDir, "event-feed.md"),
    wakeTracesJson: join(runtimeDir, "wake-traces.json"),
    sessionRelationsJson: join(runtimeDir, "session-relations.json"),
    permissionsJson: join(runtimeDir, "permissions.json"),
    permissionPostureJson: join(runtimeDir, "permission-posture.json"),
    permissionPostureMarkdown: join(runtimeDir, "permission-posture.md"),
    environmentJson: join(runtimeDir, "environment.json"),
    agentSetupJson: join(runtimeDir, "agent-setup.json"),
    agentSetupMarkdown: join(runtimeDir, "agent-setup.md"),
    managedToolsJson: join(runtimeDir, "managed-tools.json"),
    skillsJson: join(runtimeDir, "skills.json"),
    vaultsJson: join(runtimeDir, "vaults.json"),
    shellStateJson: join(runtimeDir, "shell-state.json"),
    shellHistoryJson: join(runtimeDir, "shell-history.json"),
    shellHistoryMarkdown: join(runtimeDir, "shell-history.md"),
    shellLastOutputJson: join(runtimeDir, "shell-last-output.json"),
    shellLastOutputMarkdown: join(runtimeDir, "shell-last-output.md"),
  }
}

async function readSessionAgentSetupFingerprint(input: {
  companyDir: string
  agentId: string
  sessionId: string
}): Promise<string | null> {
  const artifact = await readSessionAgentSetupArtifact(input)
  if (!artifact) {
    return null
  }
  return typeof artifact.fingerprint === "string" && artifact.fingerprint.trim().length > 0
    ? artifact.fingerprint
    : null
}

async function readSessionAgentSetupArtifact(input: {
  companyDir: string
  agentId: string
  sessionId: string
}): Promise<Record<string, unknown> | null> {
  try {
    const artifact = JSON.parse(
      await readFile(
        join(
          resolveSessionWorkspaceDir(input.companyDir, input.agentId, input.sessionId),
          ".openboa-runtime",
          "agent-setup.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>
    return artifact
  } catch {
    return null
  }
}

function readSetupFingerprint(
  artifact: Record<string, unknown> | null,
  key:
    | "fingerprint"
    | "systemPromptFingerprint"
    | "toolsFingerprint"
    | "skillsFingerprint"
    | "environmentFingerprint"
    | "resourceContractFingerprint"
    | "vaultFingerprint",
): string | null {
  if (!artifact) {
    return null
  }
  if (key === "fingerprint") {
    return typeof artifact.fingerprint === "string" ? artifact.fingerprint : null
  }
  if (key === "systemPromptFingerprint") {
    const systemPrompt = artifact.systemPrompt
    return systemPrompt &&
      typeof systemPrompt === "object" &&
      !Array.isArray(systemPrompt) &&
      typeof (systemPrompt as Record<string, unknown>).fingerprint === "string"
      ? ((systemPrompt as Record<string, unknown>).fingerprint as string)
      : null
  }
  const section =
    key === "toolsFingerprint"
      ? artifact.tools
      : key === "skillsFingerprint"
        ? artifact.skills
        : key === "environmentFingerprint"
          ? artifact.environment
          : key === "resourceContractFingerprint"
            ? artifact.resourceContract
            : artifact.vaults
  return section &&
    typeof section === "object" &&
    !Array.isArray(section) &&
    typeof (section as Record<string, unknown>).fingerprint === "string"
    ? ((section as Record<string, unknown>).fingerprint as string)
    : null
}

const OUTCOME_GATED_TOOL_NAMES = new Set([
  "memory_promote_note",
  "resources_promote_to_substrate",
  "resources_restore_version",
])

function normalizeEventTypes(value: unknown): SessionEventType[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const knownTypes = new Set<SessionEventType>([
    "user.message",
    "user.define_outcome",
    "user.interrupt",
    "user.tool_confirmation",
    "user.custom_tool_result",
    "session.child_created",
    "session.child_idle",
    "session.status_changed",
    "session.status_idle",
    "span.started",
    "span.completed",
    "agent.message",
    "agent.tool_use",
    "agent.custom_tool_use",
  ])
  const selected = value.filter(
    (item): item is SessionEventType =>
      typeof item === "string" && knownTypes.has(item as SessionEventType),
  )
  return selected.length > 0 ? [...new Set(selected)] : undefined
}

function buildManagedMemoryStoreSchema() {
  return {
    type: "object",
    properties: {
      target: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      scope: { type: "string" },
      writable: { type: "boolean" },
      searchable: { type: "boolean" },
    },
  } as const
}

function normalizeRetrievalBackends(
  value: unknown,
): Array<"memory" | "session_context" | "session_trace" | "vector"> | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const knownBackends = new Set(["memory", "session_context", "session_trace", "vector"])
  const selected = value.filter(
    (item): item is "memory" | "session_context" | "session_trace" | "vector" =>
      typeof item === "string" && knownBackends.has(item),
  )
  return selected.length > 0 ? [...new Set(selected)] : undefined
}

function normalizeRetrievalLineage(
  value: unknown,
): "related" | "parent" | "children" | "siblings" | null {
  return value === "related" || value === "parent" || value === "children" || value === "siblings"
    ? value
    : null
}

async function resolveScopedSessionId(input: {
  requestedSessionId: string | null
  session: Session
  sessionStore: SessionStore
}): Promise<string> {
  if (!input.requestedSessionId || input.requestedSessionId === input.session.id) {
    return input.session.id
  }
  const sessions = await input.sessionStore.listAgentSessions(input.session.agentId)
  const allowed = sessions.some((session) => session.id === input.requestedSessionId)
  if (!allowed) {
    throw new Error(
      `Session ${input.requestedSessionId} is not available to agent ${input.session.agentId}`,
    )
  }
  return input.requestedSessionId
}

function buildToolUseEvent(input: {
  tool: AgentRuntimeToolDefinition
  wakeId: string
  requestId?: string | null
  args: unknown
  output: string | null
}): Extract<SessionEvent, { type: "agent.tool_use" }> {
  const createdAt = nowIsoString()
  return {
    id: makeUuidV7(),
    type: "agent.tool_use",
    createdAt,
    processedAt: createdAt,
    wakeId: input.wakeId,
    requestId: input.requestId ?? null,
    toolName: input.tool.name,
    ownership: input.tool.ownership,
    permissionPolicy: input.tool.permissionPolicy,
    input:
      input.args && typeof input.args === "object" && !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : {},
    output: input.output,
  }
}

function buildSpanStartedEvent(input: {
  wakeId: string
  spanId: string
  parentSpanId: string | null
  spanKind: SessionSpanKind
  name: string
  summary: string | null
}): Extract<SessionEvent, { type: "span.started" }> {
  const createdAt = nowIsoString()
  return {
    id: makeUuidV7(),
    type: "span.started",
    createdAt,
    processedAt: createdAt,
    wakeId: input.wakeId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    spanKind: input.spanKind,
    name: input.name,
    summary: input.summary,
  }
}

function buildSpanCompletedEvent(input: {
  wakeId: string
  spanId: string
  parentSpanId: string | null
  spanKind: SessionSpanKind
  name: string
  result: SessionSpanResult
  summary: string | null
}): Extract<SessionEvent, { type: "span.completed" }> {
  const createdAt = nowIsoString()
  return {
    id: makeUuidV7(),
    type: "span.completed",
    createdAt,
    processedAt: createdAt,
    wakeId: input.wakeId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    spanKind: input.spanKind,
    name: input.name,
    result: input.result,
    summary: input.summary,
  }
}

function resolvePendingToolConfirmationDecision(input: {
  request: SessionToolConfirmationRequest | null
  pendingEvents: PendingEvent[]
}): Extract<PendingEvent, { type: "user.tool_confirmation" }> | null {
  if (!input.request) {
    return null
  }
  return (
    [...input.pendingEvents]
      .reverse()
      .find(
        (event): event is Extract<PendingEvent, { type: "user.tool_confirmation" }> =>
          event.type === "user.tool_confirmation" && event.requestId === input.request?.id,
      ) ?? null
  )
}

function createLoggedManagedTool(
  input: Omit<Parameters<typeof createRuntimeToolDefinition>[0], "execute"> & {
    wakeId?: string
    execute: (args: unknown) => Promise<string>
    onToolUse?: BuildManagedRuntimeToolsInput["onToolUse"]
    onSpanEvent?: BuildManagedRuntimeToolsInput["onSpanEvent"]
    pendingToolConfirmationRequest?: SessionToolConfirmationRequest | null
    pendingToolConfirmationDecision?: Extract<
      PendingEvent,
      { type: "user.tool_confirmation" }
    > | null
  },
): AgentRuntimeToolDefinition {
  const tool = createRuntimeToolDefinition({
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    ownership: input.ownership,
    permissionPolicy: input.permissionPolicy,
    effects: input.effects,
    readOnly: input.readOnly,
    destructive: input.destructive,
    interruptBehavior: input.interruptBehavior,
    execute: async () => "",
  })

  tool.execute = async (args: unknown) => {
    const toolSpanId = makeUuidV7()
    await input.onSpanEvent?.(
      buildSpanStartedEvent({
        wakeId: input.wakeId ?? "tool-run",
        spanId: toolSpanId,
        parentSpanId: input.wakeId ?? null,
        spanKind: "tool",
        name: tool.name,
        summary: tool.description,
      }),
    )
    if (tool.permissionPolicy === "always_ask") {
      const sameToolPendingRequest =
        input.pendingToolConfirmationRequest?.toolName === tool.name
          ? input.pendingToolConfirmationRequest
          : null
      const matchedDecision =
        sameToolPendingRequest &&
        input.pendingToolConfirmationDecision?.requestId === sameToolPendingRequest.id
          ? input.pendingToolConfirmationDecision
          : null

      if (!matchedDecision?.allowed) {
        if (matchedDecision && matchedDecision.allowed === false) {
          await input.onSpanEvent?.(
            buildSpanCompletedEvent({
              wakeId: input.wakeId ?? "tool-run",
              spanId: toolSpanId,
              parentSpanId: input.wakeId ?? null,
              spanKind: "tool",
              name: tool.name,
              result: "blocked",
              summary: `The user denied confirmation for ${tool.name}.`,
            }),
          )
          throw new Error(
            `The user denied confirmation for ${tool.name}${matchedDecision.note ? `: ${matchedDecision.note}` : ""}`,
          )
        }

        await input.onSpanEvent?.(
          buildSpanCompletedEvent({
            wakeId: input.wakeId ?? "tool-run",
            spanId: toolSpanId,
            parentSpanId: input.wakeId ?? null,
            spanKind: "tool",
            name: tool.name,
            result: "blocked",
            summary: `Awaiting confirmation for ${tool.name}.`,
          }),
        )
        throw new ToolConfirmationRequiredError(
          sameToolPendingRequest ?? {
            id: makeUuidV7(),
            toolName: tool.name,
            ownership: tool.ownership,
            permissionPolicy: tool.permissionPolicy,
            input:
              args && typeof args === "object" && !Array.isArray(args)
                ? (args as Record<string, unknown>)
                : {},
            requestedAt: nowIsoString(),
          },
        )
      }
    }

    const effectiveArgs =
      tool.permissionPolicy === "always_ask" &&
      input.pendingToolConfirmationRequest?.toolName === tool.name &&
      input.pendingToolConfirmationDecision?.requestId ===
        input.pendingToolConfirmationRequest.id &&
      input.pendingToolConfirmationDecision.allowed
        ? input.pendingToolConfirmationRequest.input
        : args

    try {
      const output = await input.execute(effectiveArgs)
      await input.onSpanEvent?.(
        buildSpanCompletedEvent({
          wakeId: input.wakeId ?? "tool-run",
          spanId: toolSpanId,
          parentSpanId: input.wakeId ?? null,
          spanKind: "tool",
          name: tool.name,
          result: "success",
          summary: `${tool.name} completed successfully.`,
        }),
      )
      await input.onToolUse?.(
        buildToolUseEvent({
          tool,
          wakeId: input.wakeId ?? "tool-run",
          requestId:
            input.pendingToolConfirmationRequest?.toolName === tool.name
              ? input.pendingToolConfirmationRequest.id
              : null,
          args: effectiveArgs,
          output,
        }),
      )
      return output
    } catch (error) {
      if (error instanceof ToolConfirmationRequiredError) {
        throw error
      }
      await input.onSpanEvent?.(
        buildSpanCompletedEvent({
          wakeId: input.wakeId ?? "tool-run",
          spanId: toolSpanId,
          parentSpanId: input.wakeId ?? null,
          spanKind: "tool",
          name: tool.name,
          result: "error",
          summary: error instanceof Error ? error.message : String(error),
        }),
      )
      const renderedError = asJson({
        error: error instanceof Error ? error.message : String(error),
      })
      await input.onToolUse?.(
        buildToolUseEvent({
          tool,
          wakeId: input.wakeId ?? "tool-run",
          requestId:
            input.pendingToolConfirmationRequest?.toolName === tool.name
              ? input.pendingToolConfirmationRequest.id
              : null,
          args: effectiveArgs,
          output: renderedError,
        }),
      )
      throw error
    }
  }

  return tool
}

function filterAllowedTools(
  tools: AgentRuntimeToolDefinition[],
  toolPolicy: ToolPolicyLike | undefined,
): AgentRuntimeToolDefinition[] {
  return tools.filter((tool) => isToolAllowed(toolPolicy, tool.name))
}

async function summarizeSession(input: {
  companyDir: string
  snapshot: SessionSnapshot
  runtimeMemory: Awaited<ReturnType<RuntimeMemoryStore["read"]>>
  sandbox?: Sandbox
  currentSessionId?: string | null
}): Promise<Record<string, unknown>> {
  const { companyDir, snapshot, runtimeMemory } = input
  const activeOutcome = deriveSessionActiveOutcome({ snapshot, runtimeMemory })
  const outcomeGrade = gradeSessionOutcome({ snapshot, runtimeMemory })
  const baseEvaluation = evaluateSessionOutcome({ snapshot, runtimeMemory })
  let outcomeEvaluation = baseEvaluation
  if (input.sandbox && input.currentSessionId === snapshot.session.id) {
    try {
      const inspected = await executeSandboxActionOrThrow(
        input.sandbox,
        "inspect_persistent_shell",
        {},
      )
      const output =
        inspected.output && typeof inspected.output === "object" && !Array.isArray(inspected.output)
          ? (inspected.output as Record<string, unknown>)
          : {}
      const persistentShell =
        output.persistentShell &&
        typeof output.persistentShell === "object" &&
        !Array.isArray(output.persistentShell)
          ? (output.persistentShell as Record<string, unknown>)
          : null
      outcomeEvaluation = applyLiveShellOutcomeGuard({
        evaluation: baseEvaluation,
        liveShell:
          persistentShell && typeof persistentShell.shellId === "string"
            ? {
                shellId: persistentShell.shellId,
                status: persistentShell.status === "closed" ? "closed" : "active",
                busy: persistentShell.busy === true,
                currentCommand:
                  typeof persistentShell.currentCommand === "string"
                    ? persistentShell.currentCommand
                    : null,
                currentCommandStartedAt:
                  typeof persistentShell.currentCommandStartedAt === "string"
                    ? persistentShell.currentCommandStartedAt
                    : null,
              }
            : null,
      })
    } catch {
      outcomeEvaluation = baseEvaluation
    }
  }
  const outcomeEvaluationHistory = runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? []
  const checkpointUpdatedAt = runtimeMemory.checkpoint?.updatedAt ?? null
  const lastActivityAt = checkpointUpdatedAt ?? snapshot.session.updatedAt
  const pendingAction =
    snapshot.session.pendingToolConfirmationRequest !== null
      ? {
          requiresAction: true,
          pendingActionKind: "tool_confirmation" as const,
          pendingActionToolName: snapshot.session.pendingToolConfirmationRequest.toolName,
        }
      : snapshot.session.pendingCustomToolRequest !== null
        ? {
            requiresAction: true,
            pendingActionKind: "custom_tool" as const,
            pendingActionToolName: snapshot.session.pendingCustomToolRequest.name,
          }
        : {
            requiresAction: snapshot.session.stopReason === "requires_action",
            pendingActionKind: null,
            pendingActionToolName: null,
          }
  return {
    sessionId: snapshot.session.id,
    agentId: snapshot.session.agentId,
    parentSessionId: snapshot.session.metadata?.parentSessionId ?? null,
    environmentId: snapshot.session.environmentId,
    resourceContractFingerprint: computeSessionResourceContractFingerprint(snapshot.session),
    status: snapshot.session.status,
    createdAt: snapshot.session.createdAt,
    updatedAt: snapshot.session.updatedAt,
    lastActivityAt,
    stopReason: snapshot.session.stopReason,
    requiresAction: pendingAction.requiresAction,
    pendingActionKind: pendingAction.pendingActionKind,
    pendingActionToolName: pendingAction.pendingActionToolName,
    turns: snapshot.session.usage.turns,
    pendingCustomToolRequest: snapshot.session.pendingCustomToolRequest,
    pendingToolConfirmationRequest: snapshot.session.pendingToolConfirmationRequest,
    resourceCount: snapshot.session.resources.length,
    pendingEventCount: snapshot.events.filter((event: SessionEvent) => event.processedAt === null)
      .length,
    checkpointUpdatedAt,
    lastWakeId: runtimeMemory.checkpoint?.lastWakeId ?? null,
    latestSummary: runtimeMemory.checkpoint?.lastSummary ?? null,
    activeOutcome,
    outcomeGrade,
    outcomeStatus: outcomeEvaluation.status,
    outcomeTrend: outcomeEvaluation.trend,
    outcomeTrendSummary: outcomeEvaluation.trendSummary,
    promotionReady: outcomeEvaluation.promotionReady,
    outcomeEvaluation,
    nextOutcomeStep:
      activeOutcome && outcomeEvaluation.promotionReady === false
        ? resolveOutcomeGateNextStep({
            sessionId: snapshot.session.id,
            evaluation: outcomeEvaluation,
          })
        : null,
    outcomeEvaluationHistoryCount: outcomeEvaluationHistory.length,
    outcomeEvaluationLatestIteration: outcomeEvaluationHistory.at(-1)?.iteration ?? null,
    eventCursor: runtimeMemory.checkpoint?.eventCursor ?? null,
    shellState: runtimeMemory.shellState,
    artifactPaths: buildSessionRuntimeArtifactPaths({
      companyDir,
      agentId: snapshot.session.agentId,
      sessionId: snapshot.session.id,
    }),
  }
}

function buildSessionChildCountMap(sessions: Session[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const parentSessionId = session.metadata?.parentSessionId
    if (!parentSessionId) {
      continue
    }
    counts.set(parentSessionId, (counts.get(parentSessionId) ?? 0) + 1)
  }
  return counts
}

function sessionRelationPriority(value: unknown): number {
  if (value === "parent" || value === "child") {
    return 2
  }
  if (value === "sibling") {
    return 1
  }
  return 0
}

async function summarizeSessionWithSetupFingerprint(input: {
  companyDir: string
  agentId: string
  snapshot: SessionSnapshot
  runtimeMemory: Awaited<ReturnType<RuntimeMemoryStore["read"]>>
  sandbox?: Sandbox
  currentSessionId?: string | null
}): Promise<Record<string, unknown>> {
  return {
    ...(await summarizeSession({
      companyDir: input.companyDir,
      snapshot: input.snapshot,
      runtimeMemory: input.runtimeMemory,
      sandbox: input.sandbox,
      currentSessionId: input.currentSessionId ?? null,
    })),
    agentSetupFingerprint: await readSessionAgentSetupFingerprint({
      companyDir: input.companyDir,
      agentId: input.agentId,
      sessionId: input.snapshot.session.id,
    }),
  }
}

async function evaluateScopedSessionOutcome(input: {
  session: Session
  sessionStore: SessionStore
  memoryStore: RuntimeMemoryStore
  requestedSessionId?: string | null
  sandbox?: Sandbox
}) {
  const targetSessionId = await resolveScopedSessionId({
    requestedSessionId: input.requestedSessionId ?? null,
    session: input.session,
    sessionStore: input.sessionStore,
  })
  const [snapshot, runtimeMemory] = await Promise.all([
    input.sessionStore.getSession(targetSessionId),
    input.memoryStore.read(input.session.agentId, targetSessionId),
  ])
  const activeOutcome = deriveSessionActiveOutcome({ snapshot, runtimeMemory })
  const grade = gradeSessionOutcome({ snapshot, runtimeMemory })
  const baseEvaluation = evaluateSessionOutcome({ snapshot, runtimeMemory })
  let evaluation = baseEvaluation
  if (input.sandbox && targetSessionId === input.session.id) {
    try {
      const inspected = await executeSandboxActionOrThrow(
        input.sandbox,
        "inspect_persistent_shell",
        {},
      )
      const output =
        inspected.output && typeof inspected.output === "object" && !Array.isArray(inspected.output)
          ? (inspected.output as Record<string, unknown>)
          : {}
      const persistentShell =
        output.persistentShell &&
        typeof output.persistentShell === "object" &&
        !Array.isArray(output.persistentShell)
          ? (output.persistentShell as Record<string, unknown>)
          : null
      evaluation = applyLiveShellOutcomeGuard({
        evaluation: baseEvaluation,
        liveShell:
          persistentShell && typeof persistentShell.shellId === "string"
            ? {
                shellId: persistentShell.shellId,
                status: persistentShell.status === "closed" ? "closed" : "active",
                busy: persistentShell.busy === true,
                currentCommand:
                  typeof persistentShell.currentCommand === "string"
                    ? persistentShell.currentCommand
                    : null,
                currentCommandStartedAt:
                  typeof persistentShell.currentCommandStartedAt === "string"
                    ? persistentShell.currentCommandStartedAt
                    : null,
              }
            : null,
      })
    } catch {
      evaluation = baseEvaluation
    }
  }
  return {
    sessionId: targetSessionId,
    snapshot,
    runtimeMemory,
    activeOutcome,
    grade,
    evaluation,
    evaluationHistory: runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? [],
  }
}

async function enforceOutcomePromotionGate(input: {
  toolName: string
  session: Session
  sessionStore: SessionStore
  memoryStore: RuntimeMemoryStore
  sandbox: Sandbox
  requireOutcomePass: boolean | null
}) {
  const evaluated = await evaluateScopedSessionOutcome({
    session: input.session,
    sessionStore: input.sessionStore,
    memoryStore: input.memoryStore,
    sandbox: input.sandbox,
  })
  const shouldEnforce =
    input.requireOutcomePass === null ? evaluated.activeOutcome !== null : input.requireOutcomePass
  if (!shouldEnforce || evaluated.evaluation.promotionReady) {
    return evaluated
  }
  const nextTool = evaluated.evaluation.nextSuggestedTool
  throw new Error(
    [
      `${input.toolName} requires outcome_evaluate to return status=pass before promoting shared state.`,
      `Current status=${evaluated.evaluation.status}.`,
      `Summary=${evaluated.evaluation.summary}`,
      nextTool ? `Next tool: ${nextTool.tool} ${JSON.stringify(nextTool.args)}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
  )
}

function resolveOutcomeGateNextStep(input: {
  sessionId: string
  evaluation: SessionOutcomeEvaluation
}): {
  tool: string
  args: Record<string, unknown>
  rationale: string
} {
  if (input.evaluation.promotionReady === false) {
    if (input.evaluation.trend === "stable" || input.evaluation.trend === "regressing") {
      return {
        tool: "outcome_history",
        args: { sessionId: input.sessionId },
        rationale:
          "Evaluator posture is no longer improving. Inspect recent outcome history before attempting another shared mutation.",
      }
    }
    if (input.evaluation.nextSuggestedTool) {
      return input.evaluation.nextSuggestedTool
    }
  }

  return {
    tool: "outcome_evaluate",
    args: { sessionId: input.sessionId },
    rationale:
      "This shared mutation surface is evaluator-gated. Inspect the current evaluator verdict before attempting promotion.",
  }
}

export async function buildManagedRuntimeTools(
  input: BuildManagedRuntimeToolsInput,
): Promise<AgentRuntimeToolDefinition[]> {
  const skillEntries = await loadCompanySkillEntries(input.companyDir, input.skillsConfig).catch(
    () => [] as SkillEntry[],
  )
  const createManagedTool = (
    definition: Omit<Parameters<typeof createLoggedManagedTool>[0], "wakeId">,
  ) =>
    createLoggedManagedTool({
      ...definition,
      wakeId: input.wakeId,
      onSpanEvent: definition.onSpanEvent ?? input.onSpanEvent,
    })
  const pendingToolConfirmationDecision = resolvePendingToolConfirmationDecision({
    request: input.session.pendingToolConfirmationRequest,
    pendingEvents: input.pendingEvents,
  })
  const memoryVersionStore = new ManagedMemoryVersionStore(input.companyDir)
  const substrateVersionStore = new SubstrateArtifactVersionStore(input.companyDir)

  const tools: AgentRuntimeToolDefinition[] = [
    createManagedTool({
      name: "environment_describe",
      description:
        "Read the current environment contract, including sandbox posture, mounted resources, and execution defaults.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          kind: { type: "string" },
          fingerprint: { type: "string" },
          resourceContractFingerprint: { type: "string" },
          agentSetupFingerprint: { type: ["string", "null"] },
          artifactPath: { type: "string" },
          agentSetupArtifactPath: { type: "string" },
          sandbox: { type: "object" },
          workspaceMountDefaults: { type: "object" },
          mountedResources: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["resource_read"],
      execute: async () => {
        const agentSetupFingerprint = await readSessionAgentSetupFingerprint({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        return asJson({
          id: input.environment.id,
          name: input.environment.name,
          kind: input.environment.kind,
          fingerprint: computeEnvironmentFingerprint(input.environment),
          resourceContractFingerprint: computeSessionResourceContractFingerprint(input.session),
          agentSetupFingerprint,
          artifactPath: join(
            resolveSessionWorkspaceDir(input.companyDir, input.session.agentId, input.session.id),
            ".openboa-runtime",
            "environment.json",
          ),
          agentSetupArtifactPath: join(
            resolveSessionWorkspaceDir(input.companyDir, input.session.agentId, input.session.id),
            ".openboa-runtime",
            "agent-setup.json",
          ),
          sandbox: input.environment.sandbox,
          workspaceMountDefaults: input.environment.workspaceMountDefaults,
          mountedResources: input.session.resources.map((resource) => ({
            kind: resource.kind,
            mountPath: resource.mountPath,
            access: resource.access,
            scope: typeof resource.metadata?.scope === "string" ? resource.metadata.scope : null,
            prompt: typeof resource.metadata?.prompt === "string" ? resource.metadata.prompt : null,
          })),
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "agent_describe_setup",
      description:
        "Read the durable agent setup contract for this or another same-agent session, including provider/model, prompt fingerprints, tools, skills, vaults, and resource contract.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          available: { type: "boolean" },
          artifactPath: { type: "string" },
          artifactMarkdownPath: { type: "string" },
          agentSetup: { type: ["object", "null"] },
          reason: { type: ["string", "null"] },
        },
      },
      effects: ["session_read", "resource_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const artifactPaths = buildSessionRuntimeArtifactPaths({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        const agentSetup = await readSessionAgentSetupArtifact({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        return asJson({
          sessionId: targetSessionId,
          available: agentSetup !== null,
          artifactPath: artifactPaths.agentSetupJson,
          artifactMarkdownPath: artifactPaths.agentSetupMarkdown,
          agentSetup,
          reason:
            agentSetup === null
              ? "Agent setup contract has not been materialized for the requested session yet."
              : null,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "agent_compare_setup",
      description:
        "Compare the durable setup contract of the current session against another same-agent session before reusing prior work or cross-session context.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          currentSessionId: { type: "string" },
          targetSessionId: { type: "string" },
          sameSetup: { type: "boolean" },
          currentFingerprint: { type: ["string", "null"] },
          targetFingerprint: { type: ["string", "null"] },
          changedSections: {
            type: "array",
            items: { type: "string" },
          },
          currentArtifactPath: { type: "string" },
          targetArtifactPath: { type: "string" },
        },
      },
      effects: ["session_read", "resource_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const currentArtifactPaths = buildSessionRuntimeArtifactPaths({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        const targetArtifactPaths = buildSessionRuntimeArtifactPaths({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        const [currentSetup, targetSetup] = await Promise.all([
          readSessionAgentSetupArtifact({
            companyDir: input.companyDir,
            agentId: input.session.agentId,
            sessionId: input.session.id,
          }),
          readSessionAgentSetupArtifact({
            companyDir: input.companyDir,
            agentId: input.session.agentId,
            sessionId: targetSessionId,
          }),
        ])
        const sectionPairs = [
          ["system_prompt", "systemPromptFingerprint"],
          ["tools", "toolsFingerprint"],
          ["skills", "skillsFingerprint"],
          ["environment", "environmentFingerprint"],
          ["resource_contract", "resourceContractFingerprint"],
          ["vaults", "vaultFingerprint"],
        ] as const
        const changedSections = sectionPairs
          .filter(
            ([, key]) =>
              readSetupFingerprint(currentSetup, key) !== readSetupFingerprint(targetSetup, key),
          )
          .map(([name]) => name)
        return asJson({
          currentSessionId: input.session.id,
          targetSessionId,
          sameSetup:
            readSetupFingerprint(currentSetup, "fingerprint") !== null &&
            readSetupFingerprint(currentSetup, "fingerprint") ===
              readSetupFingerprint(targetSetup, "fingerprint"),
          currentFingerprint: readSetupFingerprint(currentSetup, "fingerprint"),
          targetFingerprint: readSetupFingerprint(targetSetup, "fingerprint"),
          changedSections,
          currentArtifactPath: currentArtifactPaths.agentSetupJson,
          targetArtifactPath: targetArtifactPaths.agentSetupJson,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "vault_list",
      description:
        "List the read-only vault mounts available to this session without exposing their secret contents.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          vaults: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["resource_read"],
      execute: async () => {
        const vaults = input.session.resources
          .filter((resource) => resource.kind === "vault")
          .map((resource) => ({
            mountPath: resource.mountPath,
            access: resource.access,
            vaultName:
              typeof resource.metadata?.vaultName === "string" ? resource.metadata.vaultName : null,
            scope: typeof resource.metadata?.scope === "string" ? resource.metadata.scope : null,
            prompt: typeof resource.metadata?.prompt === "string" ? resource.metadata.prompt : null,
          }))
        return asJson({
          count: vaults.length,
          vaults,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_get_snapshot",
      description: "Read the durable session snapshot and pending-work summary.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          agentId: { type: "string" },
          relationToCurrent: { type: ["string", "null"] },
          setupMatchesCurrent: { type: "boolean" },
          childCount: { type: "number" },
          environmentId: { type: "string" },
          resourceContractFingerprint: { type: "string" },
          agentSetupFingerprint: { type: ["string", "null"] },
          status: { type: "string" },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
          lastActivityAt: { type: "string" },
          stopReason: { type: "string" },
          requiresAction: { type: "boolean" },
          pendingActionKind: { type: ["string", "null"] },
          pendingActionToolName: { type: ["string", "null"] },
          turns: { type: "number" },
          pendingCustomToolRequest: {},
          pendingToolConfirmationRequest: {},
          resourceCount: { type: "number" },
          pendingEventCount: { type: "number" },
          checkpointUpdatedAt: { type: ["string", "null"] },
          lastWakeId: { type: ["string", "null"] },
          latestSummary: { type: ["string", "null"] },
          activeOutcome: { type: ["object", "null"] },
          outcomeGrade: { type: ["object", "null"] },
          outcomeEvaluation: { type: ["object", "null"] },
          outcomeEvaluationHistoryCount: { type: "number" },
          outcomeEvaluationLatestIteration: { type: ["number", "null"] },
          eventCursor: {
            type: ["object", "null"],
          },
          artifactPaths: {
            type: "object",
          },
          shellState: {
            type: ["object", "null"],
          },
        },
      },
      effects: ["session_read", "memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [snapshot, runtimeMemory, sameAgentSessions, currentAgentSetupFingerprint] =
          await Promise.all([
            input.sessionStore.getSession(targetSessionId),
            input.memoryStore.read(input.session.agentId, targetSessionId),
            input.sessionStore.listAgentSessions(input.session.agentId),
            readSessionAgentSetupFingerprint({
              companyDir: input.companyDir,
              agentId: input.session.agentId,
              sessionId: input.session.id,
            }),
          ])
        const childCounts = buildSessionChildCountMap(sameAgentSessions)
        const summary = await summarizeSessionWithSetupFingerprint({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          snapshot,
          runtimeMemory,
          sandbox: input.sandbox,
          currentSessionId: input.session.id,
        })
        const relationToCurrent = computeSessionRelationAffinity({
          currentSession: input.session,
          candidateSession: snapshot.session,
        }).relation
        return asJson({
          ...summary,
          relationToCurrent,
          setupMatchesCurrent:
            currentAgentSetupFingerprint !== null &&
            summary.agentSetupFingerprint === currentAgentSetupFingerprint,
          childCount: childCounts.get(targetSessionId) ?? 0,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_describe_context",
      description:
        "Inspect the current context-assembly footprint, including system prompt sections, selected history, bootstrap files, skills, and top tool schemas.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          available: { type: "boolean" },
          artifactPaths: {
            type: "array",
            items: { type: "string" },
          },
          contextBudget: {
            type: ["object", "null"],
          },
          pressure: {
            type: ["object", "null"],
          },
          reason: { type: ["string", "null"] },
        },
      },
      effects: ["session_read", "memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const artifactPaths = [
          "/workspace/.openboa-runtime/context-budget.json",
          "/workspace/.openboa-runtime/context-budget.md",
        ]
        const { contextBudget, reason } = await resolveSessionContextBudget({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          currentSessionId: input.session.id,
          targetSessionId,
          contextBudgetRef: input.contextBudgetRef,
        })

        return asJson({
          sessionId: targetSessionId,
          available: contextBudget !== null,
          artifactPaths,
          contextBudget,
          pressure: summarizeContextPressure(contextBudget),
          reason:
            contextBudget === null
              ? (reason ?? "Context budget has not been assembled for the current wake yet.")
              : null,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_list",
      description:
        "List other same-agent sessions so the model can navigate cross-session context before rereading details.",
      inputSchema: {
        type: "object",
        properties: {
          includeCurrent: { type: "boolean" },
          limit: { type: "number" },
          activeMinutes: { type: "number" },
          lineage: {
            type: "string",
            enum: ["related", "parent", "children", "siblings"],
          },
          hasOutcome: { type: "boolean" },
          promotionReady: { type: "boolean" },
          outcomeStatus: {
            type: "string",
            enum: ["missing_outcome", "blocked", "not_ready", "uncertain", "fail", "pass"],
          },
          outcomeTrend: {
            type: "string",
            enum: ["first_iteration", "improving", "stable", "regressing"],
          },
          status: {
            type: "string",
            enum: ["idle", "running", "rescheduling", "requires_action", "terminated"],
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          count: { type: "number" },
          sessions: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read", "memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const includeCurrent =
          typeof (record as Record<string, unknown>).includeCurrent === "boolean"
            ? ((record as Record<string, unknown>).includeCurrent as boolean)
            : true
        const statusFilter =
          (record as Record<string, unknown>).status === "idle" ||
          (record as Record<string, unknown>).status === "running" ||
          (record as Record<string, unknown>).status === "rescheduling" ||
          (record as Record<string, unknown>).status === "requires_action" ||
          (record as Record<string, unknown>).status === "terminated"
            ? ((record as Record<string, unknown>).status as Session["status"])
            : null
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 10)
        const hasOutcome =
          typeof (record as Record<string, unknown>).hasOutcome === "boolean"
            ? ((record as Record<string, unknown>).hasOutcome as boolean)
            : null
        const lineage = normalizeRetrievalLineage((record as Record<string, unknown>).lineage)
        const promotionReady =
          typeof (record as Record<string, unknown>).promotionReady === "boolean"
            ? ((record as Record<string, unknown>).promotionReady as boolean)
            : null
        const outcomeStatus = normalizeOutcomeEvaluationStatus(
          (record as Record<string, unknown>).outcomeStatus,
        )
        const outcomeTrend = normalizeOutcomeEvaluationTrend(
          (record as Record<string, unknown>).outcomeTrend,
        )
        const activeMinutes =
          typeof (record as Record<string, unknown>).activeMinutes === "number" &&
          Number.isFinite((record as Record<string, unknown>).activeMinutes) &&
          ((record as Record<string, unknown>).activeMinutes as number) > 0
            ? Math.floor((record as Record<string, unknown>).activeMinutes as number)
            : null
        const currentAgentSetupFingerprint = await readSessionAgentSetupFingerprint({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        const [currentSnapshot, currentRuntimeMemory] = await Promise.all([
          input.sessionStore.getSession(input.session.id),
          input.runtimeMemorySnapshot
            ? Promise.resolve(input.runtimeMemorySnapshot)
            : input.memoryStore.read(input.session.agentId, input.session.id),
        ])
        const currentActiveOutcome = deriveSessionActiveOutcome({
          snapshot: currentSnapshot,
          runtimeMemory: currentRuntimeMemory,
        })
        const allSessions = await input.sessionStore.listAgentSessions(input.session.agentId)
        const sessions = allSessions.filter((session) =>
          includeCurrent === false ? session.id !== input.session.id : true,
        )
        const childCounts = buildSessionChildCountMap(allSessions)
        const filteredSessions = statusFilter
          ? sessions.filter((session) => session.status === statusFilter)
          : sessions
        const detailed: Array<Record<string, unknown> & { setupMatchesCurrent: boolean }> =
          await Promise.all(
            filteredSessions.map(async (session) => {
              const [snapshot, runtimeMemory] = await Promise.all([
                input.sessionStore.getSession(session.id),
                input.memoryStore.read(input.session.agentId, session.id),
              ])
              const summary = await summarizeSessionWithSetupFingerprint({
                companyDir: input.companyDir,
                agentId: input.session.agentId,
                snapshot,
                runtimeMemory,
                sandbox: input.sandbox,
                currentSessionId: input.session.id,
              })
              const relationToCurrent = computeSessionRelationAffinity({
                currentSession: input.session,
                candidateSession: session,
              }).relation
              return {
                ...summary,
                relationToCurrent,
                childCount: childCounts.get(session.id) ?? 0,
                setupMatchesCurrent:
                  currentAgentSetupFingerprint !== null &&
                  summary.agentSetupFingerprint === currentAgentSetupFingerprint,
                outcomeMatchesCurrent:
                  currentActiveOutcome !== null &&
                  typeof summary.activeOutcome === "object" &&
                  summary.activeOutcome !== null &&
                  typeof (summary.activeOutcome as { title?: unknown }).title === "string" &&
                  (summary.activeOutcome as { title: string }).title === currentActiveOutcome.title,
              }
            }),
          )
        const outcomeFiltered = detailed.filter((entry) => {
          const relationToCurrent =
            typeof entry.relationToCurrent === "string"
              ? (entry.relationToCurrent as "parent" | "child" | "sibling")
              : null
          if (!matchesSessionLineageFilter(lineage, relationToCurrent)) {
            return false
          }
          if (hasOutcome !== null) {
            const entryHasOutcome = entry.activeOutcome !== null
            if (entryHasOutcome !== hasOutcome) {
              return false
            }
          }
          if (promotionReady !== null) {
            const entryPromotionReady =
              typeof entry.outcomeEvaluation === "object" &&
              entry.outcomeEvaluation !== null &&
              "promotionReady" in entry.outcomeEvaluation
                ? Boolean((entry.outcomeEvaluation as { promotionReady?: boolean }).promotionReady)
                : false
            if (entryPromotionReady !== promotionReady) {
              return false
            }
          }
          if (outcomeStatus !== null) {
            const entryOutcomeStatus =
              typeof entry.outcomeEvaluation === "object" &&
              entry.outcomeEvaluation !== null &&
              typeof (entry.outcomeEvaluation as { status?: unknown }).status === "string"
                ? ((entry.outcomeEvaluation as { status: string }).status as
                    | "missing_outcome"
                    | "blocked"
                    | "not_ready"
                    | "uncertain"
                    | "fail"
                    | "pass")
                : null
            if (entryOutcomeStatus !== outcomeStatus) {
              return false
            }
          }
          if (outcomeTrend !== null) {
            const entryOutcomeTrend =
              typeof entry.outcomeEvaluation === "object" &&
              entry.outcomeEvaluation !== null &&
              typeof (entry.outcomeEvaluation as { trend?: unknown }).trend === "string"
                ? ((entry.outcomeEvaluation as { trend: string }).trend as
                    | "first_iteration"
                    | "improving"
                    | "stable"
                    | "regressing")
                : null
            if (entryOutcomeTrend !== outcomeTrend) {
              return false
            }
          }
          return true
        })
        const now = Date.parse(nowIsoString())
        const activeFiltered = activeMinutes
          ? outcomeFiltered.filter((entry) => {
              const activityAt = Date.parse(String(entry.lastActivityAt ?? entry.updatedAt ?? null))
              if (!Number.isFinite(activityAt)) {
                return false
              }
              const ageMinutes = Math.max(0, Math.floor((now - activityAt) / 60_000))
              return ageMinutes <= activeMinutes
            })
          : outcomeFiltered
        const ordered = activeFiltered
          .sort(
            (left, right) =>
              Number(Boolean((right as { setupMatchesCurrent?: boolean }).setupMatchesCurrent)) -
                Number(Boolean((left as { setupMatchesCurrent?: boolean }).setupMatchesCurrent)) ||
              Number(
                Boolean((right as { outcomeMatchesCurrent?: boolean }).outcomeMatchesCurrent),
              ) -
                Number(
                  Boolean((left as { outcomeMatchesCurrent?: boolean }).outcomeMatchesCurrent),
                ) ||
              Number(Boolean((right as { requiresAction?: boolean }).requiresAction)) -
                Number(Boolean((left as { requiresAction?: boolean }).requiresAction)) ||
              outcomeTrendPriority((right as { outcomeTrend?: unknown }).outcomeTrend) -
                outcomeTrendPriority((left as { outcomeTrend?: unknown }).outcomeTrend) ||
              sessionRelationPriority(
                (right as { relationToCurrent?: unknown }).relationToCurrent,
              ) -
                sessionRelationPriority(
                  (left as { relationToCurrent?: unknown }).relationToCurrent,
                ) ||
              Date.parse(
                String(right.lastActivityAt ?? right.updatedAt ?? "1970-01-01T00:00:00.000Z"),
              ) -
                Date.parse(
                  String(left.lastActivityAt ?? left.updatedAt ?? "1970-01-01T00:00:00.000Z"),
                ),
          )
          .slice(0, limit)
        return asJson({
          agentId: input.session.agentId,
          count: ordered.length,
          sessions: ordered,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_list_children",
      description:
        "List same-agent child sessions delegated from the current session or another same-agent parent session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          limit: { type: "number" },
          activeMinutes: { type: "number" },
          hasOutcome: { type: "boolean" },
          promotionReady: { type: "boolean" },
          outcomeStatus: {
            type: "string",
            enum: ["missing_outcome", "blocked", "not_ready", "uncertain", "fail", "pass"],
          },
          outcomeTrend: {
            type: "string",
            enum: ["first_iteration", "improving", "stable", "regressing"],
          },
          status: {
            type: "string",
            enum: ["idle", "running", "rescheduling", "requires_action", "terminated"],
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          parentSessionId: { type: "string" },
          count: { type: "number" },
          sessions: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read", "memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const parentSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const statusFilter =
          (record as Record<string, unknown>).status === "idle" ||
          (record as Record<string, unknown>).status === "running" ||
          (record as Record<string, unknown>).status === "rescheduling" ||
          (record as Record<string, unknown>).status === "requires_action" ||
          (record as Record<string, unknown>).status === "terminated"
            ? ((record as Record<string, unknown>).status as Session["status"])
            : null
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 10)
        const hasOutcome =
          typeof (record as Record<string, unknown>).hasOutcome === "boolean"
            ? ((record as Record<string, unknown>).hasOutcome as boolean)
            : null
        const promotionReady =
          typeof (record as Record<string, unknown>).promotionReady === "boolean"
            ? ((record as Record<string, unknown>).promotionReady as boolean)
            : null
        const outcomeStatus = normalizeOutcomeEvaluationStatus(
          (record as Record<string, unknown>).outcomeStatus,
        )
        const outcomeTrend = normalizeOutcomeEvaluationTrend(
          (record as Record<string, unknown>).outcomeTrend,
        )
        const activeMinutes =
          typeof (record as Record<string, unknown>).activeMinutes === "number" &&
          Number.isFinite((record as Record<string, unknown>).activeMinutes) &&
          ((record as Record<string, unknown>).activeMinutes as number) > 0
            ? Math.floor((record as Record<string, unknown>).activeMinutes as number)
            : null
        const currentAgentSetupFingerprint = await readSessionAgentSetupFingerprint({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        const [currentSnapshot, currentRuntimeMemory] = await Promise.all([
          input.sessionStore.getSession(input.session.id),
          input.runtimeMemorySnapshot
            ? Promise.resolve(input.runtimeMemorySnapshot)
            : input.memoryStore.read(input.session.agentId, input.session.id),
        ])
        const currentActiveOutcome = deriveSessionActiveOutcome({
          snapshot: currentSnapshot,
          runtimeMemory: currentRuntimeMemory,
        })
        const sessions = (await input.sessionStore.listAgentSessions(input.session.agentId)).filter(
          (session) => session.metadata?.parentSessionId === parentSessionId,
        )
        const childCounts = buildSessionChildCountMap(
          await input.sessionStore.listAgentSessions(input.session.agentId),
        )
        const filteredSessions = statusFilter
          ? sessions.filter((session) => session.status === statusFilter)
          : sessions
        const detailed: Array<Record<string, unknown> & { setupMatchesCurrent: boolean }> =
          await Promise.all(
            filteredSessions.map(async (session) => {
              const [snapshot, runtimeMemory] = await Promise.all([
                input.sessionStore.getSession(session.id),
                input.memoryStore.read(input.session.agentId, session.id),
              ])
              const summary = await summarizeSessionWithSetupFingerprint({
                companyDir: input.companyDir,
                agentId: input.session.agentId,
                snapshot,
                runtimeMemory,
                sandbox: input.sandbox,
                currentSessionId: input.session.id,
              })
              return {
                ...summary,
                relationToCurrent: "child",
                childCount: childCounts.get(session.id) ?? 0,
                setupMatchesCurrent:
                  currentAgentSetupFingerprint !== null &&
                  summary.agentSetupFingerprint === currentAgentSetupFingerprint,
                outcomeMatchesCurrent:
                  currentActiveOutcome !== null &&
                  typeof summary.activeOutcome === "object" &&
                  summary.activeOutcome !== null &&
                  typeof (summary.activeOutcome as { title?: unknown }).title === "string" &&
                  (summary.activeOutcome as { title: string }).title === currentActiveOutcome.title,
              }
            }),
          )
        const outcomeFiltered = detailed.filter((entry) => {
          if (hasOutcome !== null) {
            const entryHasOutcome = entry.activeOutcome !== null
            if (entryHasOutcome !== hasOutcome) {
              return false
            }
          }
          if (promotionReady !== null) {
            const entryPromotionReady =
              typeof entry.outcomeEvaluation === "object" &&
              entry.outcomeEvaluation !== null &&
              "promotionReady" in entry.outcomeEvaluation
                ? Boolean((entry.outcomeEvaluation as { promotionReady?: boolean }).promotionReady)
                : false
            if (entryPromotionReady !== promotionReady) {
              return false
            }
          }
          if (outcomeStatus !== null) {
            const entryOutcomeStatus =
              typeof entry.outcomeEvaluation === "object" &&
              entry.outcomeEvaluation !== null &&
              typeof (entry.outcomeEvaluation as { status?: unknown }).status === "string"
                ? ((entry.outcomeEvaluation as { status: string }).status as
                    | "missing_outcome"
                    | "blocked"
                    | "not_ready"
                    | "uncertain"
                    | "fail"
                    | "pass")
                : null
            if (entryOutcomeStatus !== outcomeStatus) {
              return false
            }
          }
          if (outcomeTrend !== null) {
            const entryOutcomeTrend =
              typeof entry.outcomeEvaluation === "object" &&
              entry.outcomeEvaluation !== null &&
              typeof (entry.outcomeEvaluation as { trend?: unknown }).trend === "string"
                ? ((entry.outcomeEvaluation as { trend: string }).trend as
                    | "first_iteration"
                    | "improving"
                    | "stable"
                    | "regressing")
                : null
            if (entryOutcomeTrend !== outcomeTrend) {
              return false
            }
          }
          return true
        })
        const now = Date.parse(nowIsoString())
        const activeFiltered = activeMinutes
          ? outcomeFiltered.filter((entry) => {
              const activityAt = Date.parse(String(entry.lastActivityAt ?? entry.updatedAt ?? null))
              if (!Number.isFinite(activityAt)) {
                return false
              }
              const ageMinutes = Math.max(0, Math.floor((now - activityAt) / 60_000))
              return ageMinutes <= activeMinutes
            })
          : outcomeFiltered
        const ordered = activeFiltered
          .sort(
            (left, right) =>
              Number(Boolean((right as { setupMatchesCurrent?: boolean }).setupMatchesCurrent)) -
                Number(Boolean((left as { setupMatchesCurrent?: boolean }).setupMatchesCurrent)) ||
              Number(
                Boolean((right as { outcomeMatchesCurrent?: boolean }).outcomeMatchesCurrent),
              ) -
                Number(
                  Boolean((left as { outcomeMatchesCurrent?: boolean }).outcomeMatchesCurrent),
                ) ||
              Number(Boolean((right as { requiresAction?: boolean }).requiresAction)) -
                Number(Boolean((left as { requiresAction?: boolean }).requiresAction)) ||
              outcomeTrendPriority((right as { outcomeTrend?: unknown }).outcomeTrend) -
                outcomeTrendPriority((left as { outcomeTrend?: unknown }).outcomeTrend) ||
              Date.parse(
                String(right.lastActivityAt ?? right.updatedAt ?? "1970-01-01T00:00:00.000Z"),
              ) -
                Date.parse(
                  String(left.lastActivityAt ?? left.updatedAt ?? "1970-01-01T00:00:00.000Z"),
                ),
          )
          .slice(0, limit)
        return asJson({
          parentSessionId,
          count: ordered.length,
          sessions: ordered,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_delegate",
      description:
        "Create a same-agent child session with its own isolated execution hand and seed it with a bounded delegated task.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          successCriteria: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["message"],
      },
      outputSchema: {
        type: "object",
        properties: {
          parentSessionId: { type: "string" },
          childSession: { type: "object" },
          seededEventIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      effects: ["session_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const message = normalizeOptionalText((record as Record<string, unknown>).message)
        if (!message) {
          throw new Error("session_delegate requires a non-empty message")
        }
        const childSession = await input.sessionStore.createSession({
          agentId: input.session.agentId,
          environmentId: input.session.environmentId,
        })
        await input.sessionStore.updateSession(childSession.id, (session) => ({
          ...session,
          metadata: {
            ...(session.metadata ?? {}),
            parentSessionId: input.session.id,
          },
        }))

        const seededEventIds: string[] = []
        const title = normalizeOptionalText((record as Record<string, unknown>).title)
        if (title) {
          const successCriteria = Array.isArray((record as Record<string, unknown>).successCriteria)
            ? [
                ...new Set(
                  ((record as Record<string, unknown>).successCriteria as unknown[])
                    .map((item) => normalizeOptionalText(item))
                    .filter((item): item is string => Boolean(item)),
                ),
              ]
            : []
          const outcomeEventId = makeUuidV7()
          const createdAt = nowIsoString()
          await input.sessionStore.emitEvent(childSession.id, {
            id: outcomeEventId,
            type: "user.define_outcome",
            createdAt,
            processedAt: null,
            outcome: {
              title,
              detail: normalizeOptionalText((record as Record<string, unknown>).detail),
              successCriteria,
            },
          })
          seededEventIds.push(outcomeEventId)
        }

        const messageEventId = makeUuidV7()
        await input.sessionStore.emitEvent(childSession.id, {
          id: messageEventId,
          type: "user.message",
          createdAt: nowIsoString(),
          processedAt: null,
          message,
        })
        seededEventIds.push(messageEventId)
        await input.sessionStore.emitEvent(input.session.id, {
          id: makeUuidV7(),
          type: "session.child_created",
          createdAt: nowIsoString(),
          processedAt: nowIsoString(),
          wakeId: input.wakeId,
          childSessionId: childSession.id,
          outcomeTitle: title,
          message,
        })

        const [snapshot, runtimeMemory] = await Promise.all([
          input.sessionStore.getSession(childSession.id),
          input.memoryStore.read(input.session.agentId, childSession.id),
        ])
        const childCounts = buildSessionChildCountMap(
          await input.sessionStore.listAgentSessions(input.session.agentId),
        )
        return asJson({
          parentSessionId: input.session.id,
          childSession: {
            ...(await summarizeSessionWithSetupFingerprint({
              companyDir: input.companyDir,
              agentId: input.session.agentId,
              snapshot,
              runtimeMemory,
              sandbox: input.sandbox,
              currentSessionId: input.session.id,
            })),
            relationToCurrent: "child",
            childCount: childCounts.get(childSession.id) ?? 0,
          },
          seededEventIds,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_run_child",
      description:
        "Run one direct child session for a bounded number of cycles so delegated work can make forward progress in isolated context.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          maxCycles: { type: "number" },
        },
        required: ["sessionId"],
      },
      outputSchema: {
        type: "object",
        properties: {
          parentSessionId: { type: "string" },
          childSession: { type: "object" },
          executedCycles: { type: "number" },
          loopStopReason: { type: "string" },
          childStopReason: { type: "string" },
          response: { type: ["string", "null"] },
          queuedWakeIds: {
            type: "array",
            items: { type: "string" },
          },
          processedEventIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      effects: ["session_write", "session_read", "memory_read"],
      readOnly: false,
      execute: async (args) => {
        if (!input.onRunChildSession) {
          throw new Error("session_run_child is not available in this runtime context")
        }
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const childSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        if (!childSessionId || childSessionId === input.session.id) {
          throw new Error("session_run_child requires a direct child session id")
        }
        const existingChildSnapshot = await input.sessionStore.getSession(childSessionId)
        if (existingChildSnapshot.session.metadata?.parentSessionId !== input.session.id) {
          throw new Error(`Session ${childSessionId} is not a direct child of ${input.session.id}`)
        }
        const maxCycles = normalizeLimit((record as Record<string, unknown>).maxCycles, 3)
        const loop = await input.onRunChildSession({
          childSessionId,
          maxCycles,
        })
        const [childSnapshot, runtimeMemory] = await Promise.all([
          input.sessionStore.getSession(childSessionId),
          input.memoryStore.read(input.session.agentId, childSessionId),
        ])
        await input.sessionStore.emitEvent(input.session.id, {
          id: makeUuidV7(),
          type: "session.child_idle",
          createdAt: nowIsoString(),
          processedAt: nowIsoString(),
          wakeId: input.wakeId,
          childSessionId,
          childStopReason: loop.childStopReason as Session["stopReason"],
          summary:
            runtimeMemory.checkpoint?.lastSummary ??
            loop.response ??
            "Child session completed a bounded run.",
          executedCycles: loop.executed,
        })
        const childCounts = buildSessionChildCountMap(
          await input.sessionStore.listAgentSessions(input.session.agentId),
        )
        return asJson({
          parentSessionId: input.session.id,
          childSession: {
            ...(await summarizeSessionWithSetupFingerprint({
              companyDir: input.companyDir,
              agentId: input.session.agentId,
              snapshot: childSnapshot,
              runtimeMemory,
              sandbox: input.sandbox,
              currentSessionId: input.session.id,
            })),
            relationToCurrent: "child",
            childCount: childCounts.get(childSessionId) ?? 0,
          },
          executedCycles: loop.executed,
          loopStopReason: loop.loopStopReason,
          childStopReason: loop.childStopReason,
          response: loop.response,
          queuedWakeIds: loop.queuedWakeIds,
          processedEventIds: loop.processedEventIds,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_list_traces",
      description:
        "List recent bounded wake traces for this session or another same-agent session before rereading one trace in detail.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          limit: { type: "number" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          count: { type: "number" },
          traces: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const snapshot = await input.sessionStore.getSession(targetSessionId)
        const traces = summarizeSessionTraces(
          snapshot.events,
          normalizeLimit((record as Record<string, unknown>).limit, 8),
        )
        return asJson({
          sessionId: targetSessionId,
          count: traces.length,
          traces,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "outcome_read",
      description:
        "Read the current durable active outcome for this session or another same-agent session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          activeOutcome: { type: ["object", "null"] },
        },
      },
      effects: ["session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [snapshot, runtimeMemory] = await Promise.all([
          input.sessionStore.getSession(targetSessionId),
          input.memoryStore.read(input.session.agentId, targetSessionId),
        ])
        return asJson({
          sessionId: targetSessionId,
          activeOutcome: deriveSessionActiveOutcome({ snapshot, runtimeMemory }),
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "outcome_grade",
      description:
        "Evaluate the current durable outcome against the latest session state using a bounded deterministic rubric before deciding whether the work is blocked, sleeping, in progress, or a done candidate.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          activeOutcome: { type: ["object", "null"] },
          grade: {
            type: "object",
            properties: {
              status: { type: "string" },
              confidence: { type: "string" },
              summary: { type: "string" },
              matchedCriteria: { type: "number" },
              totalCriteria: { type: "number" },
              evidence: {
                type: "array",
                items: { type: "string" },
              },
              nextSuggestedTool: { type: ["object", "null"] },
            },
          },
        },
      },
      effects: ["session_read", "memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [snapshot, runtimeMemory] = await Promise.all([
          input.sessionStore.getSession(targetSessionId),
          input.memoryStore.read(input.session.agentId, targetSessionId),
        ])
        return asJson({
          sessionId: targetSessionId,
          activeOutcome: deriveSessionActiveOutcome({ snapshot, runtimeMemory }),
          grade: gradeSessionOutcome({ snapshot, runtimeMemory }),
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "outcome_evaluate",
      description:
        "Run the bounded outcome evaluator to decide whether the current session is promotion-ready, uncertain, blocked, or still not ready.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          activeOutcome: { type: ["object", "null"] },
          grade: {
            type: "object",
            properties: {
              status: { type: "string" },
              confidence: { type: "string" },
              summary: { type: "string" },
              matchedCriteria: { type: "number" },
              totalCriteria: { type: "number" },
              evidence: {
                type: "array",
                items: { type: "string" },
              },
              nextSuggestedTool: { type: ["object", "null"] },
            },
          },
          evaluation: {
            type: "object",
            properties: {
              status: { type: "string" },
              confidence: { type: "string" },
              promotionReady: { type: "boolean" },
              trend: { type: "string" },
              trendSummary: { type: ["string", "null"] },
              summary: { type: "string" },
              evidence: {
                type: "array",
                items: { type: "string" },
              },
              nextSuggestedTool: { type: ["object", "null"] },
            },
          },
          evaluationHistory: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read", "memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const evaluated = await evaluateScopedSessionOutcome({
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          sandbox: input.sandbox,
        })
        return asJson({
          sessionId: evaluated.sessionId,
          activeOutcome: evaluated.activeOutcome,
          grade: evaluated.grade,
          evaluation: evaluated.evaluation,
          evaluationHistory: evaluated.evaluationHistory,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "outcome_history",
      description:
        "Read the durable history of outcome evaluations for the current or another same-agent session, including iteration numbers and evaluator posture over time.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          limit: { type: "number" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          activeOutcome: { type: ["object", "null"] },
          count: { type: "number" },
          latestIteration: { type: ["number", "null"] },
          evaluations: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read", "memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const evaluated = await evaluateScopedSessionOutcome({
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          sandbox: input.sandbox,
        })
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 12)
        const evaluations = evaluated.evaluationHistory.slice(-limit)
        return asJson({
          sessionId: evaluated.sessionId,
          activeOutcome: evaluated.activeOutcome,
          count: evaluated.evaluationHistory.length,
          latestIteration: evaluated.evaluationHistory.at(-1)?.iteration ?? null,
          evaluations,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "outcome_define",
      description:
        "Define or replace the durable active outcome for this session so future turns can align around an explicit goal.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          successCriteria: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["title"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          activeOutcome: { type: "object" },
          eventId: { type: "string" },
        },
      },
      effects: ["session_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const title = normalizeOptionalText((record as Record<string, unknown>).title)
        if (!title) {
          throw new Error("outcome_define requires a non-empty title")
        }
        const successCriteria = Array.isArray((record as Record<string, unknown>).successCriteria)
          ? [
              ...new Set(
                ((record as Record<string, unknown>).successCriteria as unknown[])
                  .map((item) => normalizeOptionalText(item))
                  .filter((item): item is string => Boolean(item)),
              ),
            ]
          : []
        const activeOutcome: SessionOutcomeDefinition = {
          title,
          detail: normalizeOptionalText((record as Record<string, unknown>).detail),
          successCriteria,
        }
        const createdAt = nowIsoString()
        const eventId = makeUuidV7()
        await input.sessionStore.emitEvent(targetSessionId, {
          id: eventId,
          type: "user.define_outcome",
          createdAt,
          processedAt: createdAt,
          outcome: activeOutcome,
        })
        return asJson({
          sessionId: targetSessionId,
          activeOutcome,
          eventId,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_get_events",
      description:
        "Read durable session events using positional slices rather than relying on the current context window.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          afterEventId: { type: "string" },
          beforeEventId: { type: "string" },
          aroundEventId: { type: "string" },
          wakeId: { type: "string" },
          beforeLimit: { type: "number" },
          afterLimit: { type: "number" },
          includeProcessed: { type: "boolean" },
          limit: { type: "number" },
          types: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "user.message",
                "user.define_outcome",
                "user.interrupt",
                "user.tool_confirmation",
                "user.custom_tool_result",
                "session.status_changed",
                "session.status_idle",
                "span.started",
                "span.completed",
                "agent.message",
                "agent.tool_use",
                "agent.custom_tool_use",
              ],
            },
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          count: { type: "number" },
          events: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const events = await input.sessionStore.listEvents(targetSessionId, {
          afterEventId: normalizeOptionalText((record as Record<string, unknown>).afterEventId),
          beforeEventId: normalizeOptionalText((record as Record<string, unknown>).beforeEventId),
          aroundEventId: normalizeOptionalText((record as Record<string, unknown>).aroundEventId),
          beforeLimit: normalizeLimit((record as Record<string, unknown>).beforeLimit, 0),
          afterLimit: normalizeLimit((record as Record<string, unknown>).afterLimit, 0),
          includeProcessed:
            typeof (record as Record<string, unknown>).includeProcessed === "boolean"
              ? ((record as Record<string, unknown>).includeProcessed as boolean)
              : true,
          limit: normalizeLimit((record as Record<string, unknown>).limit, 20),
          types: normalizeEventTypes((record as Record<string, unknown>).types),
          wakeId: normalizeOptionalText((record as Record<string, unknown>).wakeId),
        })
        return asJson({
          sessionId: targetSessionId,
          count: events.length,
          events,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_get_trace",
      description:
        "Read the events that belong to one specific wake trace so a bounded execution run can be inspected as a unit.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          wakeId: { type: "string" },
          types: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "user.message",
                "user.define_outcome",
                "user.interrupt",
                "user.tool_confirmation",
                "user.custom_tool_result",
                "session.status_changed",
                "session.status_idle",
                "span.started",
                "span.completed",
                "agent.message",
                "agent.tool_use",
                "agent.custom_tool_use",
              ],
            },
          },
          limit: { type: "number" },
        },
        required: ["wakeId"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          wakeId: { type: "string" },
          count: { type: "number" },
          events: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const wakeId = normalizeOptionalText((record as Record<string, unknown>).wakeId)
        if (!wakeId) {
          throw new Error("session_get_trace requires a non-empty wakeId")
        }
        const explicitLimit =
          typeof (record as Record<string, unknown>).limit === "number" &&
          Number.isFinite((record as Record<string, unknown>).limit) &&
          ((record as Record<string, unknown>).limit as number) > 0
            ? Math.floor((record as Record<string, unknown>).limit as number)
            : undefined
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const events = await input.sessionStore.listEvents(targetSessionId, {
          includeProcessed: true,
          ...(typeof explicitLimit === "number" ? { limit: explicitLimit } : {}),
          types: normalizeEventTypes((record as Record<string, unknown>).types),
          wakeId,
        })
        return asJson({
          sessionId: targetSessionId,
          wakeId,
          count: events.length,
          events,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_search_traces",
      description:
        "Search same-agent wake traces across sessions so bounded prior execution runs can be rediscovered before rereading one trace in detail.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          includeCurrent: { type: "boolean" },
          lineage: {
            type: "string",
            enum: ["related", "parent", "children", "siblings"],
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          count: { type: "number" },
          hits: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const query = normalizeOptionalText((record as Record<string, unknown>).query)
        if (!query) {
          throw new Error("session_search_traces requires a non-empty query")
        }
        const hits = await searchAgentSessionTraces({
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          currentAgentSetupFingerprint:
            input.runtimeMemorySnapshot?.checkpoint?.lastAgentSetupFingerprint ?? null,
          currentActiveOutcome: input.runtimeMemorySnapshot?.checkpoint?.activeOutcome ?? null,
          query,
          limit: normalizeLimit((record as Record<string, unknown>).limit, 8),
          includeCurrent: (record as Record<string, unknown>).includeCurrent === true,
          lineage: normalizeRetrievalLineage((record as Record<string, unknown>).lineage),
        })
        return asJson({
          sessionId: input.session.id,
          count: hits.length,
          hits,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_list",
      description: "List the resources currently attached to this session.",
      inputSchema: {},
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          resources: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["resource_read"],
      execute: async () =>
        asJson({
          sessionId: input.session.id,
          resources: input.session.resources.map((resource) => ({
            ...resource,
            metadata: {
              ...(resource.metadata ?? {}),
              scope: typeof resource.metadata?.scope === "string" ? resource.metadata.scope : null,
              prompt:
                typeof resource.metadata?.prompt === "string" ? resource.metadata.prompt : null,
            },
          })),
        }),
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_describe",
      description:
        "Inspect the session-scoped shell hand, including the current durable cwd and the latest bounded command metadata.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          env: { type: "object" },
          contextPressure: { type: ["object", "null"] },
          persistentShell: { type: ["object", "null"] },
          shellState: { type: ["object", "null"] },
          artifactPaths: { type: "object" },
          lastCommandPreview: { type: ["object", "null"] },
          commandPolicy: { type: ["object", "null"] },
          busyPlan: { type: ["object", "null"] },
          recoveryPlan: { type: ["object", "null"] },
          shellReadFirstAlternatives: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [shellPosture, sandboxDescription] = await Promise.all([
          resolveShellMutationPosture({
            sessionId: targetSessionId,
            currentSessionId: input.session.id,
            agentId: input.session.agentId,
            memoryStore: input.memoryStore,
            sandbox: input.sandbox,
          }),
          input.sandbox.describe(),
        ])
        const { contextBudget } = await resolveSessionContextBudget({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          currentSessionId: input.session.id,
          targetSessionId,
          contextBudgetRef: input.contextBudgetRef,
        })
        const contextPressure = summarizeContextPressure(contextBudget)
        const shellReadFirstAlternatives = buildShellReadFirstAlternatives({
          shellState: shellPosture.shellState,
          shellPosture,
          contextPressure,
          includeShellDescribe: false,
        })
        const artifactPaths = buildShellArtifactPaths({
          memoryStore: input.memoryStore,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        return asJson({
          sessionId: targetSessionId,
          cwd: shellPosture.shellState?.cwd ?? "/workspace",
          env: summarizeShellEnv(shellPosture.shellState?.env),
          contextPressure,
          persistentShell: shellPosture.persistentShell,
          shellState: shellPosture.shellState,
          artifactPaths,
          lastCommandPreview: shellPosture.lastCommandPreview,
          commandPolicy: sandboxDescription.commandPolicy ?? null,
          busyPlan: shellPosture.busyPlan,
          recoveryPlan: shellPosture.recoveryPlan,
          shellReadFirstAlternatives,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_history",
      description:
        "Read the recent bounded shell history for this session, including output previews, before continuing or debugging prior shell work.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          limit: { type: "number" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          count: { type: "number" },
          artifactPaths: { type: "object" },
          busyPlan: { type: ["object", "null"] },
          recoveryPlan: { type: ["object", "null"] },
          nextStep: { type: ["object", "null"] },
          commands: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [runtimeMemory, shellPosture] = await Promise.all([
          input.memoryStore.read(input.session.agentId, targetSessionId),
          resolveShellMutationPosture({
            sessionId: targetSessionId,
            currentSessionId: input.session.id,
            agentId: input.session.agentId,
            memoryStore: input.memoryStore,
            sandbox: input.sandbox,
          }),
        ])
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 5)
        const commands = (runtimeMemory.shellState?.recentCommands ?? []).slice(0, limit)
        const artifactPaths = buildShellArtifactPaths({
          memoryStore: input.memoryStore,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        return asJson({
          sessionId: targetSessionId,
          cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          count: commands.length,
          artifactPaths,
          busyPlan: shellPosture.busyPlan,
          recoveryPlan: shellPosture.recoveryPlan,
          nextStep: shellPosture.busyPlan
            ? {
                tool: shellPosture.busyPlan.tool,
                args: shellPosture.busyPlan.args,
                rationale: shellPosture.busyPlan.rationale,
              }
            : shellPosture.recoveryPlan,
          commands,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_read_last_output",
      description:
        "Read the last bounded shell command output for this session, including stdout, stderr, and the materialized shell-last-output artifacts.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          artifactPaths: { type: "object" },
          lastCommand: { type: ["object", "null"] },
          liveCommand: { type: ["object", "null"] },
          busyPlan: { type: ["object", "null"] },
          recoveryPlan: { type: ["object", "null"] },
          nextStep: { type: ["object", "null"] },
        },
      },
      effects: ["memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [runtimeMemory, shellPosture] = await Promise.all([
          input.memoryStore.read(input.session.agentId, targetSessionId),
          resolveShellMutationPosture({
            sessionId: targetSessionId,
            currentSessionId: input.session.id,
            agentId: input.session.agentId,
            memoryStore: input.memoryStore,
            sandbox: input.sandbox,
          }),
        ])
        const artifactPaths = buildShellArtifactPaths({
          memoryStore: input.memoryStore,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        const liveCommand =
          shellPosture.persistentShell &&
          shellPosture.persistentShell.status === "active" &&
          shellPosture.persistentShell.busy === true
            ? {
                shellId:
                  typeof shellPosture.persistentShell.shellId === "string"
                    ? shellPosture.persistentShell.shellId
                    : null,
                command:
                  typeof shellPosture.persistentShell.currentCommand === "string"
                    ? shellPosture.persistentShell.currentCommand
                    : null,
                startedAt:
                  typeof shellPosture.persistentShell.currentCommandStartedAt === "string"
                    ? shellPosture.persistentShell.currentCommandStartedAt
                    : null,
                stdoutPreview:
                  typeof shellPosture.persistentShell.currentStdoutPreview === "string"
                    ? shellPosture.persistentShell.currentStdoutPreview
                    : null,
                stderrPreview:
                  typeof shellPosture.persistentShell.currentStderrPreview === "string"
                    ? shellPosture.persistentShell.currentStderrPreview
                    : null,
              }
            : null
        const nextStep = shellPosture.busyPlan
          ? {
              tool: shellPosture.busyPlan.tool,
              args: shellPosture.busyPlan.args,
              rationale: shellPosture.busyPlan.rationale,
            }
          : shellPosture.recoveryPlan
        return asJson({
          sessionId: targetSessionId,
          cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          artifactPaths,
          lastCommand: runtimeMemory.shellState?.lastCommand
            ? {
                command: runtimeMemory.shellState.lastCommand.command,
                args: runtimeMemory.shellState.lastCommand.args,
                cwd: runtimeMemory.shellState.lastCommand.cwd,
                updatedAt: runtimeMemory.shellState.lastCommand.updatedAt,
                exitCode: runtimeMemory.shellState.lastCommand.exitCode,
                timedOut: runtimeMemory.shellState.lastCommand.timedOut,
                durationMs: runtimeMemory.shellState.lastCommand.durationMs,
                stdout: runtimeMemory.shellState.lastCommand.stdoutPreview ?? null,
                stderr: runtimeMemory.shellState.lastCommand.stderrPreview ?? null,
                summary: runtimeMemory.shellState.lastCommand.outputPreview ?? null,
              }
            : null,
          liveCommand,
          busyPlan: shellPosture.busyPlan,
          recoveryPlan: shellPosture.recoveryPlan,
          nextStep,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_read_command",
      description:
        "Read one specific recent shell command by durable commandId, including stdout, stderr, and bounded command metadata.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          commandId: { type: "string" },
        },
        required: ["commandId"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          artifactPaths: { type: "object" },
          command: { type: ["object", "null"] },
          busyPlan: { type: ["object", "null"] },
          recoveryPlan: { type: ["object", "null"] },
          nextStep: { type: ["object", "null"] },
        },
      },
      effects: ["memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const commandId = normalizeOptionalText((record as Record<string, unknown>).commandId)
        if (!commandId) {
          throw new Error("shell_read_command requires a non-empty commandId")
        }
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        const [runtimeMemory, shellPosture] = await Promise.all([
          input.memoryStore.read(input.session.agentId, targetSessionId),
          resolveShellMutationPosture({
            sessionId: targetSessionId,
            currentSessionId: input.session.id,
            agentId: input.session.agentId,
            memoryStore: input.memoryStore,
            sandbox: input.sandbox,
          }),
        ])
        const artifactPaths = buildShellArtifactPaths({
          memoryStore: input.memoryStore,
          agentId: input.session.agentId,
          sessionId: targetSessionId,
        })
        const command = findShellCommandById(runtimeMemory.shellState, commandId)
        return asJson({
          sessionId: targetSessionId,
          cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          artifactPaths,
          command,
          busyPlan: shellPosture.busyPlan,
          recoveryPlan: shellPosture.recoveryPlan,
          nextStep: shellPosture.busyPlan
            ? {
                tool: shellPosture.busyPlan.tool,
                args: shellPosture.busyPlan.args,
                rationale: shellPosture.busyPlan.rationale,
              }
            : shellPosture.recoveryPlan,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_wait",
      description:
        "Wait briefly on the current session's live persistent shell command and return bounded running status or the completed result.",
      inputSchema: {
        type: "object",
        properties: {
          timeoutMs: { type: "number" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          artifactPaths: { type: "object" },
          status: { type: "string" },
          persistentShell: { type: ["object", "null"] },
          shellState: { type: ["object", "null"] },
          result: { type: ["object", "null"] },
          error: { type: ["string", "null"] },
          busyPlan: { type: ["object", "null"] },
          recoveryPlan: { type: ["object", "null"] },
          nextStep: { type: ["object", "null"] },
        },
      },
      effects: ["memory_read", "memory_write", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const waited = await executeSandboxActionOrThrow(input.sandbox, "wait_persistent_shell", {
          timeoutMs: normalizeLimit((record as Record<string, unknown>).timeoutMs, 1_000),
        })
        const output =
          waited.output && typeof waited.output === "object" && !Array.isArray(waited.output)
            ? (waited.output as Record<string, unknown>)
            : {}
        const artifactPaths = buildShellArtifactPaths({
          memoryStore: input.memoryStore,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        const status =
          typeof output.status === "string" && output.status.trim().length > 0
            ? output.status
            : "idle"
        const resultRecord =
          output.result && typeof output.result === "object" && !Array.isArray(output.result)
            ? (output.result as Record<string, unknown>)
            : null
        const nextEnv =
          resultRecord?.env &&
          typeof resultRecord.env === "object" &&
          !Array.isArray(resultRecord.env)
            ? (resultRecord.env as Record<string, string>)
            : (runtimeMemory.shellState?.env ?? {})
        const nextCwd =
          typeof resultRecord?.cwd === "string"
            ? resultRecord.cwd
            : (runtimeMemory.shellState?.cwd ?? "/workspace")
        const shellState =
          status === "completed"
            ? await input.memoryStore.writeShellState({
                agentId: input.session.agentId,
                sessionId: input.session.id,
                cwd: nextCwd,
                updatedAt: nowIsoString(),
                env: nextEnv,
                persistentShell: {
                  shellId:
                    typeof resultRecord?.shellId === "string"
                      ? resultRecord.shellId
                      : (runtimeMemory.shellState?.persistentShell?.shellId ?? "unknown"),
                  shellPath:
                    typeof resultRecord?.shellPath === "string"
                      ? resultRecord.shellPath
                      : (runtimeMemory.shellState?.persistentShell?.shellPath ?? "unknown"),
                  startedAt:
                    typeof resultRecord?.startedAt === "string"
                      ? resultRecord.startedAt
                      : (runtimeMemory.shellState?.persistentShell?.startedAt ?? nowIsoString()),
                  updatedAt:
                    typeof resultRecord?.updatedAt === "string"
                      ? resultRecord.updatedAt
                      : nowIsoString(),
                  lastCommandAt:
                    typeof resultRecord?.lastCommandAt === "string"
                      ? resultRecord.lastCommandAt
                      : nowIsoString(),
                  commandCount:
                    typeof resultRecord?.commandCount === "number" &&
                    Number.isFinite(resultRecord.commandCount)
                      ? resultRecord.commandCount
                      : (runtimeMemory.shellState?.persistentShell?.commandCount ?? 0),
                  status: resultRecord?.status === "closed" ? "closed" : "active",
                },
                lastCommand: {
                  command: "persistent-shell",
                  args:
                    typeof resultRecord?.command === "string"
                      ? [resultRecord.command]
                      : ["unknown"],
                  cwd: nextCwd,
                  exitCode:
                    typeof resultRecord?.exitCode === "number" &&
                    Number.isFinite(resultRecord.exitCode)
                      ? (resultRecord.exitCode as number)
                      : null,
                  timedOut: resultRecord?.timedOut === true,
                  durationMs:
                    typeof resultRecord?.durationMs === "number" &&
                    Number.isFinite(resultRecord.durationMs)
                      ? (resultRecord.durationMs as number)
                      : 0,
                  updatedAt: nowIsoString(),
                  outputPreview: typeof waited.text === "string" ? waited.text : null,
                  stdoutPreview:
                    typeof resultRecord?.stdout === "string" ? resultRecord.stdout : null,
                  stderrPreview:
                    typeof resultRecord?.stderr === "string" ? resultRecord.stderr : null,
                },
              })
            : (runtimeMemory.shellState ?? null)
        const shellPosture = await resolveShellMutationPosture({
          sessionId: input.session.id,
          currentSessionId: input.session.id,
          agentId: input.session.agentId,
          memoryStore: input.memoryStore,
          sandbox: input.sandbox,
        })
        return asJson({
          sessionId: input.session.id,
          cwd: nextCwd,
          artifactPaths,
          status,
          persistentShell:
            output.persistentShell &&
            typeof output.persistentShell === "object" &&
            !Array.isArray(output.persistentShell)
              ? output.persistentShell
              : null,
          shellState,
          result:
            Object.hasOwn(output, "result") && output.result !== undefined ? output.result : null,
          error: typeof output.error === "string" ? output.error : null,
          busyPlan: shellPosture.busyPlan,
          recoveryPlan: shellPosture.recoveryPlan,
          nextStep: shellPosture.busyPlan
            ? {
                tool: shellPosture.busyPlan.tool,
                args: shellPosture.busyPlan.args,
                rationale: shellPosture.busyPlan.rationale,
              }
            : shellPosture.recoveryPlan,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_set_cwd",
      description:
        "Set the durable current working directory for the session-scoped shell hand after validating that the path exists inside a mounted sandbox root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          shellState: { type: "object" },
        },
      },
      effects: ["memory_write", "sandbox_execute"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const path = normalizeOptionalText((record as Record<string, unknown>).path)
        if (!path) {
          throw new Error("shell_set_cwd requires a non-empty path")
        }
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const statResult = await executeSandboxActionOrThrow(input.sandbox, "stat", {
          path,
        })
        const statOutput =
          statResult.output &&
          typeof statResult.output === "object" &&
          !Array.isArray(statResult.output)
            ? (statResult.output as Record<string, unknown>)
            : {}
        if (statOutput.kind !== "directory") {
          throw new Error(`shell_set_cwd requires a directory path: ${path}`)
        }
        const cwd = typeof statOutput.path === "string" ? statOutput.path : path
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd,
          updatedAt: nowIsoString(),
          env: runtimeMemory.shellState?.env ?? {},
        })
        return asJson({
          sessionId: input.session.id,
          cwd,
          shellState,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_set_env",
      description:
        "Persist one session-scoped shell environment variable so future bash and shell_run calls see the same execution context.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          key: { type: "string" },
          env: { type: "object" },
          shellState: { type: "object" },
        },
      },
      effects: ["memory_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const key = normalizeShellEnvKey((record as Record<string, unknown>).key)
        const value = normalizeOptionalText((record as Record<string, unknown>).value)
        if (value === null) {
          throw new Error("shell_set_env requires a non-empty value")
        }
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          updatedAt: nowIsoString(),
          env: {
            ...(runtimeMemory.shellState?.env ?? {}),
            [key]: value,
          },
        })
        return asJson({
          sessionId: input.session.id,
          key,
          env: summarizeShellEnv(shellState.env),
          shellState,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_unset_env",
      description:
        "Remove one session-scoped shell environment variable from the durable shell hand.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          key: { type: "string" },
          env: { type: "object" },
          shellState: { type: "object" },
        },
      },
      effects: ["memory_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const key = normalizeShellEnvKey((record as Record<string, unknown>).key)
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const nextEnv = { ...(runtimeMemory.shellState?.env ?? {}) }
        delete nextEnv[key]
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          updatedAt: nowIsoString(),
          env: nextEnv,
        })
        return asJson({
          sessionId: input.session.id,
          key,
          env: summarizeShellEnv(shellState.env),
          shellState,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_open",
      description:
        "Open or reuse a session-scoped persistent shell process for multi-step shell work inside the writable execution hand.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          restart: { type: "boolean" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          persistentShell: { type: ["object", "null"] },
          shellState: { type: "object" },
        },
      },
      effects: ["sandbox_execute", "memory_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const effectiveCwd =
          normalizeOptionalText((record as Record<string, unknown>).cwd) ??
          runtimeMemory.shellState?.cwd ??
          "/workspace"
        const opened = await executeSandboxActionOrThrow(input.sandbox, "open_persistent_shell", {
          cwd: effectiveCwd,
          restart: (record as Record<string, unknown>).restart === true,
          env: runtimeMemory.shellState?.env ?? {},
        })
        const output =
          opened.output && typeof opened.output === "object" && !Array.isArray(opened.output)
            ? (opened.output as Record<string, unknown>)
            : {}
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: typeof output.cwd === "string" ? output.cwd : effectiveCwd,
          updatedAt: nowIsoString(),
          env: runtimeMemory.shellState?.env ?? {},
          persistentShell: {
            shellId: typeof output.shellId === "string" ? output.shellId : "unknown",
            shellPath: typeof output.shellPath === "string" ? output.shellPath : "unknown",
            startedAt: typeof output.startedAt === "string" ? output.startedAt : nowIsoString(),
            updatedAt: typeof output.updatedAt === "string" ? output.updatedAt : nowIsoString(),
            lastCommandAt: typeof output.lastCommandAt === "string" ? output.lastCommandAt : null,
            commandCount:
              typeof output.commandCount === "number" && Number.isFinite(output.commandCount)
                ? output.commandCount
                : 0,
            status: output.status === "closed" ? "closed" : "active",
          },
        })
        return asJson({
          sessionId: input.session.id,
          cwd: shellState.cwd,
          persistentShell: shellState.persistentShell,
          shellState,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_restart",
      description:
        "Restart the session-scoped persistent shell process when shell_describe reports that the live shell is closed or stale.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          cwd: { type: "string" },
          persistentShell: { type: ["object", "null"] },
          shellState: { type: "object" },
        },
      },
      effects: ["sandbox_execute", "memory_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const effectiveCwd =
          normalizeOptionalText((record as Record<string, unknown>).cwd) ??
          runtimeMemory.shellState?.cwd ??
          "/workspace"
        const opened = await executeSandboxActionOrThrow(input.sandbox, "open_persistent_shell", {
          cwd: effectiveCwd,
          restart: true,
          env: runtimeMemory.shellState?.env ?? {},
        })
        const output =
          opened.output && typeof opened.output === "object" && !Array.isArray(opened.output)
            ? (opened.output as Record<string, unknown>)
            : {}
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: typeof output.cwd === "string" ? output.cwd : effectiveCwd,
          updatedAt: nowIsoString(),
          env: runtimeMemory.shellState?.env ?? {},
          persistentShell: {
            shellId: typeof output.shellId === "string" ? output.shellId : "unknown",
            shellPath: typeof output.shellPath === "string" ? output.shellPath : "unknown",
            startedAt: typeof output.startedAt === "string" ? output.startedAt : nowIsoString(),
            updatedAt: typeof output.updatedAt === "string" ? output.updatedAt : nowIsoString(),
            lastCommandAt: typeof output.lastCommandAt === "string" ? output.lastCommandAt : null,
            commandCount:
              typeof output.commandCount === "number" && Number.isFinite(output.commandCount)
                ? output.commandCount
                : 0,
            status: output.status === "closed" ? "closed" : "active",
          },
        })
        return asJson({
          sessionId: input.session.id,
          cwd: shellState.cwd,
          persistentShell: shellState.persistentShell,
          shellState,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_run",
      description:
        "Run a bounded writable shell command inside the session-scoped execution hand after confirmation. Use this when the next move genuinely requires shell composition or workspace mutation.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeoutMs: { type: "number" },
          maxOutputChars: { type: "number" },
        },
        required: ["command"],
      },
      outputSchema: buildSandboxExecutionResultSchema(),
      effects: ["sandbox_execute", "memory_write"],
      permissionPolicy: "always_ask",
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const command = normalizeOptionalText((record as Record<string, unknown>).command)
        if (!command) {
          throw new Error("shell_run requires a non-empty command")
        }
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const effectiveCwd =
          normalizeOptionalText((record as Record<string, unknown>).cwd) ??
          runtimeMemory.shellState?.cwd ??
          "/workspace"
        const commandResult = await executeSandboxActionOrThrow(input.sandbox, "run_shell", {
          command,
          cwd: effectiveCwd,
          timeoutMs: normalizeLimit((record as Record<string, unknown>).timeoutMs, 15_000),
          maxOutputChars: normalizeLimit(
            (record as Record<string, unknown>).maxOutputChars,
            12_000,
          ),
          env: runtimeMemory.shellState?.env ?? {},
        })
        const output =
          commandResult.output &&
          typeof commandResult.output === "object" &&
          !Array.isArray(commandResult.output)
            ? (commandResult.output as Record<string, unknown>)
            : {}
        const nextCwd = typeof output.cwd === "string" ? output.cwd : effectiveCwd
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: nextCwd,
          updatedAt: nowIsoString(),
          env: runtimeMemory.shellState?.env ?? {},
          lastCommand: {
            command: "shell",
            args: [command],
            cwd: nextCwd,
            exitCode:
              typeof output.exitCode === "number" && Number.isFinite(output.exitCode)
                ? (output.exitCode as number)
                : null,
            timedOut: output.timedOut === true,
            durationMs:
              typeof output.durationMs === "number" && Number.isFinite(output.durationMs)
                ? (output.durationMs as number)
                : 0,
            updatedAt: nowIsoString(),
            outputPreview: typeof commandResult.text === "string" ? commandResult.text : null,
            stdoutPreview: typeof output.stdout === "string" ? output.stdout : null,
            stderrPreview: typeof output.stderr === "string" ? output.stderr : null,
          },
        })
        return asJson({
          ...commandResult,
          output: {
            ...output,
            shellState,
          },
        })
      },
      pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
      pendingToolConfirmationDecision,
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_exec",
      description:
        "Run a command through the session-scoped persistent shell process after confirmation, preserving shell cwd and environment drift across steps.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeoutMs: { type: "number" },
          maxOutputChars: { type: "number" },
          restart: { type: "boolean" },
        },
        required: ["command"],
      },
      outputSchema: buildSandboxExecutionResultSchema(),
      effects: ["sandbox_execute", "memory_write"],
      permissionPolicy: "always_ask",
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const command = normalizeOptionalText((record as Record<string, unknown>).command)
        if (!command) {
          throw new Error("shell_exec requires a non-empty command")
        }
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const effectiveCwd =
          normalizeOptionalText((record as Record<string, unknown>).cwd) ??
          runtimeMemory.shellState?.cwd ??
          "/workspace"
        const commandResult = await executeSandboxActionOrThrow(
          input.sandbox,
          "exec_persistent_shell",
          {
            command,
            cwd: effectiveCwd,
            restart: (record as Record<string, unknown>).restart === true,
            timeoutMs: normalizeLimit((record as Record<string, unknown>).timeoutMs, 15_000),
            maxOutputChars: normalizeLimit(
              (record as Record<string, unknown>).maxOutputChars,
              12_000,
            ),
            env: runtimeMemory.shellState?.env ?? {},
          },
        )
        const output =
          commandResult.output &&
          typeof commandResult.output === "object" &&
          !Array.isArray(commandResult.output)
            ? (commandResult.output as Record<string, unknown>)
            : {}
        const nextEnv =
          output.env && typeof output.env === "object" && !Array.isArray(output.env)
            ? (output.env as Record<string, string>)
            : (runtimeMemory.shellState?.env ?? {})
        const nextCwd = typeof output.cwd === "string" ? output.cwd : effectiveCwd
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: nextCwd,
          updatedAt: nowIsoString(),
          env: nextEnv,
          persistentShell: {
            shellId: typeof output.shellId === "string" ? output.shellId : "unknown",
            shellPath: typeof output.shellPath === "string" ? output.shellPath : "unknown",
            startedAt:
              typeof output.startedAt === "string"
                ? output.startedAt
                : (runtimeMemory.shellState?.persistentShell?.startedAt ?? nowIsoString()),
            updatedAt: typeof output.updatedAt === "string" ? output.updatedAt : nowIsoString(),
            lastCommandAt:
              typeof output.lastCommandAt === "string" ? output.lastCommandAt : nowIsoString(),
            commandCount:
              typeof output.commandCount === "number" && Number.isFinite(output.commandCount)
                ? output.commandCount
                : (runtimeMemory.shellState?.persistentShell?.commandCount ?? 0) + 1,
            status: output.status === "closed" ? "closed" : "active",
          },
          lastCommand: {
            command: "persistent-shell",
            args: [command],
            cwd: nextCwd,
            exitCode:
              typeof output.exitCode === "number" && Number.isFinite(output.exitCode)
                ? (output.exitCode as number)
                : null,
            timedOut: output.timedOut === true,
            durationMs:
              typeof output.durationMs === "number" && Number.isFinite(output.durationMs)
                ? (output.durationMs as number)
                : 0,
            updatedAt: nowIsoString(),
            outputPreview: typeof commandResult.text === "string" ? commandResult.text : null,
            stdoutPreview: typeof output.stdout === "string" ? output.stdout : null,
            stderrPreview: typeof output.stderr === "string" ? output.stderr : null,
          },
        })
        return asJson({
          ...commandResult,
          output: {
            ...(output ?? {}),
            cwd: shellState.cwd,
            env: shellState.env,
            persistentShell: shellState.persistentShell,
          },
        })
      },
      pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
      pendingToolConfirmationDecision,
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "shell_close",
      description:
        "Close the active session-scoped persistent shell process when multi-step shell work is done.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          closed: { type: "boolean" },
          shellState: { type: "object" },
        },
      },
      effects: ["sandbox_execute", "memory_write"],
      readOnly: false,
      execute: async () => {
        const runtimeMemory = await input.memoryStore.read(input.session.agentId, input.session.id)
        const closed = await executeSandboxActionOrThrow(
          input.sandbox,
          "close_persistent_shell",
          {},
        )
        const shellState = await input.memoryStore.writeShellState({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          cwd: runtimeMemory.shellState?.cwd ?? "/workspace",
          updatedAt: nowIsoString(),
          env: runtimeMemory.shellState?.env ?? {},
          persistentShell: runtimeMemory.shellState?.persistentShell
            ? {
                ...runtimeMemory.shellState.persistentShell,
                status: "closed",
                updatedAt: nowIsoString(),
              }
            : null,
        })
        return asJson({
          sessionId: input.session.id,
          ...(closed.output && typeof closed.output === "object" && !Array.isArray(closed.output)
            ? closed.output
            : { closed: false }),
          shellState,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_stage_from_substrate",
      description:
        "Copy a file from the shared agent substrate into the writable session workspace so it can be edited safely in the current execution hand.",
      inputSchema: {
        type: "object",
        properties: {
          sourcePath: { type: "string" },
          targetPath: { type: "string" },
          overwrite: { type: "boolean" },
        },
        required: ["sourcePath"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          sourcePath: { type: "string" },
          targetPath: { type: "string" },
          bytes: { type: "number" },
          reusedExisting: { type: "boolean" },
          divergedFromSource: { type: "boolean" },
          sourceContentHash: { type: "string" },
          targetContentHash: { type: "string" },
        },
      },
      effects: ["resource_read", "resource_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const sourcePath = normalizeOptionalText((record as Record<string, unknown>).sourcePath)
        if (!sourcePath) {
          throw new Error("resources_stage_from_substrate requires a non-empty sourcePath")
        }
        const targetPath = normalizeOptionalText((record as Record<string, unknown>).targetPath)
        const overwrite =
          typeof (record as Record<string, unknown>).overwrite === "boolean"
            ? ((record as Record<string, unknown>).overwrite as boolean)
            : false
        const staged = await stageSubstrateArtifactToSessionWorkspace({
          session: input.session,
          sourcePath,
          targetPath,
          overwrite,
        })
        return asJson({
          sessionId: input.session.id,
          sourcePath: staged.sourcePath,
          targetPath: staged.targetPath,
          bytes: staged.bytes,
          reusedExisting: staged.reusedExisting,
          divergedFromSource: staged.divergedFromSource,
          sourceContentHash: staged.sourceContentHash,
          targetContentHash: staged.targetContentHash,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_list_staged_drafts",
      description:
        "Inspect staged substrate drafts in the writable session workspace and report whether each draft is still pending promotion or already in sync with the shared substrate.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          drafts: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["resource_read"],
      execute: async () => {
        const drafts = await listStagedSubstrateDrafts({
          session: input.session,
        })
        return asJson({
          count: drafts.length,
          drafts,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_list_versions",
      description:
        "List immutable versions for one shared substrate path that was previously promoted from a session workspace.",
      inputSchema: {
        type: "object",
        properties: {
          targetPath: { type: "string" },
          limit: { type: "number" },
        },
        required: ["targetPath"],
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          versions: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["resource_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const targetPath = normalizeOptionalText((record as Record<string, unknown>).targetPath)
        if (!targetPath) {
          throw new Error("resources_list_versions requires a non-empty targetPath")
        }
        const versions = await substrateVersionStore.listVersions({
          agentId: input.session.agentId,
          targetPath,
          limit: normalizeLimit((record as Record<string, unknown>).limit, 10),
        })
        return asJson({
          count: versions.length,
          versions,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_read_version",
      description: "Read one immutable version of a shared substrate artifact by versionId.",
      inputSchema: {
        type: "object",
        properties: {
          versionId: { type: "string" },
        },
        required: ["versionId"],
      },
      outputSchema: {
        type: "object",
        properties: {
          version: { type: "object" },
          content: { type: "string" },
        },
      },
      effects: ["resource_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const versionId = normalizeOptionalText((record as Record<string, unknown>).versionId)
        if (!versionId) {
          throw new Error("resources_read_version requires a non-empty versionId")
        }
        const version = await substrateVersionStore.readVersion({
          agentId: input.session.agentId,
          versionId,
        })
        if (!version) {
          throw new Error(`No substrate version exists for versionId=${versionId}`)
        }
        return asJson({
          version: version.record,
          content: version.content,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_restore_version",
      description:
        "Restore one immutable substrate version back into the shared agent substrate as a new promoted version.",
      inputSchema: {
        type: "object",
        properties: {
          versionId: { type: "string" },
          requireOutcomePass: { type: "boolean" },
          expectedVersionId: { type: "string" },
          expectedContentHash: { type: "string" },
        },
        required: ["versionId"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          restoredFromVersionId: { type: "string" },
          targetPath: { type: "string" },
          bytes: { type: "number" },
          versionId: { type: "string" },
          previousVersionId: { type: ["string", "null"] },
          contentHash: { type: "string" },
          outcomeEvaluation: { type: ["object", "null"] },
        },
      },
      effects: ["resource_write"],
      permissionPolicy: "always_ask",
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const versionId = normalizeOptionalText((record as Record<string, unknown>).versionId)
        const requireOutcomePass =
          typeof (record as Record<string, unknown>).requireOutcomePass === "boolean"
            ? ((record as Record<string, unknown>).requireOutcomePass as boolean)
            : null
        const expectedVersionId = normalizeOptionalText(
          (record as Record<string, unknown>).expectedVersionId,
        )
        const expectedContentHash = normalizeOptionalText(
          (record as Record<string, unknown>).expectedContentHash,
        )
        if (!versionId) {
          throw new Error("resources_restore_version requires a non-empty versionId")
        }
        const version = await substrateVersionStore.readVersion({
          agentId: input.session.agentId,
          versionId,
        })
        if (!version) {
          throw new Error(`No substrate version exists for versionId=${versionId}`)
        }
        const previousVersion = await substrateVersionStore.latestVersion({
          agentId: input.session.agentId,
          targetPath: version.record.targetPath,
        })
        if (expectedVersionId && previousVersion?.versionId !== expectedVersionId) {
          throw new Error(
            `resources_restore_version version precondition failed: expected ${expectedVersionId} but latest is ${previousVersion?.versionId ?? "none"}`,
          )
        }
        const restoredTarget = resolveSharedSubstrateTarget({
          session: input.session,
          targetPath: version.record.targetPath,
        })
        const liveTargetText = await readFile(restoredTarget.actualPath, "utf8").catch(
          (error: unknown) => {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              return null
            }
            throw error
          },
        )
        const liveTargetHash = liveTargetText !== null ? computeTextHash(liveTargetText) : null
        if (expectedContentHash && liveTargetHash !== expectedContentHash) {
          throw new Error(
            `resources_restore_version content precondition failed: expected ${expectedContentHash} but latest is ${liveTargetHash ?? "none"}`,
          )
        }
        const outcomeEvaluation = await enforceOutcomePromotionGate({
          toolName: "resources_restore_version",
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          sandbox: input.sandbox,
          requireOutcomePass,
        })
        const restored = await restoreSessionWorkspaceArtifactVersion({
          session: input.session,
          targetPath: version.record.targetPath,
          content: version.content,
          overwrite: true,
        })
        const nextVersion = await substrateVersionStore.recordPromotion({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          sourcePath: version.record.targetPath,
          targetPath: version.record.targetPath,
          content: version.content,
          createdAt: nowIsoString(),
          wakeId: input.wakeId,
        })
        return asJson({
          sessionId: input.session.id,
          restoredFromVersionId: version.record.versionId,
          targetPath: restored.targetPath,
          bytes: restored.bytes,
          versionId: nextVersion.versionId,
          previousVersionId: previousVersion?.versionId ?? null,
          contentHash: nextVersion.contentHash,
          outcomeEvaluation: outcomeEvaluation.evaluation,
        })
      },
      pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
      pendingToolConfirmationDecision,
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_compare_with_substrate",
      description:
        "Compare a session workspace file against the corresponding shared substrate file before deciding whether to promote it.",
      inputSchema: {
        type: "object",
        properties: {
          sessionPath: { type: "string" },
          substratePath: { type: "string" },
          maxPreviewLines: { type: "number" },
        },
        required: ["sessionPath"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          sessionPath: { type: "string" },
          substratePath: { type: "string" },
          substrateExists: { type: "boolean" },
          identical: { type: "boolean" },
          sessionCharCount: { type: "number" },
          substrateCharCount: { type: "number" },
          sessionContentHash: { type: "string" },
          substrateContentHash: { type: ["string", "null"] },
          latestVersionId: { type: ["string", "null"] },
          latestVersionCreatedAt: { type: ["string", "null"] },
          latestVersionContentHash: { type: ["string", "null"] },
          latestVersionWakeId: { type: ["string", "null"] },
          promotePrecondition: {
            type: "object",
            properties: {
              expectedVersionId: { type: ["string", "null"] },
              expectedContentHash: { type: ["string", "null"] },
              versionAvailable: { type: "boolean" },
              contentHashAvailable: { type: "boolean" },
            },
          },
          differingLineCount: { type: "number" },
          preview: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["resource_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const sessionPath = normalizeOptionalText((record as Record<string, unknown>).sessionPath)
        if (!sessionPath) {
          throw new Error("resources_compare_with_substrate requires a non-empty sessionPath")
        }
        const substratePath = normalizeOptionalText(
          (record as Record<string, unknown>).substratePath,
        )
        const comparison = await compareSessionWorkspaceArtifactToSubstrate({
          session: input.session,
          sessionPath,
          substratePath,
          maxPreviewLines: normalizeLimit((record as Record<string, unknown>).maxPreviewLines, 12),
        })
        const latestVersion = await substrateVersionStore.latestVersion({
          agentId: input.session.agentId,
          targetPath: comparison.substratePath,
        })
        return asJson({
          sessionId: input.session.id,
          ...comparison,
          latestVersionId: latestVersion?.versionId ?? null,
          latestVersionCreatedAt: latestVersion?.createdAt ?? null,
          latestVersionContentHash: latestVersion?.contentHash ?? null,
          latestVersionWakeId: latestVersion?.wakeId ?? null,
          promotePrecondition: {
            expectedVersionId: latestVersion?.versionId ?? null,
            expectedContentHash: comparison.substrateContentHash,
            versionAvailable: latestVersion !== null,
            contentHashAvailable: comparison.substrateContentHash !== null,
          },
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "resources_promote_to_substrate",
      description:
        "Promote a file from the writable session workspace into the shared agent workspace substrate so future sessions can reuse it.",
      inputSchema: {
        type: "object",
        properties: {
          sourcePath: { type: "string" },
          targetPath: { type: "string" },
          overwrite: { type: "boolean" },
          requireOutcomePass: { type: "boolean" },
          expectedVersionId: { type: "string" },
          expectedContentHash: { type: "string" },
        },
        required: ["sourcePath"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          sourcePath: { type: "string" },
          targetPath: { type: "string" },
          bytes: { type: "number" },
          versionId: { type: "string" },
          previousVersionId: { type: ["string", "null"] },
          contentHash: { type: "string" },
          outcomeEvaluation: { type: ["object", "null"] },
        },
      },
      effects: ["resource_write"],
      permissionPolicy: "always_ask",
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const sourcePath = normalizeOptionalText((record as Record<string, unknown>).sourcePath)
        if (!sourcePath) {
          throw new Error("resources_promote_to_substrate requires a non-empty sourcePath")
        }
        const targetPath = normalizeOptionalText((record as Record<string, unknown>).targetPath)
        const overwrite =
          typeof (record as Record<string, unknown>).overwrite === "boolean"
            ? ((record as Record<string, unknown>).overwrite as boolean)
            : false
        const requireOutcomePass =
          typeof (record as Record<string, unknown>).requireOutcomePass === "boolean"
            ? ((record as Record<string, unknown>).requireOutcomePass as boolean)
            : null
        const expectedVersionId = normalizeOptionalText(
          (record as Record<string, unknown>).expectedVersionId,
        )
        const expectedContentHash = normalizeOptionalText(
          (record as Record<string, unknown>).expectedContentHash,
        )
        const expectedTargetPath = targetPath?.trim() || sourcePath
        const resolvedTarget = resolveSharedSubstrateTarget({
          session: input.session,
          targetPath: expectedTargetPath,
        })
        const previousVersion = await substrateVersionStore.latestVersion({
          agentId: input.session.agentId,
          targetPath: resolvedTarget.relativePath,
        })
        if (expectedVersionId && previousVersion?.versionId !== expectedVersionId) {
          throw new Error(
            `resources_promote_to_substrate version precondition failed: expected ${expectedVersionId} but latest is ${previousVersion?.versionId ?? "none"}`,
          )
        }
        const liveTargetText = await readFile(resolvedTarget.actualPath, "utf8").catch(
          (error: unknown) => {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              return null
            }
            throw error
          },
        )
        const liveTargetHash = liveTargetText !== null ? computeTextHash(liveTargetText) : null
        if (expectedContentHash && liveTargetHash !== expectedContentHash) {
          throw new Error(
            `resources_promote_to_substrate content precondition failed: expected ${expectedContentHash} but latest is ${liveTargetHash ?? "none"}`,
          )
        }
        const outcomeEvaluation = await enforceOutcomePromotionGate({
          toolName: "resources_promote_to_substrate",
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          sandbox: input.sandbox,
          requireOutcomePass,
        })
        const promoted = await promoteSessionWorkspaceArtifact({
          session: input.session,
          sourcePath,
          targetPath,
          overwrite,
        })
        const promotedTarget = resolveSharedSubstrateTarget({
          session: input.session,
          targetPath: promoted.targetPath,
        })
        const promotedText = await readFile(promotedTarget.actualPath, "utf8")
        const version = await substrateVersionStore.recordPromotion({
          agentId: input.session.agentId,
          sessionId: input.session.id,
          sourcePath: promoted.sourcePath,
          targetPath: promotedTarget.relativePath,
          content: promotedText,
          createdAt: nowIsoString(),
          wakeId: input.wakeId,
        })
        return asJson({
          sessionId: input.session.id,
          sourcePath: promoted.sourcePath,
          targetPath: promoted.targetPath,
          bytes: promoted.bytes,
          versionId: version.versionId,
          previousVersionId: previousVersion?.versionId ?? null,
          contentHash: version.contentHash,
          outcomeEvaluation: outcomeEvaluation.evaluation,
        })
      },
      pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
      pendingToolConfirmationDecision,
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_list",
      description:
        "List the attached managed memory stores that this session can inspect or update.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          stores: {
            type: "array",
            items: buildManagedMemoryStoreSchema(),
          },
        },
      },
      effects: ["memory_read"],
      execute: async () =>
        asJson({
          count: listManagedMemoryStores().length,
          stores: listManagedMemoryStores(),
        }),
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_read",
      description:
        "Read attached managed memory stores for this session, another same-agent session, or promoted agent memory.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: listManagedMemoryStores().map((store) => store.target),
          },
          sessionId: { type: "string" },
        },
        required: ["target"],
      },
      outputSchema: {
        type: "string",
      },
      effects: ["memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const descriptor =
          resolveManagedMemoryStore((record as Record<string, unknown>).target) ??
          resolveManagedMemoryStore("checkpoint")
        switch (descriptor?.target) {
          case "session_state":
          case "working_buffer":
          case "checkpoint": {
            const targetSessionId = await resolveScopedSessionId({
              requestedSessionId: normalizeOptionalText(
                (record as Record<string, unknown>).sessionId,
              ),
              session: input.session,
              sessionStore: input.sessionStore,
            })
            const runtimeMemory = await input.memoryStore.read(
              input.session.agentId,
              targetSessionId,
            )
            if (descriptor.target === "session_state") {
              return runtimeMemory.sessionState ?? "No session-state.md content is available."
            }
            if (descriptor.target === "working_buffer") {
              return runtimeMemory.workingBuffer ?? "No working-buffer.md content is available."
            }
            return asJson(runtimeMemory.checkpoint ?? { checkpoint: null })
          }
          case "shell_state": {
            const targetSessionId = await resolveScopedSessionId({
              requestedSessionId: normalizeOptionalText(
                (record as Record<string, unknown>).sessionId,
              ),
              session: input.session,
              sessionStore: input.sessionStore,
            })
            const runtimeMemory = await input.memoryStore.read(
              input.session.agentId,
              targetSessionId,
            )
            return asJson(runtimeMemory.shellState ?? { shellState: null })
          }
          case "workspace_memory":
            return (
              (await input.learningsStore
                .readWorkspaceMemory(input.session.agentId)
                .catch(() => "")) || "No workspace MEMORY.md content is available."
            )
          case "workspace_memory_notes":
            return (
              (await readAgentWorkspaceManagedMemoryNotes(
                input.companyDir,
                input.session.agentId,
              )) ?? "No managed workspace memory notes are available."
            )
          default:
            return asJson({ checkpoint: null })
        }
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_list_versions",
      description:
        "List immutable versions for writable managed memory stores such as session-state.md, working-buffer.md, and shared managed memory notes.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["session_state", "working_buffer", "workspace_memory_notes"],
          },
          sessionId: { type: "string" },
          limit: { type: "number" },
        },
        required: ["target"],
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          versions: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const target = normalizeOptionalText((record as Record<string, unknown>).target)
        if (
          target !== "session_state" &&
          target !== "working_buffer" &&
          target !== "workspace_memory_notes"
        ) {
          throw new Error(
            "memory_list_versions requires target=session_state, target=working_buffer, or target=workspace_memory_notes",
          )
        }
        const scopedSessionId =
          target === "workspace_memory_notes"
            ? null
            : await resolveScopedSessionId({
                requestedSessionId: normalizeOptionalText(
                  (record as Record<string, unknown>).sessionId,
                ),
                session: input.session,
                sessionStore: input.sessionStore,
              })
        const versions = await memoryVersionStore.listVersions({
          agentId: input.session.agentId,
          sessionId: scopedSessionId,
          target: target as ManagedVersionedMemoryTarget,
          limit: normalizeLimit((record as Record<string, unknown>).limit, 10),
        })
        return asJson({
          count: versions.length,
          versions,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_read_version",
      description: "Read one immutable version of a writable managed memory store by versionId.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["session_state", "working_buffer", "workspace_memory_notes"],
          },
          versionId: { type: "string" },
          sessionId: { type: "string" },
        },
        required: ["target", "versionId"],
      },
      outputSchema: {
        type: "object",
        properties: {
          version: { type: "object" },
          content: { type: "string" },
        },
      },
      effects: ["memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const target = normalizeOptionalText((record as Record<string, unknown>).target)
        const versionId = normalizeOptionalText((record as Record<string, unknown>).versionId)
        if (
          (target !== "session_state" &&
            target !== "working_buffer" &&
            target !== "workspace_memory_notes") ||
          !versionId
        ) {
          throw new Error(
            "memory_read_version requires target=session_state|working_buffer|workspace_memory_notes and a non-empty versionId",
          )
        }
        const scopedSessionId =
          target === "workspace_memory_notes"
            ? null
            : await resolveScopedSessionId({
                requestedSessionId: normalizeOptionalText(
                  (record as Record<string, unknown>).sessionId,
                ),
                session: input.session,
                sessionStore: input.sessionStore,
              })
        const version = await memoryVersionStore.readVersion({
          agentId: input.session.agentId,
          sessionId: scopedSessionId,
          target: target as ManagedVersionedMemoryTarget,
          versionId,
        })
        if (!version) {
          throw new Error(`No managed memory version exists for versionId=${versionId}`)
        }
        return asJson({
          version: version.record,
          content: version.content,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_write",
      description:
        "Write or append bounded managed memory stores such as session-state.md, working-buffer.md, and managed workspace notes.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: listWritableManagedMemoryStores()
              .filter((store) => store.scope === "session")
              .map((store) => store.target),
          },
          content: { type: "string" },
          mode: {
            type: "string",
            enum: ["replace", "append"],
          },
          expectedVersionId: { type: "string" },
          sessionId: { type: "string" },
        },
        required: ["target", "content"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          target: { type: "string" },
          mode: { type: "string" },
          path: { type: "string" },
          versionId: { type: "string" },
          previousVersionId: { type: ["string", "null"] },
          contentHash: { type: "string" },
          content: { type: "string" },
        },
      },
      effects: ["memory_write"],
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const descriptor = resolveManagedMemoryStore((record as Record<string, unknown>).target)
        if (!descriptor?.writable || descriptor.scope !== "session") {
          throw new Error("memory_write requires target=session_state or target=working_buffer")
        }
        const content = normalizeOptionalText((record as Record<string, unknown>).content)
        if (!content) {
          throw new Error("memory_write requires non-empty content")
        }
        const mode = (record as Record<string, unknown>).mode === "append" ? "append" : "replace"
        const expectedVersionId = normalizeOptionalText(
          (record as Record<string, unknown>).expectedVersionId,
        )
        const targetSessionId = await resolveScopedSessionId({
          requestedSessionId: normalizeOptionalText((record as Record<string, unknown>).sessionId),
          session: input.session,
          sessionStore: input.sessionStore,
        })
        if (descriptor.target !== "session_state" && descriptor.target !== "working_buffer") {
          throw new Error(
            `memory_write cannot write target=${descriptor.target} through the session runtime store`,
          )
        }
        const previousVersion = await memoryVersionStore.latestVersion({
          agentId: input.session.agentId,
          sessionId: targetSessionId,
          target: descriptor.target,
        })
        if (expectedVersionId && previousVersion?.versionId !== expectedVersionId) {
          throw new Error(
            `memory_write version precondition failed for ${descriptor.target}: expected ${expectedVersionId} but latest is ${previousVersion?.versionId ?? "none"}`,
          )
        }
        const written = await input.memoryStore.writeTarget({
          agentId: input.session.agentId,
          sessionId: targetSessionId,
          target: descriptor.target,
          content,
          mode,
        })
        const version = await memoryVersionStore.recordVersion({
          agentId: input.session.agentId,
          sessionId: targetSessionId,
          target: descriptor.target,
          content: written.content,
          createdAt: nowIsoString(),
          source: "memory_write",
          mode,
          wakeId: input.wakeId,
        })
        return asJson({
          sessionId: targetSessionId,
          target: descriptor.target,
          mode,
          path: written.path,
          versionId: version.versionId,
          previousVersionId: previousVersion?.versionId ?? null,
          contentHash: version.contentHash,
          content: written.content,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_promote_note",
      description:
        "Promote a durable agent-level note into the managed notes section of shared MEMORY.md.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          mode: {
            type: "string",
            enum: ["replace", "append"],
          },
          requireOutcomePass: { type: "boolean" },
          expectedVersionId: { type: "string" },
        },
        required: ["content"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          target: { type: "string" },
          mode: { type: "string" },
          path: { type: "string" },
          versionId: { type: "string" },
          previousVersionId: { type: ["string", "null"] },
          contentHash: { type: "string" },
          content: { type: "string" },
          outcomeEvaluation: { type: ["object", "null"] },
        },
      },
      effects: ["memory_write"],
      permissionPolicy: "always_ask",
      readOnly: false,
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const content = normalizeOptionalText((record as Record<string, unknown>).content)
        if (!content) {
          throw new Error("memory_promote_note requires non-empty content")
        }
        const mode = (record as Record<string, unknown>).mode === "append" ? "append" : "replace"
        const requireOutcomePass =
          typeof (record as Record<string, unknown>).requireOutcomePass === "boolean"
            ? ((record as Record<string, unknown>).requireOutcomePass as boolean)
            : null
        const expectedVersionId = normalizeOptionalText(
          (record as Record<string, unknown>).expectedVersionId,
        )
        const previousVersion = await memoryVersionStore.latestVersion({
          agentId: input.session.agentId,
          sessionId: null,
          target: "workspace_memory_notes",
        })
        if (expectedVersionId && previousVersion?.versionId !== expectedVersionId) {
          throw new Error(
            `memory_promote_note version precondition failed: expected ${expectedVersionId} but latest is ${previousVersion?.versionId ?? "none"}`,
          )
        }
        const outcomeEvaluation = await enforceOutcomePromotionGate({
          toolName: "memory_promote_note",
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          sandbox: input.sandbox,
          requireOutcomePass,
        })
        const nextContent = await writeAgentWorkspaceManagedMemoryNotes({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          content,
          mode,
        })
        const version = await memoryVersionStore.recordVersion({
          agentId: input.session.agentId,
          sessionId: null,
          target: "workspace_memory_notes",
          content: nextContent,
          createdAt: nowIsoString(),
          source: "memory_promote_note",
          mode,
          wakeId: input.wakeId,
        })
        return asJson({
          sessionId: input.session.id,
          target: "workspace_memory_notes",
          mode,
          path: input.learningsStore.workspaceMemoryPath(input.session.agentId),
          versionId: version.versionId,
          previousVersionId: previousVersion?.versionId ?? null,
          contentHash: version.contentHash,
          content: nextContent,
          outcomeEvaluation: outcomeEvaluation.evaluation,
        })
      },
      pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
      pendingToolConfirmationDecision,
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "retrieval_search",
      description:
        "Search cross-session recall candidates across multiple deterministic retrieval backends, then expand with lower-level tools when needed.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          includeCurrent: { type: "boolean" },
          lineage: {
            type: "string",
            enum: ["related", "parent", "children", "siblings"],
          },
          backends: {
            type: "array",
            items: {
              type: "string",
              enum: ["memory", "session_context", "session_trace", "vector"],
            },
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          query: { type: "string" },
          count: { type: "number" },
          backendSummary: {
            type: "array",
            items: { type: "object" },
          },
          expansionPlan: {
            type: "array",
            items: { type: "object" },
          },
          hits: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["memory_read", "session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const query = normalizeOptionalText((record as Record<string, unknown>).query) ?? ""
        if (query.length === 0) {
          throw new Error("retrieval_search requires a non-empty query")
        }
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 8)
        const result = await searchCrossSessionRecall({
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          learningsStore: input.learningsStore,
          currentAgentSetupFingerprint:
            input.runtimeMemorySnapshot?.checkpoint?.lastAgentSetupFingerprint ?? null,
          currentActiveOutcome: input.runtimeMemorySnapshot?.checkpoint?.activeOutcome ?? null,
          query,
          limit,
          includeCurrent:
            typeof (record as Record<string, unknown>).includeCurrent === "boolean"
              ? ((record as Record<string, unknown>).includeCurrent as boolean)
              : false,
          lineage: normalizeRetrievalLineage((record as Record<string, unknown>).lineage),
          backends: normalizeRetrievalBackends((record as Record<string, unknown>).backends),
        })
        const currentEvaluation = (
          await evaluateScopedSessionOutcome({
            session: input.session,
            sessionStore: input.sessionStore,
            memoryStore: input.memoryStore,
            sandbox: input.sandbox,
          })
        ).evaluation
        const presentation = presentRetrievalSearchResult(result, {
          currentOutcomeEvaluation: currentEvaluation,
        })
        return asJson({
          agentId: input.session.agentId,
          query,
          count: result.hits.length,
          backendSummary: presentation.backendSummary,
          expansionPlan: presentation.expansionPlan,
          hits: result.hits,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "memory_search",
      description:
        "Search cross-session agent memory, including captured learnings, workspace memory, and other session checkpoints.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          lineage: {
            type: "string",
            enum: ["related", "parent", "children", "siblings"],
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          query: { type: "string" },
          count: { type: "number" },
          hits: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["memory_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const query = normalizeOptionalText((record as Record<string, unknown>).query) ?? ""
        if (query.length === 0) {
          throw new Error("memory_search requires a non-empty query")
        }
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 8)
        const hits = await searchAgentMemory({
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          learningsStore: input.learningsStore,
          currentAgentSetupFingerprint:
            input.runtimeMemorySnapshot?.checkpoint?.lastAgentSetupFingerprint ?? null,
          currentActiveOutcome: input.runtimeMemorySnapshot?.checkpoint?.activeOutcome ?? null,
          query,
          limit,
          lineage: normalizeRetrievalLineage((record as Record<string, unknown>).lineage),
        })
        return asJson({
          agentId: input.session.agentId,
          query,
          count: hits.length,
          hits,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "session_search_context",
      description:
        "Search other same-agent sessions for relevant context hits, then reread the best session around the returned event IDs.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          includeCurrent: { type: "boolean" },
          lineage: {
            type: "string",
            enum: ["related", "parent", "children", "siblings"],
          },
          types: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "user.message",
                "user.define_outcome",
                "user.interrupt",
                "user.tool_confirmation",
                "user.custom_tool_result",
                "session.status_changed",
                "session.status_idle",
                "agent.message",
                "agent.tool_use",
                "agent.custom_tool_use",
              ],
            },
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          query: { type: "string" },
          count: { type: "number" },
          hits: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const query = normalizeOptionalText((record as Record<string, unknown>).query) ?? ""
        if (query.length === 0) {
          throw new Error("session_search_context requires a non-empty query")
        }
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 8)
        const hits = await searchAgentSessionContext({
          session: input.session,
          sessionStore: input.sessionStore,
          memoryStore: input.memoryStore,
          query,
          limit,
          includeCurrent:
            typeof (record as Record<string, unknown>).includeCurrent === "boolean"
              ? ((record as Record<string, unknown>).includeCurrent as boolean)
              : false,
          lineage: normalizeRetrievalLineage((record as Record<string, unknown>).lineage),
          currentAgentSetupFingerprint:
            input.runtimeMemorySnapshot?.checkpoint?.lastAgentSetupFingerprint ?? null,
          currentActiveOutcome: input.runtimeMemorySnapshot?.checkpoint?.activeOutcome ?? null,
          types: normalizeEventTypes((record as Record<string, unknown>).types),
        })
        return asJson({
          agentId: input.session.agentId,
          query,
          count: hits.length,
          hits,
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "learning_list",
      description: "List reusable learnings captured for this agent across sessions.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          count: { type: "number" },
          learnings: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["learning_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 20)
        const learnings = await input.learningsStore.list(input.session.agentId)
        return asJson({
          agentId: input.session.agentId,
          count: Math.min(limit, learnings.length),
          learnings: learnings.slice(-limit),
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "skills_list",
      description: "List the skill entries currently available to this agent runtime.",
      inputSchema: {},
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          skills: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                preview: { type: ["string", "null"] },
                source: { type: "string" },
                nextStep: { type: "object" },
              },
            },
          },
        },
      },
      effects: ["skill_read"],
      execute: async () =>
        asJson({
          count: skillEntries.length,
          skills: skillEntries.map((entry) => ({
            name: entry.name,
            description: entry.description,
            preview: entry.preview,
            source: entry.source,
            nextStep: buildSkillReadNextStep(entry.name),
          })),
        }),
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "skills_search",
      description:
        "Search available skill entries so the model can pick the most relevant operating procedure for the current task.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          hits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                preview: { type: ["string", "null"] },
                source: { type: "string" },
                filePath: { type: "string" },
                baseDir: { type: "string" },
                score: { type: "number" },
                reasons: {
                  type: "array",
                  items: { type: "string" },
                },
                nextStep: { type: "object" },
              },
            },
          },
        },
      },
      effects: ["skill_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const query = normalizeOptionalText((record as Record<string, unknown>).query) ?? ""
        if (query.length === 0) {
          throw new Error("skills_search requires a non-empty query")
        }
        const limit = normalizeLimit((record as Record<string, unknown>).limit, 8)
        const hits = searchSkillEntries(skillEntries, query, limit)
        return asJson({
          count: hits.length,
          hits: hits.map((hit) => ({
            ...hit,
            nextStep: buildSkillReadNextStep(hit.name),
          })),
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "skills_read",
      description:
        "Read the full body of one named skill after you have identified it from skills_search or skills_list.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          maxChars: { type: "number" },
        },
        required: ["name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          preview: { type: ["string", "null"] },
          source: { type: "string" },
          filePath: { type: "string" },
          baseDir: { type: "string" },
          content: { type: "string" },
          truncated: { type: "boolean" },
        },
      },
      effects: ["skill_read"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const name = normalizeOptionalText((record as Record<string, unknown>).name) ?? ""
        if (name.length === 0) {
          throw new Error("skills_read requires a non-empty name")
        }
        const entry = findSkillEntryByName(skillEntries, name)
        if (!entry) {
          throw new Error(`Unknown skill: ${name}`)
        }
        const maxChars =
          typeof (record as Record<string, unknown>).maxChars === "number" &&
          Number.isFinite((record as Record<string, unknown>).maxChars) &&
          Number((record as Record<string, unknown>).maxChars) > 0
            ? Math.floor(Number((record as Record<string, unknown>).maxChars))
            : undefined
        return asJson(await readSkillEntry(entry, { maxChars }))
      },
      onToolUse: input.onToolUse,
    }),
  ]

  if (input.sandboxEnabled) {
    tools.push(
      createManagedTool({
        name: "read",
        description:
          "Read a text file from the current session workspace hand or another mounted read-only resource. Prefer this over sandbox_execute for ordinary file reads because it maps directly to the managed built-in file tool surface.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            maxChars: { type: "number" },
            startLine: { type: "number" },
            lineCount: { type: "number" },
            tailLines: { type: "number" },
          },
          required: ["path"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["resource_read", "sandbox_execute"],
        readOnly: true,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const path = normalizeOptionalText((record as Record<string, unknown>).path)
          if (!path) {
            throw new Error("read requires a non-empty path")
          }
          const startLine = normalizePositiveIntegerArg(
            record as Record<string, unknown>,
            "startLine",
          )
          const lineCount = normalizePositiveIntegerArg(
            record as Record<string, unknown>,
            "lineCount",
          )
          const tailLines = normalizePositiveIntegerArg(
            record as Record<string, unknown>,
            "tailLines",
          )
          if (lineCount && tailLines) {
            throw new Error("read accepts either lineCount or tailLines, not both")
          }
          if (startLine && tailLines) {
            throw new Error("read cannot combine startLine with tailLines")
          }
          if (startLine && !lineCount) {
            throw new Error("read requires lineCount when startLine is provided")
          }
          return asJson(
            await executeSandboxActionOrThrow(input.sandbox, "read_text", {
              path,
              ...(typeof (record as Record<string, unknown>).maxChars === "number"
                ? { maxChars: (record as Record<string, unknown>).maxChars }
                : {}),
              ...(startLine ? { startLine } : {}),
              ...(lineCount ? { lineCount } : {}),
              ...(tailLines ? { tailLines } : {}),
            }),
          )
        },
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "write",
        description:
          "Write or overwrite a text file inside the writable session workspace hand. Use this for deliberate file creation or replacement after verifying the target path.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["resource_write", "sandbox_execute"],
        readOnly: false,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const path = normalizeOptionalText((record as Record<string, unknown>).path)
          if (!path) {
            throw new Error("write requires a non-empty path")
          }
          if (typeof (record as Record<string, unknown>).content !== "string") {
            throw new Error("write requires string content")
          }
          return asJson(
            await executeSandboxActionOrThrow(input.sandbox, "write_text", {
              path,
              content: (record as Record<string, unknown>).content,
            }),
          )
        },
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "edit",
        description:
          "Apply an exact text replacement inside a writable file without reconstructing the whole file content by hand. Use this for bounded edits after you have inspected the surrounding text.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            oldText: { type: "string" },
            newText: { type: "string" },
            replaceAll: { type: "boolean" },
          },
          required: ["path", "oldText", "newText"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["resource_write", "sandbox_execute"],
        readOnly: false,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const path = normalizeOptionalText((record as Record<string, unknown>).path)
          if (!path) {
            throw new Error("edit requires a non-empty path")
          }
          if (typeof (record as Record<string, unknown>).oldText !== "string") {
            throw new Error("edit requires string oldText")
          }
          if (typeof (record as Record<string, unknown>).newText !== "string") {
            throw new Error("edit requires string newText")
          }
          return asJson(
            await executeSandboxActionOrThrow(input.sandbox, "replace_text", {
              path,
              oldText: (record as Record<string, unknown>).oldText,
              newText: (record as Record<string, unknown>).newText,
              replaceAll: (record as Record<string, unknown>).replaceAll === true,
            }),
          )
        },
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "glob",
        description:
          "Match file or directory paths under the current session hand with a glob pattern such as **/*.md. Use this before read or edit when you know the pattern but not the exact path.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            pattern: { type: "string" },
            kind: { type: "string", enum: ["file", "directory"] },
            limit: { type: "number" },
          },
          required: ["path", "pattern"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["resource_read", "sandbox_execute"],
        readOnly: true,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const path = normalizeOptionalText((record as Record<string, unknown>).path)
          const pattern = normalizeOptionalText((record as Record<string, unknown>).pattern)
          const kindValue = (record as Record<string, unknown>).kind
          const kind = kindValue === "file" || kindValue === "directory" ? kindValue : undefined
          if (!path || !pattern) {
            throw new Error("glob requires non-empty path and pattern")
          }
          return asJson(
            await executeSandboxActionOrThrow(input.sandbox, "glob_entries", {
              path,
              pattern,
              ...(kind ? { kind } : {}),
              limit: normalizeLimit((record as Record<string, unknown>).limit, 40),
            }),
          )
        },
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "grep",
        description:
          "Search file contents under the current session hand. Use plain text by default and set regex=true only when you need a regular expression pattern.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            query: { type: "string" },
            limit: { type: "number" },
            regex: { type: "boolean" },
            caseSensitive: { type: "boolean" },
          },
          required: ["path", "query"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["resource_read", "sandbox_execute"],
        readOnly: true,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const path = normalizeOptionalText((record as Record<string, unknown>).path)
          const query = normalizeOptionalText((record as Record<string, unknown>).query)
          if (!path || !query) {
            throw new Error("grep requires non-empty path and query")
          }
          return asJson(
            await executeSandboxActionOrThrow(input.sandbox, "grep_text", {
              path,
              query,
              limit: normalizeLimit((record as Record<string, unknown>).limit, 20),
              regex: (record as Record<string, unknown>).regex === true,
              caseSensitive: (record as Record<string, unknown>).caseSensitive === true,
            }),
          )
        },
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "bash",
        description:
          "Run a bounded read-only command inside the mounted session workspace hand. The command defaults to the session-scoped shell cwd when omitted, so repeated bounded commands can continue from the same working directory without assuming a global shell.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
            args: {
              type: "array",
              items: { type: "string" },
            },
            cwd: { type: "string" },
            timeoutMs: { type: "number" },
            maxOutputChars: { type: "number" },
          },
          required: ["command"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["sandbox_execute"],
        readOnly: true,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const command = normalizeOptionalText((record as Record<string, unknown>).command)
          if (!command) {
            throw new Error("bash requires a non-empty command")
          }
          const runtimeMemory = await input.memoryStore.read(
            input.session.agentId,
            input.session.id,
          )
          const effectiveCwd =
            normalizeOptionalText((record as Record<string, unknown>).cwd) ??
            runtimeMemory.shellState?.cwd ??
            "/workspace"
          const commandResult = await executeSandboxActionOrThrow(input.sandbox, "run_command", {
            command,
            args: Array.isArray((record as Record<string, unknown>).args)
              ? (record as Record<string, unknown>).args
              : [],
            cwd: effectiveCwd,
            timeoutMs: normalizeLimit((record as Record<string, unknown>).timeoutMs, 15_000),
            maxOutputChars: normalizeLimit(
              (record as Record<string, unknown>).maxOutputChars,
              12_000,
            ),
            env: runtimeMemory.shellState?.env ?? {},
          })
          const output =
            commandResult.output &&
            typeof commandResult.output === "object" &&
            !Array.isArray(commandResult.output)
              ? (commandResult.output as Record<string, unknown>)
              : {}
          const nextCwd = typeof output.cwd === "string" ? output.cwd : effectiveCwd
          const shellState = await input.memoryStore.writeShellState({
            agentId: input.session.agentId,
            sessionId: input.session.id,
            cwd: nextCwd,
            updatedAt: nowIsoString(),
            env: runtimeMemory.shellState?.env ?? {},
            lastCommand: {
              command,
              args: Array.isArray((record as Record<string, unknown>).args)
                ? ((record as Record<string, unknown>).args as unknown[]).filter(
                    (value): value is string => typeof value === "string",
                  )
                : [],
              cwd: nextCwd,
              exitCode:
                typeof output.exitCode === "number" && Number.isFinite(output.exitCode)
                  ? (output.exitCode as number)
                  : null,
              timedOut: output.timedOut === true,
              durationMs:
                typeof output.durationMs === "number" && Number.isFinite(output.durationMs)
                  ? (output.durationMs as number)
                  : 0,
              updatedAt: nowIsoString(),
              outputPreview: typeof commandResult.text === "string" ? commandResult.text : null,
              stdoutPreview: typeof output.stdout === "string" ? output.stdout : null,
              stderrPreview: typeof output.stderr === "string" ? output.stderr : null,
            },
          })
          return asJson({
            ...commandResult,
            output: {
              ...output,
              shellState,
            },
          })
        },
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "sandbox_describe",
        description:
          "Inspect the currently attached sandbox hand before deciding which named sandbox action to execute.",
        inputSchema: {},
        outputSchema: {
          type: "object",
          properties: {
            kind: { type: "string" },
            summary: { type: "string" },
            provisionedResourceCount: { type: "number" },
            resources: {
              type: "array",
              items: { type: "object" },
            },
            constraints: {
              type: "array",
              items: { type: "string" },
            },
            actions: {
              type: "array",
              items: { type: "object" },
            },
            commandPolicy: {
              type: ["object", "null"],
            },
            actionExamples: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
        effects: ["sandbox_execute"],
        readOnly: true,
        execute: async () => asJson(await input.sandbox.describe()),
        onToolUse: input.onToolUse,
      }),
      createManagedTool({
        name: "sandbox_execute",
        description:
          "Execute a named sandbox action against the currently provisioned session resources.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            input: {},
          },
          required: ["name"],
        },
        outputSchema: buildSandboxExecutionResultSchema(),
        effects: ["sandbox_execute"],
        readOnly: false,
        execute: async (args) => {
          const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
          const name = normalizeOptionalText((record as Record<string, unknown>).name)
          if (!name) {
            throw new Error("sandbox_execute requires a non-empty name")
          }
          const result = await input.sandbox.execute(
            name,
            (record as Record<string, unknown>).input ?? {},
          )
          return asJson(result)
        },
        onToolUse: input.onToolUse,
      }),
    )
  }

  tools.push(
    createManagedTool({
      name: "permissions_describe",
      description:
        "Describe the current runtime permission posture, including pending confirmation requests and available always-ask tools.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          artifactPaths: {
            type: "object",
          },
          pendingToolConfirmationRequest: {
            type: ["object", "null"],
          },
          outcomeEvaluation: {
            type: ["object", "null"],
          },
          nextOutcomeStep: {
            type: ["object", "null"],
          },
          contextPressure: {
            type: ["object", "null"],
          },
          shellMutationPosture: {
            type: ["object", "null"],
          },
          readOnlyAlternative: {
            type: ["object", "null"],
          },
          nextShellStep: {
            type: ["object", "null"],
          },
          shellReadFirstAlternatives: {
            type: "array",
            items: { type: "object" },
          },
          alwaysAskTools: {
            type: "array",
            items: { type: "object" },
          },
          outcomeGatedTools: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      effects: ["session_read", "memory_read", "sandbox_execute"],
      execute: async () => {
        const visibleTools = filterAllowedTools(tools, input.toolPolicy)
        const artifactPaths = buildSessionRuntimeArtifactPaths({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        const { contextBudget } = await resolveSessionContextBudget({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          currentSessionId: input.session.id,
          targetSessionId: input.session.id,
          contextBudgetRef: input.contextBudgetRef,
        })
        const [evaluatedOutcome, shellPosture] = await Promise.all([
          input.session.status !== "terminated"
            ? evaluateScopedSessionOutcome({
                session: input.session,
                sessionStore: input.sessionStore,
                memoryStore: input.memoryStore,
                sandbox: input.sandbox,
              })
            : Promise.resolve(null),
          resolveShellMutationPosture({
            sessionId: input.session.id,
            currentSessionId: input.session.id,
            agentId: input.session.agentId,
            memoryStore: input.memoryStore,
            sandbox: input.sandbox,
          }),
        ])
        const pendingShellReadOnlyAlternative =
          input.session.pendingToolConfirmationRequest &&
          (input.session.pendingToolConfirmationRequest.toolName === "shell_run" ||
            input.session.pendingToolConfirmationRequest.toolName === "shell_exec") &&
          shellPosture
            ? resolveReadOnlyShellAlternative({
                toolName: input.session.pendingToolConfirmationRequest.toolName,
                toolArgsPreview: normalizeToolArgsPreview(
                  input.session.pendingToolConfirmationRequest.input,
                ),
                posture: shellPosture,
              })
            : null
        const contextPressure = summarizeContextPressure(contextBudget)
        const shellReadFirstAlternatives = buildShellReadFirstAlternatives({
          shellState: shellPosture.shellState,
          shellPosture,
          contextPressure,
        })
        return asJson({
          artifactPaths: {
            permissionCatalogJson: artifactPaths.permissionsJson,
            permissionPostureJson: artifactPaths.permissionPostureJson,
            permissionPostureMarkdown: artifactPaths.permissionPostureMarkdown,
          },
          pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
          outcomeEvaluation: evaluatedOutcome?.evaluation ?? null,
          nextOutcomeStep:
            evaluatedOutcome?.activeOutcome && evaluatedOutcome.evaluation.promotionReady === false
              ? resolveOutcomeGateNextStep({
                  sessionId: input.session.id,
                  evaluation: evaluatedOutcome.evaluation,
                })
              : null,
          contextPressure,
          shellMutationPosture: {
            persistentShell: shellPosture.persistentShell,
            lastCommandPreview: shellPosture.lastCommandPreview,
            busyPlan: shellPosture.busyPlan,
            recoveryPlan: shellPosture.recoveryPlan,
          },
          readOnlyAlternative: pendingShellReadOnlyAlternative,
          nextShellStep:
            pendingShellReadOnlyAlternative ?? shellPosture.busyPlan ?? shellPosture.recoveryPlan,
          shellReadFirstAlternatives,
          alwaysAskTools: visibleTools
            .filter((tool) => tool.permissionPolicy === "always_ask")
            .map((tool) => ({
              name: tool.name,
              ownership: tool.ownership,
              effects: tool.effects,
              readOnly: tool.readOnly,
            })),
          outcomeGatedTools: visibleTools
            .filter((tool) => OUTCOME_GATED_TOOL_NAMES.has(tool.name))
            .map((tool) => ({
              name: tool.name,
              ownership: tool.ownership,
              effects: tool.effects,
              readOnly: tool.readOnly,
              requiresOutcomePass: true,
            })),
        })
      },
      onToolUse: input.onToolUse,
    }),
    createManagedTool({
      name: "permissions_check",
      description:
        "Inspect one managed tool's permission posture before calling it, including whether it will require explicit confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          toolArgs: {},
        },
        required: ["toolName"],
      },
      outputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          artifactPaths: { type: "object" },
          exists: { type: "boolean" },
          allowed: { type: "boolean" },
          permissionPolicy: { type: ["string", "null"] },
          requiresConfirmation: { type: "boolean" },
          requiresOutcomePass: { type: "boolean" },
          ownership: { type: ["string", "null"] },
          effects: {
            type: "array",
            items: { type: "string" },
          },
          readOnly: { type: ["boolean", "null"] },
          destructive: { type: ["boolean", "null"] },
          interruptBehavior: { type: ["string", "null"] },
          outcomeEvaluation: { type: ["object", "null"] },
          nextOutcomeStep: { type: ["object", "null"] },
          contextPressure: { type: ["object", "null"] },
          pendingToolConfirmationRequest: { type: ["object", "null"] },
          shellMutationPosture: { type: ["object", "null"] },
          readOnlyAlternative: { type: ["object", "null"] },
          shellReadFirstAlternatives: {
            type: "array",
            items: { type: "object" },
          },
          nextStep: { type: ["object", "null"] },
        },
      },
      effects: ["session_read", "memory_read", "sandbox_execute"],
      execute: async (args) => {
        const record = args && typeof args === "object" && !Array.isArray(args) ? args : {}
        const toolName = normalizeOptionalText((record as Record<string, unknown>).toolName)
        if (!toolName) {
          throw new Error("permissions_check requires a non-empty toolName")
        }
        const toolArgsPreview = normalizeToolArgsPreview(
          (record as Record<string, unknown>).toolArgs,
        )
        const visibleTools = filterAllowedTools(tools, input.toolPolicy)
        const targetTool = visibleTools.find((tool) => tool.name === toolName) ?? null
        const pendingRequest =
          input.session.pendingToolConfirmationRequest?.toolName === toolName
            ? input.session.pendingToolConfirmationRequest
            : null
        const requiresOutcomePass = OUTCOME_GATED_TOOL_NAMES.has(toolName)
        const shouldInspectOutcomePosture =
          targetTool !== null && (requiresOutcomePass || SHELL_MUTATION_TOOL_NAMES.has(toolName))
        const evaluatedOutcome = shouldInspectOutcomePosture
          ? await evaluateScopedSessionOutcome({
              session: input.session,
              sessionStore: input.sessionStore,
              memoryStore: input.memoryStore,
              sandbox: input.sandbox,
            })
          : null
        const shellPosture = SHELL_MUTATION_TOOL_NAMES.has(toolName)
          ? await resolveShellMutationPosture({
              sessionId: input.session.id,
              currentSessionId: input.session.id,
              agentId: input.session.agentId,
              memoryStore: input.memoryStore,
              sandbox: input.sandbox,
            })
          : null
        const readOnlyAlternative =
          shellPosture && targetTool !== null
            ? resolveReadOnlyShellAlternative({
                toolName,
                toolArgsPreview,
                posture: shellPosture,
              })
            : null
        const firstClassAlternative =
          shellPosture && targetTool !== null
            ? resolveFirstClassShellAlternative({
                toolName,
                toolArgsPreview,
                posture: shellPosture,
              })
            : null
        const shellMutationNextStep =
          shellPosture && targetTool !== null
            ? resolveShellMutationNextStep({
                toolName,
                posture: shellPosture,
                preferredReadFirstAlternative: firstClassAlternative,
                readOnlyAlternative,
              })
            : null
        const { contextBudget } = await resolveSessionContextBudget({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          currentSessionId: input.session.id,
          targetSessionId: input.session.id,
          contextBudgetRef: input.contextBudgetRef,
        })
        const artifactPaths = buildSessionRuntimeArtifactPaths({
          companyDir: input.companyDir,
          agentId: input.session.agentId,
          sessionId: input.session.id,
        })
        const contextPressure = summarizeContextPressure(contextBudget)
        const shellReadFirstAlternatives =
          shellPosture && targetTool !== null
            ? buildShellReadFirstAlternatives({
                shellState: shellPosture.shellState,
                shellPosture,
                contextPressure,
                preferredAlternative: firstClassAlternative,
              })
            : []
        return asJson({
          toolName,
          artifactPaths: {
            permissionCatalogJson: artifactPaths.permissionsJson,
            permissionPostureJson: artifactPaths.permissionPostureJson,
            permissionPostureMarkdown: artifactPaths.permissionPostureMarkdown,
          },
          exists: targetTool !== null,
          allowed: targetTool !== null,
          permissionPolicy: targetTool?.permissionPolicy ?? null,
          requiresConfirmation: targetTool?.permissionPolicy === "always_ask",
          requiresOutcomePass,
          ownership: targetTool?.ownership ?? null,
          effects: targetTool?.effects ?? [],
          readOnly: targetTool?.readOnly ?? null,
          destructive: targetTool?.destructive ?? null,
          interruptBehavior: targetTool?.interruptBehavior ?? null,
          outcomeEvaluation: evaluatedOutcome?.evaluation ?? null,
          nextOutcomeStep:
            evaluatedOutcome?.activeOutcome && evaluatedOutcome.evaluation.promotionReady === false
              ? resolveOutcomeGateNextStep({
                  sessionId: input.session.id,
                  evaluation: evaluatedOutcome.evaluation,
                })
              : null,
          contextPressure,
          pendingToolConfirmationRequest: pendingRequest,
          shellMutationPosture:
            shellPosture === null
              ? null
              : {
                  persistentShell: shellPosture.persistentShell,
                  lastCommandPreview: shellPosture.lastCommandPreview,
                  busyPlan: shellPosture.busyPlan,
                  recoveryPlan: shellPosture.recoveryPlan,
                },
          readOnlyAlternative,
          shellReadFirstAlternatives,
          nextStep: shellMutationNextStep
            ? shellMutationNextStep
            : requiresOutcomePass && evaluatedOutcome?.evaluation.promotionReady === false
              ? resolveOutcomeGateNextStep({
                  sessionId: input.session.id,
                  evaluation: evaluatedOutcome.evaluation,
                })
              : targetTool?.permissionPolicy === "always_ask"
                ? {
                    tool: "permissions_describe",
                    args: {},
                    rationale:
                      pendingRequest !== null
                        ? "A confirmation request for this tool is already pending. Inspect the current confirmation posture before retrying it."
                        : "This tool is confirmation-gated. Inspect the broader permission posture before calling it if the pause semantics matter.",
                  }
                : null,
        })
      },
      onToolUse: input.onToolUse,
    }),
  )

  return filterAllowedTools(tools, input.toolPolicy)
}
