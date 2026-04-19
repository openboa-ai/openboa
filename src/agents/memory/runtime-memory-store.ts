import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  computeOutcomeDefinitionFingerprint,
  type SessionOutcomeEvaluation,
  type SessionOutcomeEvaluationRecord,
} from "../outcomes/outcome-evaluate.js"
import type { SessionOutcomeGrade } from "../outcomes/outcome-grade.js"
import { resolveSessionWorkspaceDir } from "../resources/default-resources.js"
import type {
  AgentResolvedLearning,
  AgentResolvedQueuedWake,
  LoopDirectiveOutcome,
} from "../runtime/loop-directive.js"
import type { SessionOutcomeDefinition } from "../schema/runtime.js"

export interface SessionRuntimeCheckpoint {
  version: 6
  sessionId: string
  agentId: string
  updatedAt: string
  lastWakeId: string | null
  lastEventIds: string[]
  eventCursor: {
    lastContextEventId: string | null
    lastProcessedEventId: string | null
    lastProducedEventId: string | null
  }
  lastOutcome: LoopDirectiveOutcome
  lastSummary: string
  responseMessage: string | null
  nextWakeAt: string | null
  consecutiveFollowUps: number
  activeOutcome: SessionOutcomeDefinition | null
  queuedWakes: Array<{
    reason: string
    dueAt: string
    note: string | null
  }>
  stopReason: string
  lastAgentSetupFingerprint: string | null
  outcomeEvaluationHistory: SessionOutcomeEvaluationRecord[]
}

export interface SessionShellCommandRecord {
  commandId: string
  command: string
  args: string[]
  cwd: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  updatedAt: string
  outputPreview: string | null
  stdoutPreview?: string | null
  stderrPreview?: string | null
}

export type SessionShellCommandRecordInput = Omit<SessionShellCommandRecord, "commandId"> & {
  commandId?: string
}

export interface SessionPersistentShellState {
  shellId: string
  shellPath: string
  startedAt: string
  updatedAt: string
  lastCommandAt: string | null
  commandCount: number
  status: "active" | "closed"
}

export interface SessionShellState {
  version: 5
  cwd: string
  updatedAt: string
  env: Record<string, string>
  persistentShell: SessionPersistentShellState | null
  lastCommand: SessionShellCommandRecord | null
  recentCommands: SessionShellCommandRecord[]
}

export interface RuntimeMemorySnapshot {
  checkpoint: SessionRuntimeCheckpoint | null
  sessionState: string | null
  workingBuffer: string | null
  shellState: SessionShellState | null
}

export type RuntimeMemoryWritableTarget = "session_state" | "working_buffer"
export type RuntimeMemoryWriteMode = "replace" | "append"

export interface WriteSessionRuntimeMemoryInput {
  agentId: string
  sessionId: string
  updatedAt: string
  wakeId?: string | null
  lastContextEventId: string | null
  processedEventIds: string[]
  producedEventId: string | null
  outcome: LoopDirectiveOutcome
  summary: string
  activeOutcome: SessionOutcomeDefinition | null
  nextWakeAt: string | null
  consecutiveFollowUps: number
  queuedWakes: AgentResolvedQueuedWake[]
  stopReason: string
  learnings: AgentResolvedLearning[]
  responseMessage: string | null
  agentSetupFingerprint?: string | null
}

interface RecordSessionOutcomeEvaluationInput {
  agentId: string
  sessionId: string
  evaluatedAt: string
  wakeId: string | null
  activeOutcome: SessionOutcomeDefinition | null
  gradeStatus: SessionOutcomeGrade["status"]
  evaluation: SessionOutcomeEvaluation
}

interface LegacySessionRuntimeCheckpointV2 {
  version: 2
  sessionId: string
  agentId: string
  updatedAt: string
  lastEventIds: string[]
  lastOutcome: LoopDirectiveOutcome
  lastSummary: string
  responseMessage?: string | null
  nextWakeAt: string | null
  consecutiveFollowUps: number
  queuedWakes: Array<{
    reason: string
    dueAt: string
    note: string | null
  }>
  stopReason: string
}

interface LegacySessionRuntimeCheckpointV3 {
  version: 3
  sessionId: string
  agentId: string
  updatedAt: string
  lastEventIds: string[]
  eventCursor: {
    lastContextEventId: string | null
    lastProcessedEventId: string | null
    lastProducedEventId: string | null
  }
  lastOutcome: LoopDirectiveOutcome
  lastSummary: string
  responseMessage?: string | null
  nextWakeAt: string | null
  consecutiveFollowUps: number
  queuedWakes: Array<{
    reason: string
    dueAt: string
    note: string | null
  }>
  stopReason: string
}

interface LegacySessionRuntimeCheckpointV4 {
  version: 4
  sessionId: string
  agentId: string
  updatedAt: string
  lastEventIds: string[]
  eventCursor: {
    lastContextEventId: string | null
    lastProcessedEventId: string | null
    lastProducedEventId: string | null
  }
  lastOutcome: LoopDirectiveOutcome
  lastSummary: string
  responseMessage?: string | null
  nextWakeAt: string | null
  consecutiveFollowUps: number
  activeOutcome: SessionOutcomeDefinition | null
  queuedWakes: Array<{
    reason: string
    dueAt: string
    note: string | null
  }>
  stopReason: string
}

interface LegacySessionRuntimeCheckpointV5 {
  version: 5
  sessionId: string
  agentId: string
  updatedAt: string
  lastWakeId: string | null
  lastEventIds: string[]
  eventCursor: {
    lastContextEventId: string | null
    lastProcessedEventId: string | null
    lastProducedEventId: string | null
  }
  lastOutcome: LoopDirectiveOutcome
  lastSummary: string
  responseMessage?: string | null
  nextWakeAt: string | null
  consecutiveFollowUps: number
  activeOutcome: SessionOutcomeDefinition | null
  queuedWakes: Array<{
    reason: string
    dueAt: string
    note: string | null
  }>
  stopReason: string
  lastAgentSetupFingerprint: string | null
}

interface LegacySessionShellStateV1 {
  version: 1
  cwd: string
  updatedAt: string
  lastCommand: SessionShellCommandRecord | null
}

interface SessionShellStateV2 {
  version: 2
  cwd: string
  updatedAt: string
  lastCommand: SessionShellCommandRecord | null
  recentCommands: SessionShellCommandRecord[]
}

interface SessionShellStateV3 {
  version: 3
  cwd: string
  updatedAt: string
  lastCommand: SessionShellCommandRecord | null
  recentCommands: SessionShellCommandRecord[]
}

interface SessionShellStateV4 {
  version: 4
  cwd: string
  updatedAt: string
  env: Record<string, string>
  lastCommand: SessionShellCommandRecord | null
  recentCommands: SessionShellCommandRecord[]
}

interface SessionShellStateV5 {
  version: 5
  cwd: string
  updatedAt: string
  env: Record<string, string>
  persistentShell: SessionPersistentShellState | null
  lastCommand: SessionShellCommandRecord | null
  recentCommands: SessionShellCommandRecord[]
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function computeShellCommandId(input: {
  command: string
  args: string[]
  cwd: string
  updatedAt: string
}): string {
  const hash = createHash("sha256")
  hash.update(
    JSON.stringify({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      updatedAt: input.updatedAt,
    }),
  )
  return hash.digest("hex").slice(0, 16)
}

export class RuntimeMemoryStore {
  constructor(private readonly companyDir: string) {}

  runtimeDir(agentId: string, sessionId: string): string {
    return join(this.companyDir, ".openboa", "agents", agentId, "sessions", sessionId, "runtime")
  }

  checkpointPath(agentId: string, sessionId: string): string {
    return join(this.runtimeDir(agentId, sessionId), "checkpoint.json")
  }

  sessionStatePath(agentId: string, sessionId: string): string {
    return join(this.runtimeDir(agentId, sessionId), "session-state.md")
  }

  workingBufferPath(agentId: string, sessionId: string): string {
    return join(this.runtimeDir(agentId, sessionId), "working-buffer.md")
  }

  shellStatePath(agentId: string, sessionId: string): string {
    return join(this.runtimeDir(agentId, sessionId), "shell-state.json")
  }

  shellRuntimeCatalogDir(agentId: string, sessionId: string): string {
    return join(resolveSessionWorkspaceDir(this.companyDir, agentId, sessionId), ".openboa-runtime")
  }

  shellRuntimeStatePath(agentId: string, sessionId: string): string {
    return join(this.shellRuntimeCatalogDir(agentId, sessionId), "shell-state.json")
  }

  shellRuntimeHistoryJsonPath(agentId: string, sessionId: string): string {
    return join(this.shellRuntimeCatalogDir(agentId, sessionId), "shell-history.json")
  }

  shellRuntimeHistoryMarkdownPath(agentId: string, sessionId: string): string {
    return join(this.shellRuntimeCatalogDir(agentId, sessionId), "shell-history.md")
  }

  shellRuntimeLastOutputJsonPath(agentId: string, sessionId: string): string {
    return join(this.shellRuntimeCatalogDir(agentId, sessionId), "shell-last-output.json")
  }

  shellRuntimeLastOutputMarkdownPath(agentId: string, sessionId: string): string {
    return join(this.shellRuntimeCatalogDir(agentId, sessionId), "shell-last-output.md")
  }

  async read(agentId: string, sessionId: string): Promise<RuntimeMemorySnapshot> {
    const [checkpoint, sessionState, workingBuffer, shellState] = await Promise.all([
      this.readCheckpoint(agentId, sessionId),
      this.readText(this.sessionStatePath(agentId, sessionId)),
      this.readText(this.workingBufferPath(agentId, sessionId)),
      this.readShellState(agentId, sessionId),
    ])
    return { checkpoint, sessionState, workingBuffer, shellState }
  }

  async write(input: WriteSessionRuntimeMemoryInput): Promise<RuntimeMemorySnapshot> {
    const existingCheckpoint = await this.readCheckpoint(input.agentId, input.sessionId)
    const checkpoint: SessionRuntimeCheckpoint = {
      version: 6,
      sessionId: input.sessionId,
      agentId: input.agentId,
      updatedAt: input.updatedAt,
      lastWakeId: input.wakeId ?? null,
      lastEventIds: [...input.processedEventIds],
      eventCursor: {
        lastContextEventId: input.lastContextEventId,
        lastProcessedEventId: input.processedEventIds.at(-1) ?? null,
        lastProducedEventId: input.producedEventId,
      },
      lastOutcome: input.outcome,
      lastSummary: input.summary,
      responseMessage: normalizeOptionalText(input.responseMessage),
      nextWakeAt: input.nextWakeAt,
      consecutiveFollowUps: input.consecutiveFollowUps,
      activeOutcome: input.activeOutcome,
      queuedWakes: input.queuedWakes.map((wake) => ({
        reason: wake.reason,
        dueAt: wake.dueAt,
        note: wake.note,
      })),
      stopReason: input.stopReason,
      lastAgentSetupFingerprint: normalizeOptionalText(input.agentSetupFingerprint),
      outcomeEvaluationHistory: existingCheckpoint?.outcomeEvaluationHistory ?? [],
    }

    const sessionState = this.buildSessionStateMarkdown(input)
    const workingBuffer = this.buildWorkingBufferMarkdown(input)
    const shellState = await this.readShellState(input.agentId, input.sessionId)

    await Promise.all([
      this.writeJson(this.checkpointPath(input.agentId, input.sessionId), checkpoint),
      this.writeText(this.sessionStatePath(input.agentId, input.sessionId), sessionState),
      this.writeText(this.workingBufferPath(input.agentId, input.sessionId), workingBuffer),
    ])

    return {
      checkpoint,
      sessionState,
      workingBuffer,
      shellState,
    }
  }

  async recordOutcomeEvaluation(
    input: RecordSessionOutcomeEvaluationInput,
  ): Promise<RuntimeMemorySnapshot> {
    const current = await this.read(input.agentId, input.sessionId)
    if (!input.activeOutcome || !current.checkpoint) {
      return current
    }
    const checkpoint: SessionRuntimeCheckpoint = {
      ...current.checkpoint,
      version: 6,
      updatedAt: input.evaluatedAt,
      outcomeEvaluationHistory: this.nextOutcomeEvaluationHistory(
        current.checkpoint.outcomeEvaluationHistory,
        input,
      ),
    }
    await this.writeJson(this.checkpointPath(input.agentId, input.sessionId), checkpoint)
    return {
      ...current,
      checkpoint,
    }
  }

  async writeTarget(params: {
    agentId: string
    sessionId: string
    target: RuntimeMemoryWritableTarget
    content: string
    mode?: RuntimeMemoryWriteMode
  }): Promise<{ path: string; content: string }> {
    const nextContent =
      params.mode === "append"
        ? await this.appendToTarget(params.agentId, params.sessionId, params.target, params.content)
        : await this.replaceTarget(params.agentId, params.sessionId, params.target, params.content)
    return {
      path: this.pathForTarget(params.agentId, params.sessionId, params.target),
      content: nextContent,
    }
  }

  async writeShellState(params: {
    agentId: string
    sessionId: string
    cwd: string
    updatedAt: string
    env?: Record<string, string>
    persistentShell?: SessionPersistentShellState | null
    lastCommand?: SessionShellCommandRecordInput | null
  }): Promise<SessionShellState> {
    const existing = await this.readShellState(params.agentId, params.sessionId)
    const nextLastCommand =
      params.lastCommand === undefined
        ? (existing?.lastCommand ?? null)
        : params.lastCommand
          ? this.withShellCommandId(params.lastCommand)
          : null
    const lastCommand = nextLastCommand
    const shellState: SessionShellState = {
      version: 5,
      cwd: params.cwd,
      updatedAt: params.updatedAt,
      env: this.normalizeShellEnv(params.env ?? existing?.env ?? {}),
      persistentShell:
        params.persistentShell === undefined
          ? (existing?.persistentShell ?? null)
          : params.persistentShell,
      lastCommand,
      recentCommands: this.nextRecentCommands(existing?.recentCommands ?? [], lastCommand),
    }
    await this.writeJson(this.shellStatePath(params.agentId, params.sessionId), shellState)
    await this.writeShellRuntimeFiles(params.agentId, params.sessionId, shellState)
    return shellState
  }

  private async readCheckpoint(
    agentId: string,
    sessionId: string,
  ): Promise<SessionRuntimeCheckpoint | null> {
    try {
      const raw = await readFile(this.checkpointPath(agentId, sessionId), "utf8")
      const parsed = JSON.parse(raw) as
        | SessionRuntimeCheckpoint
        | LegacySessionRuntimeCheckpointV5
        | LegacySessionRuntimeCheckpointV4
        | LegacySessionRuntimeCheckpointV3
        | LegacySessionRuntimeCheckpointV2
      if (parsed?.version === 6) {
        return {
          ...parsed,
          lastAgentSetupFingerprint: normalizeOptionalText(parsed.lastAgentSetupFingerprint),
          responseMessage: normalizeOptionalText(parsed.responseMessage),
          outcomeEvaluationHistory: Array.isArray(parsed.outcomeEvaluationHistory)
            ? parsed.outcomeEvaluationHistory
            : [],
        }
      }
      if (parsed?.version === 5) {
        return {
          ...parsed,
          version: 6,
          lastAgentSetupFingerprint: normalizeOptionalText(parsed.lastAgentSetupFingerprint),
          responseMessage: normalizeOptionalText(parsed.responseMessage),
          outcomeEvaluationHistory: [],
        }
      }
      if (parsed?.version === 4) {
        return {
          ...parsed,
          version: 6,
          lastWakeId: null,
          lastAgentSetupFingerprint: null,
          responseMessage: normalizeOptionalText(parsed.responseMessage),
          outcomeEvaluationHistory: [],
        }
      }
      if (parsed?.version === 3) {
        return {
          ...parsed,
          version: 6,
          lastWakeId: null,
          activeOutcome: null,
          lastAgentSetupFingerprint: null,
          responseMessage: normalizeOptionalText(parsed.responseMessage),
          outcomeEvaluationHistory: [],
        }
      }
      if (parsed?.version === 2) {
        return {
          ...parsed,
          version: 6,
          lastWakeId: null,
          eventCursor: {
            lastContextEventId: null,
            lastProcessedEventId: parsed.lastEventIds.at(-1) ?? null,
            lastProducedEventId: null,
          },
          activeOutcome: null,
          lastAgentSetupFingerprint: null,
          responseMessage: normalizeOptionalText(parsed.responseMessage),
          outcomeEvaluationHistory: [],
        }
      }
      return null
    } catch {
      return null
    }
  }

  private async readText(path: string): Promise<string | null> {
    try {
      return normalizeOptionalText(await readFile(path, "utf8"))
    } catch {
      return null
    }
  }

  private async readShellState(
    agentId: string,
    sessionId: string,
  ): Promise<SessionShellState | null> {
    try {
      const raw = await readFile(this.shellStatePath(agentId, sessionId), "utf8")
      const parsed = JSON.parse(raw) as
        | LegacySessionShellStateV1
        | SessionShellStateV2
        | SessionShellStateV3
        | SessionShellStateV4
        | SessionShellStateV5
      if (
        parsed?.version === 5 &&
        typeof parsed.cwd === "string" &&
        typeof parsed.updatedAt === "string" &&
        Array.isArray(parsed.recentCommands)
      ) {
        return {
          version: 5,
          cwd: parsed.cwd,
          updatedAt: parsed.updatedAt,
          env: this.normalizeShellEnv(parsed.env),
          persistentShell: this.normalizePersistentShellState(parsed.persistentShell),
          lastCommand: this.normalizeShellCommandRecord(parsed.lastCommand),
          recentCommands: parsed.recentCommands
            .map((record) => this.normalizeShellCommandRecord(record))
            .filter((record): record is SessionShellCommandRecord => record !== null),
        }
      }
      if (
        parsed?.version === 4 &&
        typeof parsed.cwd === "string" &&
        typeof parsed.updatedAt === "string" &&
        Array.isArray(parsed.recentCommands)
      ) {
        return {
          version: 5,
          cwd: parsed.cwd,
          updatedAt: parsed.updatedAt,
          env: this.normalizeShellEnv(parsed.env),
          persistentShell: null,
          lastCommand: this.normalizeShellCommandRecord(parsed.lastCommand),
          recentCommands: parsed.recentCommands
            .map((record) => this.normalizeShellCommandRecord(record))
            .filter((record): record is SessionShellCommandRecord => record !== null),
        }
      }
      if (
        parsed?.version === 3 &&
        typeof parsed.cwd === "string" &&
        typeof parsed.updatedAt === "string" &&
        Array.isArray(parsed.recentCommands)
      ) {
        return {
          version: 5,
          cwd: parsed.cwd,
          updatedAt: parsed.updatedAt,
          env: {},
          persistentShell: null,
          lastCommand: this.normalizeShellCommandRecord(parsed.lastCommand),
          recentCommands: parsed.recentCommands
            .map((record) => this.normalizeShellCommandRecord(record))
            .filter((record): record is SessionShellCommandRecord => record !== null),
        }
      }
      if (
        parsed?.version === 2 &&
        typeof parsed.cwd === "string" &&
        typeof parsed.updatedAt === "string" &&
        Array.isArray(parsed.recentCommands)
      ) {
        return {
          version: 5,
          cwd: parsed.cwd,
          updatedAt: parsed.updatedAt,
          env: {},
          persistentShell: null,
          lastCommand: this.normalizeShellCommandRecord(parsed.lastCommand),
          recentCommands: parsed.recentCommands
            .map((record) => this.normalizeShellCommandRecord(record))
            .filter((record): record is SessionShellCommandRecord => record !== null),
        }
      }
      if (
        parsed?.version === 1 &&
        typeof parsed.cwd === "string" &&
        typeof parsed.updatedAt === "string"
      ) {
        return {
          version: 5,
          cwd: parsed.cwd,
          updatedAt: parsed.updatedAt,
          env: {},
          persistentShell: null,
          lastCommand: this.normalizeShellCommandRecord(parsed.lastCommand),
          recentCommands: parsed.lastCommand
            ? [this.normalizeShellCommandRecord(parsed.lastCommand)].filter(
                (record): record is SessionShellCommandRecord => record !== null,
              )
            : [],
        }
      }
      return null
    } catch {
      return null
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  }

  private async writeText(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${value.trimEnd()}\n`, "utf8")
  }

  private pathForTarget(
    agentId: string,
    sessionId: string,
    target: RuntimeMemoryWritableTarget,
  ): string {
    return target === "session_state"
      ? this.sessionStatePath(agentId, sessionId)
      : this.workingBufferPath(agentId, sessionId)
  }

  private async replaceTarget(
    agentId: string,
    sessionId: string,
    target: RuntimeMemoryWritableTarget,
    content: string,
  ): Promise<string> {
    const normalized = content.trimEnd()
    await this.writeText(this.pathForTarget(agentId, sessionId, target), normalized)
    return normalized
  }

  private async appendToTarget(
    agentId: string,
    sessionId: string,
    target: RuntimeMemoryWritableTarget,
    content: string,
  ): Promise<string> {
    const path = this.pathForTarget(agentId, sessionId, target)
    const existing = (await this.readText(path)) ?? ""
    const nextContent =
      existing.length > 0 ? `${existing.trimEnd()}\n${content.trim()}` : content.trim()
    await this.writeText(path, nextContent)
    return nextContent
  }

  private nextRecentCommands(
    existing: SessionShellCommandRecord[],
    lastCommand: SessionShellCommandRecord | null | undefined,
  ): SessionShellCommandRecord[] {
    if (!lastCommand) {
      return existing.slice(0, 5)
    }
    return [
      lastCommand,
      ...existing.filter((record) => record.commandId !== lastCommand.commandId),
    ].slice(0, 5)
  }

  private normalizeShellEnv(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {}
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          typeof entry[1] === "string" &&
          entry[0].trim().length > 0,
      )
      .map(([key, envValue]) => [key.trim(), envValue] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(entries)
  }

  private normalizeShellCommandRecord(value: unknown): SessionShellCommandRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.command !== "string" ||
      !Array.isArray(record.args) ||
      typeof record.cwd !== "string" ||
      typeof record.updatedAt !== "string"
    ) {
      return null
    }
    return {
      commandId:
        typeof record.commandId === "string" && record.commandId.trim().length > 0
          ? record.commandId
          : computeShellCommandId({
              command: record.command,
              args: record.args.filter((item): item is string => typeof item === "string"),
              cwd: record.cwd,
              updatedAt: record.updatedAt,
            }),
      command: record.command,
      args: record.args.filter((item): item is string => typeof item === "string"),
      cwd: record.cwd,
      exitCode:
        typeof record.exitCode === "number" && Number.isFinite(record.exitCode)
          ? record.exitCode
          : null,
      timedOut: record.timedOut === true,
      durationMs:
        typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
          ? record.durationMs
          : 0,
      updatedAt: record.updatedAt,
      outputPreview: normalizeOptionalText(
        typeof record.outputPreview === "string" ? record.outputPreview : null,
      ),
      stdoutPreview: normalizeOptionalText(
        typeof record.stdoutPreview === "string" ? record.stdoutPreview : null,
      ),
      stderrPreview: normalizeOptionalText(
        typeof record.stderrPreview === "string" ? record.stderrPreview : null,
      ),
    }
  }

  private withShellCommandId(record: SessionShellCommandRecordInput): SessionShellCommandRecord {
    if (record.commandId?.trim()) {
      return {
        ...record,
        commandId: record.commandId,
      }
    }
    return {
      ...record,
      commandId: computeShellCommandId({
        command: record.command,
        args: record.args,
        cwd: record.cwd,
        updatedAt: record.updatedAt,
      }),
    }
  }

  private normalizePersistentShellState(value: unknown): SessionPersistentShellState | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.shellId !== "string" ||
      typeof record.shellPath !== "string" ||
      typeof record.startedAt !== "string" ||
      typeof record.updatedAt !== "string"
    ) {
      return null
    }
    return {
      shellId: record.shellId,
      shellPath: record.shellPath,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      lastCommandAt:
        typeof record.lastCommandAt === "string" && record.lastCommandAt.trim().length > 0
          ? record.lastCommandAt
          : null,
      commandCount:
        typeof record.commandCount === "number" && Number.isFinite(record.commandCount)
          ? Math.max(0, Math.floor(record.commandCount))
          : 0,
      status: record.status === "closed" ? "closed" : "active",
    }
  }

  private async writeShellRuntimeFiles(
    agentId: string,
    sessionId: string,
    shellState: SessionShellState,
  ): Promise<void> {
    const runtimeDir = this.shellRuntimeCatalogDir(agentId, sessionId)
    const materializedShellState = this.materializeShellState(shellState)
    await mkdir(runtimeDir, { recursive: true })
    await Promise.all([
      this.writeJson(this.shellRuntimeStatePath(agentId, sessionId), materializedShellState),
      this.writeJson(this.shellRuntimeHistoryJsonPath(agentId, sessionId), {
        sessionId,
        cwd: shellState.cwd,
        updatedAt: shellState.updatedAt,
        env: materializedShellState.env,
        count: shellState.recentCommands.length,
        commands: shellState.recentCommands,
      }),
      this.writeJson(this.shellRuntimeLastOutputJsonPath(agentId, sessionId), {
        sessionId,
        cwd: shellState.cwd,
        updatedAt: shellState.updatedAt,
        lastCommand: shellState.lastCommand,
      }),
      this.writeText(
        this.shellRuntimeHistoryMarkdownPath(agentId, sessionId),
        this.buildShellHistoryMarkdown(sessionId, shellState),
      ),
      this.writeText(
        this.shellRuntimeLastOutputMarkdownPath(agentId, sessionId),
        this.buildShellLastOutputMarkdown(sessionId, shellState),
      ),
    ])
  }

  private buildShellHistoryMarkdown(sessionId: string, shellState: SessionShellState): string {
    return [
      "# Shell History",
      "",
      `- Session: \`${sessionId}\``,
      `- Current CWD: \`${shellState.cwd}\``,
      `- Updated At: \`${shellState.updatedAt}\``,
      `- Env Keys: \`${Object.keys(shellState.env).length}\``,
      `- Persistent Shell: \`${shellState.persistentShell?.status ?? "none"}\``,
      `- Recent Commands: \`${String(shellState.recentCommands.length)}\``,
      ...(shellState.persistentShell
        ? [
            "",
            "## Persistent Shell",
            "",
            `- Shell ID: \`${shellState.persistentShell.shellId}\``,
            `- Shell Path: \`${shellState.persistentShell.shellPath}\``,
            `- Status: \`${shellState.persistentShell.status}\``,
            `- Started At: \`${shellState.persistentShell.startedAt}\``,
            `- Updated At: \`${shellState.persistentShell.updatedAt}\``,
            `- Last Command At: \`${shellState.persistentShell.lastCommandAt ?? "none"}\``,
            `- Command Count: \`${String(shellState.persistentShell.commandCount)}\``,
          ]
        : []),
      ...(Object.keys(shellState.env).length > 0
        ? [
            "",
            "## Session Shell Environment",
            "",
            ...Object.entries(shellState.env).map(([key, value]) => `- \`${key}\` = \`${value}\``),
          ]
        : []),
      "",
      ...(shellState.recentCommands.length > 0
        ? [
            "## Recent Commands",
            "",
            ...shellState.recentCommands.flatMap((command, index) => [
              `### ${String(index + 1)}. \`${[command.command, ...command.args].join(" ").trim()}\``,
              `- cwd: \`${command.cwd}\``,
              `- updatedAt: \`${command.updatedAt}\``,
              `- exitCode: \`${command.exitCode ?? "none"}\``,
              `- timedOut: \`${String(command.timedOut)}\``,
              `- durationMs: \`${String(command.durationMs)}\``,
              ...(command.stdoutPreview
                ? ["", "#### stdout", "", "```text", command.stdoutPreview, "```"]
                : []),
              ...(command.stderrPreview
                ? ["", "#### stderr", "", "```text", command.stderrPreview, "```"]
                : []),
              ...(command.outputPreview
                ? ["", "#### summary", "", "```text", command.outputPreview, "```"]
                : []),
              "",
            ]),
          ]
        : ["No shell commands recorded yet."]),
    ].join("\n")
  }

  private buildShellLastOutputMarkdown(sessionId: string, shellState: SessionShellState): string {
    if (!shellState.lastCommand) {
      return [
        "# Shell Last Output",
        "",
        `- Session: \`${sessionId}\``,
        `- Current CWD: \`${shellState.cwd}\``,
        `- Updated At: \`${shellState.updatedAt}\``,
        "",
        "No shell command output has been recorded yet.",
      ].join("\n")
    }

    const command = shellState.lastCommand
    return [
      "# Shell Last Output",
      "",
      `- Session: \`${sessionId}\``,
      `- Current CWD: \`${shellState.cwd}\``,
      `- Updated At: \`${shellState.updatedAt}\``,
      `- Command: \`${[command.command, ...command.args].join(" ").trim()}\``,
      `- Command CWD: \`${command.cwd}\``,
      `- Exit Code: \`${command.exitCode ?? "none"}\``,
      `- Timed Out: \`${String(command.timedOut)}\``,
      `- Duration Ms: \`${String(command.durationMs)}\``,
      ...(command.stdoutPreview
        ? ["", "## stdout", "", "```text", command.stdoutPreview, "```"]
        : []),
      ...(command.stderrPreview
        ? ["", "## stderr", "", "```text", command.stderrPreview, "```"]
        : []),
      ...(command.outputPreview
        ? ["", "## summary", "", "```text", command.outputPreview, "```"]
        : []),
    ].join("\n")
  }

  private materializeShellState(shellState: SessionShellState) {
    return {
      version: shellState.version,
      cwd: shellState.cwd,
      updatedAt: shellState.updatedAt,
      env: {
        count: Object.keys(shellState.env).length,
        keys: Object.keys(shellState.env),
      },
      persistentShell: shellState.persistentShell,
      lastCommand: shellState.lastCommand,
      recentCommands: shellState.recentCommands,
    }
  }

  private buildSessionStateMarkdown(input: WriteSessionRuntimeMemoryInput): string {
    return [
      "# Session State",
      "",
      `- Agent: \`${input.agentId}\``,
      `- Session: \`${input.sessionId}\``,
      `- Updated At: \`${input.updatedAt}\``,
      `- Last Wake: \`${input.wakeId ?? "none"}\``,
      `- Outcome: \`${input.outcome}\``,
      `- Stop Reason: \`${input.stopReason}\``,
      `- Next Wake At: \`${input.nextWakeAt ?? "none"}\``,
      `- Consecutive Follow-Ups: \`${String(input.consecutiveFollowUps)}\``,
      `- Active Outcome: \`${input.activeOutcome?.title ?? "none"}\``,
      `- Processed Events: \`${String(input.processedEventIds.length)}\``,
      `- Last Context Event: \`${input.lastContextEventId ?? "none"}\``,
      `- Last Processed Event: \`${input.processedEventIds.at(-1) ?? "none"}\``,
      `- Last Produced Event: \`${input.producedEventId ?? "none"}\``,
      `- Queued Wakes: \`${String(input.queuedWakes.length)}\``,
      `- Learnings Captured: \`${String(input.learnings.length)}\``,
      "",
      "## Latest Summary",
      "",
      input.summary,
      ...(input.activeOutcome
        ? [
            "",
            "## Active Outcome",
            "",
            `- Title: ${input.activeOutcome.title}`,
            `- Detail: ${input.activeOutcome.detail ?? "none"}`,
            `- Success Criteria: ${
              input.activeOutcome.successCriteria.length > 0
                ? input.activeOutcome.successCriteria.join(" | ")
                : "none"
            }`,
          ]
        : []),
      ...(input.learnings.length > 0
        ? [
            "",
            "## New Learnings",
            "",
            ...input.learnings.map(
              (learning) =>
                `- [${learning.kind}] ${learning.title}${learning.promoteToMemory ? " (promoted to MEMORY.md)" : ""}\n  - ${learning.detail}`,
            ),
          ]
        : []),
      ...(input.queuedWakes.length > 0
        ? [
            "",
            "## Queued Wakes",
            "",
            ...input.queuedWakes.map(
              (wake) =>
                `- \`${wake.reason}\` at \`${wake.dueAt}\`${wake.note ? ` — ${wake.note}` : ""}`,
            ),
          ]
        : []),
      "",
      "## Latest Response",
      "",
      input.responseMessage ?? "No response content was produced.",
    ].join("\n")
  }

  private buildWorkingBufferMarkdown(input: WriteSessionRuntimeMemoryInput): string {
    return [
      "# Working Buffer",
      "",
      `- Current focus: ${input.summary}`,
      `- Suggested next move: ${input.outcome === "continue" ? "wake the same session again soon" : "wait for new events or scheduled revisit"}`,
      `- Stop reason: ${input.stopReason}`,
      `- Active outcome: ${input.activeOutcome?.title ?? "none"}`,
      `- Processed events: ${String(input.processedEventIds.length)}`,
      `- Last context event: ${input.lastContextEventId ?? "none"}`,
      `- Last processed event: ${input.processedEventIds.at(-1) ?? "none"}`,
      `- Last produced event: ${input.producedEventId ?? "none"}`,
      `- Consecutive follow-ups: ${String(input.consecutiveFollowUps)}`,
      `- Queued wakes: ${String(input.queuedWakes.length)}`,
      "",
      "## Runtime Notes",
      "",
      `- nextWakeAt: \`${input.nextWakeAt ?? "none"}\``,
      `- learnings: \`${String(input.learnings.length)}\``,
      ...(input.learnings.length > 0
        ? [
            "",
            "## Reusable Learnings",
            "",
            ...input.learnings.map(
              (learning) =>
                `- [${learning.kind}] ${learning.title}${learning.promoteToMemory ? " (promoted)" : ""}\n  - ${learning.detail}`,
            ),
          ]
        : []),
      ...(input.queuedWakes.length > 0
        ? [
            "",
            "## Enqueued Revisit Requests",
            "",
            ...input.queuedWakes.map(
              (wake) =>
                `- \`${wake.reason}\` at \`${wake.dueAt}\`${wake.note ? ` — ${wake.note}` : ""}`,
            ),
          ]
        : []),
      "",
      "## Response Excerpt",
      "",
      input.responseMessage ?? "No response content was produced.",
    ].join("\n")
  }

  private nextOutcomeEvaluationHistory(
    existing: SessionOutcomeEvaluationRecord[],
    input: RecordSessionOutcomeEvaluationInput,
  ): SessionOutcomeEvaluationRecord[] {
    const outcomeFingerprint = computeOutcomeDefinitionFingerprint(input.activeOutcome)
    const previous = existing.at(-1) ?? null
    const sameWake =
      previous !== null &&
      previous.wakeId === input.wakeId &&
      previous.outcomeFingerprint === outcomeFingerprint
    const sameVerdict =
      sameWake &&
      previous.gradeStatus === input.gradeStatus &&
      previous.evaluation.status === input.evaluation.status &&
      previous.evaluation.summary === input.evaluation.summary &&
      previous.evaluation.promotionReady === input.evaluation.promotionReady
    const latestIterationForOutcome = [...existing]
      .reverse()
      .find((entry) => entry.outcomeFingerprint === outcomeFingerprint)?.iteration
    const record: SessionOutcomeEvaluationRecord = {
      evaluatedAt: input.evaluatedAt,
      wakeId: input.wakeId,
      iteration:
        sameWake && previous
          ? previous.iteration
          : outcomeFingerprint !== null && typeof latestIterationForOutcome === "number"
            ? latestIterationForOutcome + 1
            : 0,
      outcomeTitle: input.activeOutcome?.title ?? null,
      outcomeFingerprint,
      gradeStatus: input.gradeStatus,
      evaluation: input.evaluation,
    }
    if (sameWake || sameVerdict) {
      return [...existing.slice(0, -1), record].slice(-12)
    }
    return [...existing, record].slice(-12)
  }
}
