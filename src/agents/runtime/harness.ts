import { makeUuidV7 } from "../../foundation/ids.js"
import { loadAgentConfig } from "../agent-config.js"
import { CodexAuthProvider } from "../auth/codex-auth.js"
import {
  buildContextBudgetSnapshot,
  type ContextBudgetSnapshot,
} from "../context/context-budget.js"
import {
  buildSystemPrompt as buildBootstrapSystemPrompt,
  loadBootstrapConfig,
} from "../environment/bootstrap.js"
import { EnvironmentStore } from "../environment/environment-store.js"
import { buildRuntimeEnvironmentPrompt } from "../environment/runtime-environment.js"
import { AgentLearningsStore } from "../memory/learnings-store.js"
import { RuntimeMemoryStore } from "../memory/runtime-memory-store.js"
import {
  applyLiveShellOutcomeGuard,
  evaluateSessionOutcome,
  type SessionOutcomeEvaluation,
} from "../outcomes/outcome-evaluate.js"
import { deriveSessionActiveOutcome, gradeSessionOutcome } from "../outcomes/outcome-grade.js"
import { isRetryableProviderError } from "../providers/provider-runtime-contract.js"
import {
  writeSessionContextBudgetArtifacts,
  writeSessionRuntimeCatalog,
  writeSessionRuntimeStateArtifacts,
} from "../resources/default-resources.js"
import { formatRetrievalCandidateHint, formatRetrievalPlanHint } from "../retrieval/pipeline.js"
import { composeRetrievalQueryParts } from "../retrieval/query.js"
import { presentRetrievalSearchResult, searchCrossSessionRecall } from "../retrieval/search.js"
import { AgentTurnRunner } from "../runners/agent-runner.js"
import { LocalSandbox } from "../sandbox/sandbox.js"
import type {
  Harness,
  HarnessRunResult,
  PendingEvent,
  Session,
  SessionEvent,
  SessionOutcomeDefinition,
  SessionSpanKind,
  SessionSpanResult,
} from "../schema/runtime.js"
import { buildSessionContext, summarizePendingEvent } from "../sessions/context-builder.js"
import { loadSessionContextEvents } from "../sessions/context-query-policy.js"
import { SessionStore } from "../sessions/session-store.js"
import { loadCompanySkillEntries, searchSkillEntries } from "../skills/agent-skills.js"
import { buildManagedRuntimeTools } from "../tools/managed-runtime-tools.js"
import { loadAgentWorkspaceBootstrapEntries } from "../workspace/bootstrap-files.js"
import {
  buildHarnessMessage,
  buildHarnessSystemPromptAppendix,
  resolveLoopDirective,
} from "./loop-directive.js"
import { SessionWakeQueue } from "./session-wake-queue.js"
import { runSessionLoop } from "./wake-session.js"

export interface AgentHarnessDependencies {
  sessionStore?: SessionStore
  environmentStore?: EnvironmentStore
  memoryStore?: RuntimeMemoryStore
  learningsStore?: AgentLearningsStore
  wakeQueue?: SessionWakeQueue
  runner?: Pick<AgentTurnRunner, "run">
  authProvider?: Pick<CodexAuthProvider, "resolve">
  sandbox?: LocalSandbox
}

export interface HarnessWakeContext {
  reason: string
  note: string | null
}

interface PromptBuildResult {
  bootstrapPrompt: string
  runtimeEnvironmentPrompt: string
  harnessAppendix: string
  systemPrompt: string
}

function formatContextPressureHint(input: { contextBudget: ContextBudgetSnapshot }): string | null {
  const budget = input.contextBudget
  const lowHeadroom = budget.selectionHeadroomTokens <= 256
  const droppedConversation = budget.history.droppedConversationCount > 0
  const droppedRuntimeNotes = budget.history.droppedRuntimeNoteCount > 0

  if (!lowHeadroom && !droppedConversation && !droppedRuntimeNotes) {
    return null
  }

  const pressure =
    droppedConversation || droppedRuntimeNotes ? "crowded" : lowHeadroom ? "tight" : "stable"

  return [
    "[context-pressure]",
    `pressure=${pressure}`,
    `headroom=${String(budget.selectionHeadroomTokens)}`,
    `selected=${String(budget.history.selectedCount)}/${String(budget.history.totalCount)}`,
    `droppedConversation=${String(budget.history.droppedConversationCount)}`,
    `droppedRuntimeNotes=${String(budget.history.droppedRuntimeNoteCount)}`,
    "nextTool=session_describe_context",
    "nextArgs={}",
    `nextWhy=${JSON.stringify(
      "Inspect current context budget and prefer retrieval_search or session rereads before adding broad new context.",
    )}`,
  ].join(" ")
}

const MAX_AUTOMATIC_RECALL_HINTS = 3
const MAX_AUTOMATIC_SKILL_HINTS = 2
const MAX_AUTOMATIC_SESSION_CANDIDATES = 2

function outcomeTrendPriority(value: SessionOutcomeEvaluation["trend"] | null | undefined): number {
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

function shouldIncludeOutcomeRepairHint(
  status: ReturnType<typeof gradeSessionOutcome>["status"],
): boolean {
  return (
    status === "missing_outcome" ||
    status === "blocked" ||
    status === "sleeping" ||
    status === "done_candidate"
  )
}

function formatOutcomeRepairHint(input: {
  activeOutcome: SessionOutcomeDefinition | null
  outcomeGrade: ReturnType<typeof gradeSessionOutcome>
}): string | null {
  if (!shouldIncludeOutcomeRepairHint(input.outcomeGrade.status)) {
    return null
  }
  const nextSuggestedTool = input.outcomeGrade.nextSuggestedTool
  return [
    "[outcome-repair]",
    `status=${input.outcomeGrade.status}`,
    `confidence=${input.outcomeGrade.confidence}`,
    `matched=${String(input.outcomeGrade.matchedCriteria)}/${String(input.outcomeGrade.totalCriteria)}`,
    `summary=${JSON.stringify(input.outcomeGrade.summary)}`,
    ...(input.activeOutcome ? [`title=${JSON.stringify(input.activeOutcome.title)}`] : []),
    ...(input.outcomeGrade.evidence.length > 0
      ? [`evidence=${JSON.stringify(input.outcomeGrade.evidence.slice(0, 3).join(" | "))}`]
      : []),
    ...(nextSuggestedTool
      ? [
          `nextTool=${nextSuggestedTool.tool}`,
          `nextArgs=${JSON.stringify(nextSuggestedTool.args)}`,
          `nextWhy=${JSON.stringify(nextSuggestedTool.rationale)}`,
        ]
      : []),
  ].join(" ")
}

function formatPromotionGateHint(input: {
  activeOutcome: SessionOutcomeDefinition | null
  outcomeEvaluation: SessionOutcomeEvaluation
}): string | null {
  if (!input.activeOutcome || input.outcomeEvaluation.promotionReady) {
    return null
  }
  const nextSuggestedTool = input.outcomeEvaluation.nextSuggestedTool
  return [
    "[promotion-gate]",
    `status=${input.outcomeEvaluation.status}`,
    `confidence=${input.outcomeEvaluation.confidence}`,
    `promotionReady=${String(input.outcomeEvaluation.promotionReady)}`,
    `trend=${input.outcomeEvaluation.trend}`,
    `title=${JSON.stringify(input.activeOutcome.title)}`,
    `summary=${JSON.stringify(input.outcomeEvaluation.summary)}`,
    ...(input.outcomeEvaluation.trendSummary
      ? [`trendSummary=${JSON.stringify(input.outcomeEvaluation.trendSummary)}`]
      : []),
    ...(input.outcomeEvaluation.evidence.length > 0
      ? [`evidence=${JSON.stringify(input.outcomeEvaluation.evidence.slice(0, 3).join(" | "))}`]
      : []),
    ...(nextSuggestedTool
      ? [
          `nextTool=${nextSuggestedTool.tool}`,
          `nextArgs=${JSON.stringify(nextSuggestedTool.args)}`,
          `nextWhy=${JSON.stringify(nextSuggestedTool.rationale)}`,
        ]
      : []),
  ].join(" ")
}

function formatOutcomeTrendHint(input: {
  activeOutcome: SessionOutcomeDefinition | null
  outcomeEvaluation: SessionOutcomeEvaluation
}): string | null {
  if (
    !input.activeOutcome ||
    input.outcomeEvaluation.promotionReady ||
    (input.outcomeEvaluation.trend !== "stable" && input.outcomeEvaluation.trend !== "regressing")
  ) {
    return null
  }
  return [
    "[outcome-trend]",
    `trend=${input.outcomeEvaluation.trend}`,
    `status=${input.outcomeEvaluation.status}`,
    `promotionReady=${String(input.outcomeEvaluation.promotionReady)}`,
    `title=${JSON.stringify(input.activeOutcome.title)}`,
    `summary=${JSON.stringify(input.outcomeEvaluation.summary)}`,
    ...(input.outcomeEvaluation.trendSummary
      ? [`trendSummary=${JSON.stringify(input.outcomeEvaluation.trendSummary)}`]
      : []),
    "nextTool=outcome_history",
    "nextArgs={}",
    `nextWhy=${JSON.stringify(
      "Evaluator posture is not improving. Inspect recent evaluator history before attempting another broad mutation or shared promotion.",
    )}`,
  ].join(" ")
}

function formatSetupDriftHint(input: {
  previousFingerprint: string | null
  currentFingerprint: string | null
}): string | null {
  if (
    !input.previousFingerprint ||
    !input.currentFingerprint ||
    input.previousFingerprint === input.currentFingerprint
  ) {
    return null
  }
  return [
    "[setup-drift]",
    `previousFingerprint=${input.previousFingerprint}`,
    `currentFingerprint=${input.currentFingerprint}`,
    "nextTool=session_get_snapshot",
    "nextArgs={}",
    `nextWhy=${JSON.stringify(
      "The agent setup contract changed since the last successful wake. Re-read the current session snapshot and agent-setup artifact before relying on prior shell, prompt, or promotion assumptions.",
    )}`,
  ].join(" ")
}

function formatShellBusyHint(input: {
  shell: {
    shellId: string
    status: "active" | "closed"
    commandCount: number
    busy: boolean
    currentCommand: string | null
    currentCommandStartedAt: string | null
    currentStdoutPreview: string | null
    currentStderrPreview: string | null
  } | null
}): string | null {
  if (!input.shell || input.shell.status !== "active" || input.shell.busy !== true) {
    return null
  }
  const safeReadTools = [
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
  ]
  const nextTool =
    input.shell.currentStdoutPreview || input.shell.currentStderrPreview
      ? {
          tool: "shell_read_last_output",
          args: "{}",
          rationale:
            "A live persistent shell command is still running, but bounded output is already available. Inspect the latest shell output before deciding whether any further mutation is needed.",
        }
      : {
          tool: "shell_wait",
          args: '{"timeoutMs":1000}',
          rationale:
            "A live persistent shell command is still running. Wait on the live shell before issuing another shell mutation, then use shell_read_last_output or shell_describe if you still only need bounded evidence.",
        }
  return [
    "[shell-busy]",
    `shellId=${input.shell.shellId}`,
    `commandCount=${String(input.shell.commandCount)}`,
    ...(input.shell.currentCommand
      ? [`currentCommand=${JSON.stringify(input.shell.currentCommand)}`]
      : []),
    ...(input.shell.currentCommandStartedAt
      ? [`startedAt=${input.shell.currentCommandStartedAt}`]
      : []),
    ...(input.shell.currentStdoutPreview
      ? [`stdoutPreview=${JSON.stringify(input.shell.currentStdoutPreview)}`]
      : []),
    ...(input.shell.currentStderrPreview
      ? [`stderrPreview=${JSON.stringify(input.shell.currentStderrPreview)}`]
      : []),
    `readTools=${safeReadTools.join(",")}`,
    `nextTool=${nextTool.tool}`,
    `nextArgs=${nextTool.args}`,
    `nextWhy=${JSON.stringify(nextTool.rationale)}`,
  ].join(" ")
}

function resolvePendingInterrupt(
  pendingEvents: PendingEvent[],
): Extract<PendingEvent, { type: "user.interrupt" }> | null {
  return (
    [...pendingEvents]
      .reverse()
      .find(
        (event): event is Extract<PendingEvent, { type: "user.interrupt" }> =>
          event.type === "user.interrupt",
      ) ?? null
  )
}

function formatOpenLoopCue(input: {
  session: Session
  pendingEvents: PendingEvent[]
}): string | null {
  const latestPendingEvent = input.pendingEvents.at(-1) ?? null
  const pendingEventSummary = latestPendingEvent ? summarizePendingEvent(latestPendingEvent) : null
  const customToolRequest = input.session.pendingCustomToolRequest
  const customToolCue = customToolRequest
    ? `open-loop custom-tool ${customToolRequest.name} input=${JSON.stringify(customToolRequest.input)}`
    : null

  const parts = [
    input.session.stopReason !== "idle" ? `stopReason ${input.session.stopReason}` : null,
    pendingEventSummary,
    customToolCue,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0))

  return parts.length > 0 ? parts.join("\n") : null
}

function extractQuotedText(value: string): string | null {
  const match = value.match(/"([^"\n]{2,120})"|'([^'\n]{2,120})'/u)
  return match ? (match[1] ?? match[2] ?? null) : null
}

function extractPathLikeToken(value: string): string | null {
  const match = value.match(
    /(?:\/[\w./-]+|\b[\w.-]+\.(?:md|txt|json|ts|tsx|js|jsx|mjs|cjs|yml|yaml|sh|py|rb|go|swift|java|kt|rs|toml|lock|log)\b)/u,
  )
  return match?.[0] ?? null
}

function extractSearchToken(value: string): string | null {
  const quoted = extractQuotedText(value)
  if (quoted) {
    return quoted
  }
  const identifierMatch = value.match(/\b[A-Za-z_][A-Za-z0-9_.-]{2,}\b/u)
  if (identifierMatch?.[0]) {
    return identifierMatch[0]
  }
  return null
}

const BOOTSTRAP_SUBSTRATE_FILES = new Set([
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
])
function extractBootstrapFileName(value: string): string | null {
  for (const fileName of BOOTSTRAP_SUBSTRATE_FILES) {
    if (value.includes(fileName)) {
      return fileName
    }
  }
  return null
}

function formatReadFirstHint(input: {
  latestUserMessage: string | null
  runtimeMemory: Awaited<ReturnType<RuntimeMemoryStore["read"]>>
  livePersistentShell: {
    busy: boolean
  } | null
  pendingCustomToolRequest: Session["pendingCustomToolRequest"]
  pendingToolConfirmationRequest: Session["pendingToolConfirmationRequest"]
}): string | null {
  if (
    !input.latestUserMessage ||
    input.livePersistentShell?.busy === true ||
    input.pendingCustomToolRequest !== null ||
    input.pendingToolConfirmationRequest !== null
  ) {
    return null
  }

  const message = input.latestUserMessage.trim()
  if (message.length === 0) {
    return null
  }
  const lowered = message.toLowerCase()
  const cwd = input.runtimeMemory.shellState?.cwd ?? "/workspace"
  const bootstrapFile = extractBootstrapFileName(message)

  if (
    bootstrapFile &&
    /(quote|exact|verbatim|line|read|open|inspect|show|what does it say)/u.test(lowered) &&
    !/(append|edit|modify|rewrite|replace|change|promote|stage|write|create|delete)/u.test(lowered)
  ) {
    return [
      "[read-first]",
      "intent=bootstrap_read",
      "resourceScope=shared_substrate",
      "nextTool=read",
      `nextArgs=${JSON.stringify({ path: `/workspace/agent/${bootstrapFile}` })}`,
      `nextWhy=${JSON.stringify(
        "This is a read-only question about a shared bootstrap file. Read /workspace/agent directly or answer from the current bootstrap context; do not open a writable shell path for it.",
      )}`,
      "fallbackTools=resources_list,session_describe_context,permissions_describe",
    ].join(" ")
  }

  if (
    /(last output|latest output|stdout|stderr|last command|what happened|why failed|failure output|error output|logs?)/u.test(
      lowered,
    ) &&
    input.runtimeMemory.shellState?.lastCommand
  ) {
    return [
      "[read-first]",
      "intent=shell_output",
      "nextTool=shell_read_last_output",
      "nextArgs={}",
      `nextWhy=${JSON.stringify(
        "Start with the latest bounded shell output before reaching for another shell mutation.",
      )}`,
      "fallbackTools=shell_history,shell_describe,bash",
    ].join(" ")
  }

  const pathToken = extractPathLikeToken(message)
  if (pathToken && /(read|open|show|inspect|check|review|look at|see)/u.test(lowered)) {
    return [
      "[read-first]",
      "intent=file_read",
      "nextTool=read",
      `nextArgs=${JSON.stringify({ path: pathToken })}`,
      `nextWhy=${JSON.stringify(
        "A direct file read is cheaper and more precise than opening a broader shell path for this request.",
      )}`,
      "fallbackTools=glob,grep,bash",
    ].join(" ")
  }

  if (/(find|search|grep|locate|contains|match|where is|which file)/u.test(lowered)) {
    const query = extractSearchToken(message)
    if (query) {
      return [
        "[read-first]",
        "intent=workspace_search",
        "nextTool=grep",
        `nextArgs=${JSON.stringify({ path: "/workspace", query })}`,
        `nextWhy=${JSON.stringify(
          "Search the current session workspace first before escalating to a writable shell composition step.",
        )}`,
        "fallbackTools=glob,read,retrieval_search",
      ].join(" ")
    }
  }

  if (
    /(list files|show files|which files|inspect workspace|list directories|show directory|show folder)/u.test(
      lowered,
    )
  ) {
    return [
      "[read-first]",
      "intent=workspace_listing",
      "nextTool=glob",
      `nextArgs=${JSON.stringify({ path: "/workspace", pattern: "**/*", limit: 40 })}`,
      `nextWhy=${JSON.stringify(
        "List matching workspace paths directly before switching into a broader shell workflow.",
      )}`,
      "fallbackTools=read,grep,bash",
    ].join(" ")
  }

  if (
    /(cwd|working dir|working directory|current dir|current directory|where am i)/u.test(lowered)
  ) {
    return [
      "[read-first]",
      "intent=cwd_check",
      "nextTool=bash",
      `nextArgs=${JSON.stringify({ command: "pwd", cwd })}`,
      `nextWhy=${JSON.stringify(
        "Use the bounded read-only shell hand for cwd inspection before considering a writable persistent shell step.",
      )}`,
      "fallbackTools=shell_describe,shell_history",
    ].join(" ")
  }

  return null
}

export class AgentHarness implements Harness {
  private readonly sessionStore: SessionStore
  private readonly environmentStore: EnvironmentStore
  private readonly memoryStore: RuntimeMemoryStore
  private readonly learningsStore: AgentLearningsStore
  private readonly wakeQueue: SessionWakeQueue
  private readonly runner: Pick<AgentTurnRunner, "run">
  private readonly authProvider: Pick<CodexAuthProvider, "resolve">
  private readonly sandbox: LocalSandbox

  constructor(
    private readonly companyDir: string,
    dependencies: AgentHarnessDependencies = {},
  ) {
    this.sessionStore = dependencies.sessionStore ?? new SessionStore(companyDir)
    this.environmentStore = dependencies.environmentStore ?? new EnvironmentStore(companyDir)
    this.memoryStore = dependencies.memoryStore ?? new RuntimeMemoryStore(companyDir)
    this.learningsStore = dependencies.learningsStore ?? new AgentLearningsStore(companyDir)
    this.wakeQueue = dependencies.wakeQueue ?? new SessionWakeQueue(companyDir, this.sessionStore)
    this.runner = dependencies.runner ?? new AgentTurnRunner()
    this.authProvider = dependencies.authProvider ?? new CodexAuthProvider(companyDir)
    this.sandbox = dependencies.sandbox ?? new LocalSandbox()
  }

  private async inspectLivePersistentShellState(): Promise<{
    shellId: string
    status: "active" | "closed"
    commandCount: number
    busy: boolean
    currentCommand: string | null
    currentCommandStartedAt: string | null
    currentStdoutPreview: string | null
    currentStderrPreview: string | null
  } | null> {
    const inspected = await this.sandbox.execute("inspect_persistent_shell", {})
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
    if (!persistentShell || typeof persistentShell.shellId !== "string") {
      return null
    }
    return {
      shellId: persistentShell.shellId,
      status: persistentShell.status === "closed" ? "closed" : "active",
      commandCount:
        typeof persistentShell.commandCount === "number" &&
        Number.isFinite(persistentShell.commandCount)
          ? persistentShell.commandCount
          : 0,
      busy: persistentShell.busy === true,
      currentCommand:
        typeof persistentShell.currentCommand === "string" ? persistentShell.currentCommand : null,
      currentCommandStartedAt:
        typeof persistentShell.currentCommandStartedAt === "string"
          ? persistentShell.currentCommandStartedAt
          : null,
      currentStdoutPreview:
        typeof persistentShell.currentStdoutPreview === "string"
          ? persistentShell.currentStdoutPreview
          : null,
      currentStderrPreview:
        typeof persistentShell.currentStderrPreview === "string"
          ? persistentShell.currentStderrPreview
          : null,
    }
  }

  async run(sessionId: string, wakeContext?: HarnessWakeContext | null): Promise<HarnessRunResult> {
    const snapshot = await this.sessionStore.getSession(sessionId)
    const pendingEvents = snapshot.events.filter(
      (event): event is PendingEvent => event.processedAt === null,
    )
    if (pendingEvents.length === 0 && !wakeContext) {
      return {
        session: snapshot.session,
        wakeId: null,
        response: null,
        stopReason: snapshot.session.stopReason,
        queuedWakes: [],
        processedEventIds: [],
      }
    }

    const [agentConfig, bootstrap, auth, environment, runtimeMemory] = await Promise.all([
      loadAgentConfig(this.companyDir, snapshot.session.agentId),
      loadBootstrapConfig(this.companyDir),
      this.authProvider.resolve(),
      this.environmentStore.getEnvironment(snapshot.session.environmentId),
      this.memoryStore.read(snapshot.session.agentId, snapshot.session.id),
    ])
    const pendingInterrupt = resolvePendingInterrupt(pendingEvents)
    const effectiveSession = pendingInterrupt
      ? await this.clearInterruptedSessionState(snapshot.session, pendingInterrupt)
      : snapshot.session
    if (!environment) {
      throw new Error(`Environment ${snapshot.session.environmentId} was not found`)
    }

    await this.sandbox.provision(effectiveSession.resources)
    const runningAt = new Date().toISOString()
    const wakeId = makeUuidV7()
    await this.transitionToRunning(effectiveSession, runningAt, wakeId)
    await this.emitSpanStarted({
      sessionId: snapshot.session.id,
      wakeId,
      spanId: wakeId,
      parentSpanId: null,
      spanKind: "wake",
      name: "session_run",
      summary: wakeContext
        ? `Wake reason=${wakeContext.reason}${wakeContext.note ? ` note=${wakeContext.note}` : ""}`
        : "Wake triggered by pending session events.",
    })
    const activeOutcome = deriveSessionActiveOutcome({
      snapshot,
      runtimeMemory,
    })
    let lastContextEventId = runtimeMemory.checkpoint?.eventCursor.lastContextEventId ?? null
    let currentAgentSetupFingerprint: string | null = null

    try {
      const contextBudgetRef: { current: ContextBudgetSnapshot | null } = { current: null }
      const runtimeTools = await buildManagedRuntimeTools({
        companyDir: this.companyDir,
        environment,
        session: effectiveSession,
        wakeId,
        pendingEvents,
        sessionStore: this.sessionStore,
        memoryStore: this.memoryStore,
        runtimeMemorySnapshot: runtimeMemory,
        learningsStore: this.learningsStore,
        sandbox: this.sandbox,
        toolPolicy: agentConfig.tools,
        sandboxEnabled: agentConfig.sandbox?.mode === "workspace",
        skillsConfig: agentConfig.skills,
        contextBudgetRef,
        onRunChildSession: async ({ childSessionId, maxCycles }) => {
          const loop = await runSessionLoop({
            sessionId: childSessionId,
            maxCycles,
            sessionStore: this.sessionStore,
            wakeQueue: this.wakeQueue,
            runHarness: (targetSessionId, childWakeContext) =>
              this.run(targetSessionId, childWakeContext),
          })
          return {
            cycles: loop.cycles,
            executed: loop.executed,
            loopStopReason: loop.stopReason,
            session: loop.finalSession,
            response: loop.lastWake?.response ?? null,
            childStopReason: loop.finalSession.stopReason,
            queuedWakeIds: loop.lastWake?.queuedWakeIds ?? [],
            processedEventIds: loop.lastWake?.processedEventIds ?? [],
          }
        },
        onToolUse: async (event) => {
          await this.sessionStore.emitEvent(snapshot.session.id, event)
        },
        onSpanEvent: async (event) => {
          await this.sessionStore.emitEvent(snapshot.session.id, event)
        },
      })
      const runtimeSkills = await loadCompanySkillEntries(
        this.companyDir,
        agentConfig.skills,
      ).catch(() => [])
      const promptBuild = await this.buildSystemPrompt(effectiveSession, environment)
      const bootstrapEntries = await loadAgentWorkspaceBootstrapEntries(
        this.companyDir,
        effectiveSession.agentId,
      )
      const { agentSetupFingerprint } = await writeSessionRuntimeCatalog({
        companyDir: this.companyDir,
        agentId: effectiveSession.agentId,
        sessionId: effectiveSession.id,
        provider: agentConfig.runtime.provider,
        model: agentConfig.model.id,
        resilience: agentConfig.resilience,
        environment,
        resources: effectiveSession.resources,
        bootstrapEntries,
        bootstrapPrompt: promptBuild.bootstrapPrompt,
        runtimeEnvironmentPrompt: promptBuild.runtimeEnvironmentPrompt,
        harnessAppendix: promptBuild.harnessAppendix,
        skills: runtimeSkills,
        tools: runtimeTools,
      })
      currentAgentSetupFingerprint = agentSetupFingerprint
      const systemPrompt = promptBuild.systemPrompt
      const latestProcessedEvents = snapshot.events.filter((event) => event.processedAt !== null)
      const directChildCount = (
        await this.sessionStore.listAgentSessions(effectiveSession.agentId)
      ).filter((candidate) => candidate.metadata?.parentSessionId === effectiveSession.id).length
      const contextEvents = await loadSessionContextEvents({
        sessionId: snapshot.session.id,
        processedEvents: latestProcessedEvents,
        lastContextEventId: runtimeMemory.checkpoint?.eventCursor.lastContextEventId ?? null,
        sessionStore: this.sessionStore,
      })
      lastContextEventId = contextEvents.at(-1)?.id ?? null
      const outcomeGrade = gradeSessionOutcome({
        snapshot,
        runtimeMemory,
      })
      const livePersistentShell = await this.inspectLivePersistentShellState().catch(() => null)
      const outcomeEvaluation = applyLiveShellOutcomeGuard({
        evaluation: evaluateSessionOutcome({
          snapshot,
          runtimeMemory,
        }),
        liveShell: livePersistentShell,
      })
      const latestAgentMessage = [...latestProcessedEvents]
        .reverse()
        .find(
          (event): event is Extract<SessionEvent, { type: "agent.message" }> =>
            event.type === "agent.message",
        )
      const message = buildHarnessMessage({
        sessionId: effectiveSession.id,
        sessionParentId: effectiveSession.metadata?.parentSessionId ?? null,
        directChildCount,
        stopReason: effectiveSession.stopReason,
        pendingEvents: [
          ...pendingEvents.map(summarizePendingEvent),
          ...(wakeContext
            ? [
                `runtime.wake: ${wakeContext.reason}${wakeContext.note ? ` — ${wakeContext.note}` : ""}`,
              ]
            : []),
        ],
        latestSummary: runtimeMemory.checkpoint?.lastSummary ?? null,
        latestResponse: latestAgentMessage?.message ?? null,
        runtimeSessionState: runtimeMemory.sessionState,
        runtimeWorkingBuffer: runtimeMemory.workingBuffer,
        runtimeShellState: runtimeMemory.shellState
          ? {
              cwd: runtimeMemory.shellState.cwd,
              envKeyCount: Object.keys(runtimeMemory.shellState.env).length,
              envKeys: Object.keys(runtimeMemory.shellState.env),
              persistentShell: runtimeMemory.shellState.persistentShell
                ? {
                    shellId:
                      livePersistentShell?.shellId ??
                      runtimeMemory.shellState.persistentShell.shellId,
                    status:
                      livePersistentShell?.status ??
                      runtimeMemory.shellState.persistentShell.status,
                    commandCount:
                      livePersistentShell?.commandCount ??
                      runtimeMemory.shellState.persistentShell.commandCount,
                    busy: livePersistentShell?.busy ?? false,
                    currentCommand: livePersistentShell?.currentCommand ?? null,
                    currentCommandStartedAt: livePersistentShell?.currentCommandStartedAt ?? null,
                  }
                : null,
              recentCommandCount: runtimeMemory.shellState.recentCommands.length,
              lastCommand: runtimeMemory.shellState.lastCommand
                ? {
                    command: runtimeMemory.shellState.lastCommand.command,
                    cwd: runtimeMemory.shellState.lastCommand.cwd,
                    exitCode: runtimeMemory.shellState.lastCommand.exitCode,
                    timedOut: runtimeMemory.shellState.lastCommand.timedOut,
                    outputPreview: runtimeMemory.shellState.lastCommand.outputPreview,
                  }
                : null,
            }
          : null,
        activeOutcome,
        outcomeGrade,
        outcomeEvaluation,
        pendingToolConfirmationRequest: effectiveSession.pendingToolConfirmationRequest
          ? {
              id: effectiveSession.pendingToolConfirmationRequest.id,
              toolName: effectiveSession.pendingToolConfirmationRequest.toolName,
            }
          : null,
      })
      const automaticRecallHistory = await this.buildAutomaticRecallHistory({
        session: effectiveSession,
        pendingEvents,
        runtimeMemory,
        skillsConfig: agentConfig.skills,
        activeOutcome,
        outcomeGrade,
        outcomeEvaluation,
        livePersistentShell,
        currentAgentSetupFingerprint,
      })
      let context = buildSessionContext({
        events: contextEvents,
        sessionId: snapshot.session.id,
        agentId: snapshot.session.agentId,
        systemPrompt,
        incomingMessage: message,
        tokenBudget: bootstrap.tokenBudget,
        supplementalHistory: automaticRecallHistory,
      })
      let contextBudget = buildContextBudgetSnapshot({
        tokenBudget: bootstrap.tokenBudget,
        bootstrapEntries,
        bootstrapPrompt: promptBuild.bootstrapPrompt,
        runtimeEnvironmentPrompt: promptBuild.runtimeEnvironmentPrompt,
        harnessAppendix: promptBuild.harnessAppendix,
        sessionMessage: message,
        builtContext: context,
        tools: runtimeTools,
        skillEntries: runtimeSkills,
        maxPromptSkillEntries: Math.max(1, agentConfig.skills?.maxPromptEntries ?? 8),
      })
      const contextPressureHint = formatContextPressureHint({
        contextBudget,
      })
      if (contextPressureHint) {
        context = buildSessionContext({
          events: contextEvents,
          sessionId: snapshot.session.id,
          agentId: snapshot.session.agentId,
          systemPrompt,
          incomingMessage: message,
          tokenBudget: bootstrap.tokenBudget,
          supplementalHistory: [
            ...automaticRecallHistory,
            {
              role: "assistant",
              kind: "runtime_note",
              message: contextPressureHint,
              timestamp: new Date(Date.parse(runningAt) + 1).toISOString(),
            },
          ],
        })
        contextBudget = buildContextBudgetSnapshot({
          tokenBudget: bootstrap.tokenBudget,
          bootstrapEntries,
          bootstrapPrompt: promptBuild.bootstrapPrompt,
          runtimeEnvironmentPrompt: promptBuild.runtimeEnvironmentPrompt,
          harnessAppendix: promptBuild.harnessAppendix,
          sessionMessage: message,
          builtContext: context,
          tools: runtimeTools,
          skillEntries: runtimeSkills,
          maxPromptSkillEntries: Math.max(1, agentConfig.skills?.maxPromptEntries ?? 8),
        })
      }
      contextBudgetRef.current = contextBudget
      await writeSessionContextBudgetArtifacts({
        companyDir: this.companyDir,
        agentId: effectiveSession.agentId,
        sessionId: effectiveSession.id,
        contextBudget,
      })
      const cliSessionBinding =
        effectiveSession.metadata?.providerSessionBindings?.[agentConfig.runtime.provider]
      const result = await this.runner.run({
        companyDir: this.companyDir,
        agentId: snapshot.session.agentId,
        message,
        systemPrompt,
        context,
        auth,
        agentConfig,
        tools: runtimeTools,
        ...(cliSessionBinding ? { cliSessionBinding } : {}),
      })

      const pendingToolConfirmationDecision =
        effectiveSession.pendingToolConfirmationRequest &&
        pendingEvents.find(
          (event): event is Extract<PendingEvent, { type: "user.tool_confirmation" }> =>
            event.type === "user.tool_confirmation" &&
            event.requestId === effectiveSession.pendingToolConfirmationRequest?.id,
        )
          ? (pendingEvents.find(
              (event): event is Extract<PendingEvent, { type: "user.tool_confirmation" }> =>
                event.type === "user.tool_confirmation" &&
                event.requestId === effectiveSession.pendingToolConfirmationRequest?.id,
            ) ?? null)
          : null

      const processedEventIds = pendingEvents.map((event) => event.id)
      if (processedEventIds.length > 0) {
        await this.sessionStore.markProcessed(snapshot.session.id, processedEventIds, runningAt)
      }

      if (result.interruption?.kind === "tool_confirmation_required") {
        const confirmationRequest = result.interruption.request
        const summary = `Awaiting confirmation to run ${confirmationRequest.toolName}.`
        const toolUseEvent = {
          id: makeUuidV7(),
          type: "agent.tool_use" as const,
          createdAt: runningAt,
          processedAt: runningAt,
          wakeId,
          requestId: confirmationRequest.id,
          toolName: confirmationRequest.toolName,
          ownership: confirmationRequest.ownership,
          permissionPolicy: confirmationRequest.permissionPolicy,
          input: confirmationRequest.input,
          output: null,
        }

        await this.sessionStore.emitEvent(snapshot.session.id, toolUseEvent)
        await this.memoryStore.write({
          agentId: snapshot.session.agentId,
          sessionId: snapshot.session.id,
          updatedAt: runningAt,
          wakeId,
          lastContextEventId,
          processedEventIds,
          producedEventId: toolUseEvent.id,
          outcome: "sleep",
          summary,
          activeOutcome,
          nextWakeAt: null,
          consecutiveFollowUps: 0,
          queuedWakes: [],
          stopReason: "requires_action",
          learnings: [],
          responseMessage: `Permission required for ${confirmationRequest.toolName}.`,
          agentSetupFingerprint: currentAgentSetupFingerprint,
        })

        const updatedSession = await this.sessionStore.updateSession(
          snapshot.session.id,
          (session) => ({
            ...session,
            status: "requires_action",
            updatedAt: runningAt,
            usage: {
              turns: session.usage.turns + 1,
            },
            stopReason: "requires_action",
            pendingCustomToolRequest: null,
            pendingToolConfirmationRequest: confirmationRequest,
            metadata: {
              ...session.metadata,
              lastProvider: result.provider,
              lastModel: result.model,
              lastRunner: result.runner,
              providerSessionBindings: {
                ...(session.metadata?.providerSessionBindings ?? {}),
                ...(result.cliSessionBinding
                  ? {
                      [result.provider]: result.cliSessionBinding,
                    }
                  : {}),
              },
            },
          }),
        )

        await this.sessionStore.emitEvent(snapshot.session.id, {
          id: makeUuidV7(),
          type: "session.status_idle",
          createdAt: runningAt,
          processedAt: runningAt,
          wakeId,
          reason: "requires_action",
          summary,
          blockingEventIds: [toolUseEvent.id],
        })
        await this.emitSpanCompleted({
          sessionId: snapshot.session.id,
          wakeId,
          spanId: wakeId,
          parentSpanId: null,
          spanKind: "wake",
          name: "session_run",
          result: "blocked",
          summary,
        })
        await this.syncRuntimeStateArtifacts(snapshot.session.id)

        return {
          session: updatedSession,
          wakeId,
          response: `Permission required before running ${confirmationRequest.toolName}.`,
          stopReason: "requires_action",
          queuedWakes: [],
          processedEventIds,
        }
      }

      const { assistantResponse, directive } = resolveLoopDirective({
        rawResponse: result.response ?? "",
        createdAt: runningAt,
        defaultFollowUpSeconds: agentConfig.heartbeat?.intervalSeconds ?? 300,
        maxConsecutiveFollowUps: agentConfig.heartbeat?.maxConsecutiveFollowUps ?? 3,
        currentConsecutiveFollowUps: runtimeMemory.checkpoint?.consecutiveFollowUps ?? 0,
      })

      const agentMessageEvent = {
        id: makeUuidV7(),
        type: "agent.message" as const,
        createdAt: runningAt,
        processedAt: runningAt,
        wakeId,
        message: assistantResponse,
        summary: directive.summary,
      }
      const queuedWakes = [
        ...directive.queuedWakes,
        ...(directive.nextWakeAt
          ? [
              {
                reason: "session.follow_up",
                delaySeconds: directive.followUpSeconds ?? 0,
                note: "Continue the same bounded session thread.",
                dedupeKey: `follow-up:${snapshot.session.id}`,
                priority: "normal" as const,
                dueAt: directive.nextWakeAt,
              },
            ]
          : []),
      ]

      const customToolRequestId = directive.customToolRequest ? makeUuidV7() : null
      const customToolUseEvent =
        directive.customToolRequest && customToolRequestId
          ? {
              id: makeUuidV7(),
              type: "agent.custom_tool_use" as const,
              createdAt: runningAt,
              processedAt: runningAt,
              wakeId,
              requestId: customToolRequestId,
              toolName: directive.customToolRequest.name,
              input: directive.customToolRequest.input,
            }
          : null

      if (customToolUseEvent) {
        await this.sessionStore.emitEvent(snapshot.session.id, customToolUseEvent)
      } else {
        await this.sessionStore.emitEvent(snapshot.session.id, agentMessageEvent)
      }

      const stopReason =
        directive.customToolRequest !== null
          ? "requires_action"
          : queuedWakes.length > 0
            ? "rescheduling"
            : "idle"
      const nextStatus =
        stopReason === "requires_action"
          ? "requires_action"
          : stopReason === "rescheduling"
            ? "rescheduling"
            : "idle"
      const blockingEventIds = customToolUseEvent ? [customToolUseEvent.id] : null

      const learnings = await this.learningsStore.capture({
        agentId: snapshot.session.agentId,
        sessionId: snapshot.session.id,
        createdAt: runningAt,
        sourceEventId: pendingEvents[0]?.id ?? null,
        sourceReason: wakeContext?.reason ?? pendingEvents[0]?.type ?? "session_run",
        learnings: directive.learnings,
      })

      await this.memoryStore.write({
        agentId: snapshot.session.agentId,
        sessionId: snapshot.session.id,
        updatedAt: runningAt,
        wakeId,
        lastContextEventId,
        processedEventIds,
        producedEventId: customToolUseEvent?.id ?? agentMessageEvent.id,
        outcome: directive.outcome,
        summary: directive.summary,
        activeOutcome,
        nextWakeAt: directive.nextWakeAt,
        consecutiveFollowUps:
          directive.outcome === "continue"
            ? (runtimeMemory.checkpoint?.consecutiveFollowUps ?? 0) + 1
            : 0,
        queuedWakes,
        stopReason,
        learnings: learnings.map((record) => record.learning),
        responseMessage: assistantResponse,
        agentSetupFingerprint: currentAgentSetupFingerprint,
      })

      const updatedSession = await this.sessionStore.updateSession(
        snapshot.session.id,
        (session) => ({
          ...session,
          status: nextStatus,
          updatedAt: runningAt,
          usage: {
            turns: session.usage.turns + 1,
          },
          stopReason,
          pendingCustomToolRequest:
            directive.customToolRequest && customToolRequestId
              ? {
                  id: customToolRequestId,
                  name: directive.customToolRequest.name,
                  input: directive.customToolRequest.input,
                  requestedAt: runningAt,
                }
              : null,
          pendingToolConfirmationRequest: pendingToolConfirmationDecision
            ? null
            : session.pendingToolConfirmationRequest,
          metadata: {
            ...session.metadata,
            lastProvider: result.provider,
            lastModel: result.model,
            lastRunner: result.runner,
            providerSessionBindings: {
              ...(session.metadata?.providerSessionBindings ?? {}),
              ...(result.cliSessionBinding
                ? {
                    [result.provider]: result.cliSessionBinding,
                  }
                : {}),
            },
          },
        }),
      )

      if (nextStatus === "idle") {
        await this.sessionStore.emitEvent(snapshot.session.id, {
          id: makeUuidV7(),
          type: "session.status_idle",
          createdAt: runningAt,
          processedAt: runningAt,
          wakeId,
          reason: stopReason,
          summary: directive.summary,
          blockingEventIds,
        })
      } else {
        await this.sessionStore.emitEvent(snapshot.session.id, {
          id: makeUuidV7(),
          type: "session.status_changed",
          createdAt: runningAt,
          processedAt: runningAt,
          wakeId,
          fromStatus: "running",
          toStatus: nextStatus,
          reason: stopReason,
        })
      }
      await this.emitSpanCompleted({
        sessionId: snapshot.session.id,
        wakeId,
        spanId: wakeId,
        parentSpanId: null,
        spanKind: "wake",
        name: "session_run",
        result: "success",
        summary: directive.summary,
      })
      await this.syncRuntimeStateArtifacts(snapshot.session.id)

      return {
        session: updatedSession,
        wakeId,
        response: assistantResponse,
        stopReason,
        queuedWakes,
        processedEventIds,
      }
    } catch (error) {
      return this.handleRunFailure({
        session: effectiveSession,
        resilience: agentConfig.resilience,
        runtimeMemory,
        wakeId,
        activeOutcome,
        lastContextEventId,
        currentAgentSetupFingerprint,
        hasPendingEvents: pendingEvents.length > 0,
        wakeContext: wakeContext ?? null,
        error,
      })
    }
  }

  private async transitionToRunning(
    session: Session,
    createdAt: string,
    wakeId: string,
  ): Promise<void> {
    await this.sessionStore.updateSession(session.id, (current) => ({
      ...current,
      status: "running",
      updatedAt: createdAt,
    }))
    await this.sessionStore.emitEvent(session.id, {
      id: makeUuidV7(),
      type: "session.status_changed",
      createdAt,
      processedAt: createdAt,
      wakeId,
      fromStatus: session.status,
      toStatus: "running",
      reason: session.stopReason,
    })
  }

  private async clearInterruptedSessionState(
    session: Session,
    interruptEvent: Extract<PendingEvent, { type: "user.interrupt" }>,
  ): Promise<Session> {
    const shouldReset =
      session.status !== "idle" ||
      session.stopReason !== "idle" ||
      session.pendingCustomToolRequest !== null ||
      session.pendingToolConfirmationRequest !== null
    if (!shouldReset) {
      return session
    }

    const updatedAt = interruptEvent.createdAt
    const summary = interruptEvent.note
      ? `User interrupted prior blocked or scheduled work: ${interruptEvent.note}`
      : "User interrupted prior blocked or scheduled work."
    const updatedSession = await this.sessionStore.updateSession(session.id, (current) => ({
      ...current,
      status: "idle",
      updatedAt,
      stopReason: "idle",
      pendingCustomToolRequest: null,
      pendingToolConfirmationRequest: null,
    }))
    await this.sessionStore.emitEvent(session.id, {
      id: makeUuidV7(),
      type: "session.status_idle",
      createdAt: updatedAt,
      processedAt: updatedAt,
      wakeId: null,
      reason: "idle",
      summary,
      blockingEventIds: null,
    })
    return updatedSession
  }

  private async emitSpanStarted(input: {
    sessionId: string
    wakeId: string
    spanId: string
    parentSpanId: string | null
    spanKind: SessionSpanKind
    name: string
    summary: string | null
  }): Promise<void> {
    const createdAt = new Date().toISOString()
    await this.sessionStore.emitEvent(input.sessionId, {
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
    })
  }

  private async emitSpanCompleted(input: {
    sessionId: string
    wakeId: string
    spanId: string
    parentSpanId: string | null
    spanKind: SessionSpanKind
    name: string
    result: SessionSpanResult
    summary: string | null
  }): Promise<void> {
    const createdAt = new Date().toISOString()
    await this.sessionStore.emitEvent(input.sessionId, {
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
    })
  }

  private async syncRuntimeStateArtifacts(sessionId: string): Promise<void> {
    const snapshot = await this.sessionStore.getSession(sessionId)
    let runtimeMemory = await this.memoryStore.read(snapshot.session.agentId, sessionId)
    const activeOutcome = deriveSessionActiveOutcome({
      snapshot,
      runtimeMemory,
    })
    const outcomeGrade = gradeSessionOutcome({
      snapshot,
      runtimeMemory,
    })
    const livePersistentShell = await this.inspectLivePersistentShellState().catch(() => null)
    const outcomeEvaluation = applyLiveShellOutcomeGuard({
      evaluation: evaluateSessionOutcome({
        snapshot,
        runtimeMemory,
      }),
      liveShell: livePersistentShell,
    })
    runtimeMemory = await this.memoryStore.recordOutcomeEvaluation({
      agentId: snapshot.session.agentId,
      sessionId,
      evaluatedAt: new Date().toISOString(),
      wakeId: runtimeMemory.checkpoint?.lastWakeId ?? null,
      activeOutcome,
      gradeStatus: outcomeGrade.status,
      evaluation: outcomeEvaluation,
    })
    const sessionRelations = await this.buildSessionRelationsArtifact(snapshot.session)
    await writeSessionRuntimeStateArtifacts({
      companyDir: this.companyDir,
      snapshot,
      runtimeMemory,
      activeOutcome,
      outcomeGrade,
      outcomeEvaluation,
      outcomeEvaluationHistory: runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? [],
      sessionRelations,
    })
  }

  private async buildSessionRelationsArtifact(session: Session): Promise<{
    parentSession: {
      sessionId: string
      status: string
      stopReason: string
      lastActivityAt: string | null
      latestSummary: string | null
      activeOutcomeTitle: string | null
      outcomeGradeStatus: string
    } | null
    children: Array<{
      sessionId: string
      status: string
      stopReason: string
      lastActivityAt: string | null
      latestSummary: string | null
      activeOutcomeTitle: string | null
      outcomeGradeStatus: string
    }>
  }> {
    const sessions = await this.sessionStore.listAgentSessions(session.agentId)
    const parentSessionId = session.metadata?.parentSessionId ?? null
    const relatedIds = new Set<string>(
      [
        parentSessionId,
        ...sessions
          .filter((candidate) => candidate.metadata?.parentSessionId === session.id)
          .map((candidate) => candidate.id),
      ].filter((value): value is string => Boolean(value)),
    )
    const snapshots = await Promise.all(
      [...relatedIds].map(async (relatedSessionId) => {
        const [relatedSnapshot, relatedRuntimeMemory] = await Promise.all([
          this.sessionStore.getSession(relatedSessionId),
          this.memoryStore.read(session.agentId, relatedSessionId),
        ])
        const relatedActiveOutcome = deriveSessionActiveOutcome({
          snapshot: relatedSnapshot,
          runtimeMemory: relatedRuntimeMemory,
        })
        const relatedOutcomeGrade = gradeSessionOutcome({
          snapshot: relatedSnapshot,
          runtimeMemory: relatedRuntimeMemory,
        })
        return {
          sessionId: relatedSnapshot.session.id,
          status: relatedSnapshot.session.status,
          stopReason: relatedSnapshot.session.stopReason,
          lastActivityAt:
            relatedRuntimeMemory.checkpoint?.updatedAt ?? relatedSnapshot.session.updatedAt ?? null,
          latestSummary: relatedRuntimeMemory.checkpoint?.lastSummary ?? null,
          activeOutcomeTitle: relatedActiveOutcome?.title ?? null,
          outcomeGradeStatus: relatedOutcomeGrade.status,
        }
      }),
    )
    const parentSession = parentSessionId
      ? (snapshots.find((entry) => entry.sessionId === parentSessionId) ?? null)
      : null
    const children = snapshots
      .filter((entry) => entry.sessionId !== parentSessionId)
      .sort(
        (left, right) =>
          Date.parse(String(right.lastActivityAt ?? "1970-01-01T00:00:00.000Z")) -
          Date.parse(String(left.lastActivityAt ?? "1970-01-01T00:00:00.000Z")),
      )
    return {
      parentSession,
      children,
    }
  }

  private async handleRunFailure(input: {
    session: Session
    resilience: Awaited<ReturnType<typeof loadAgentConfig>>["resilience"]
    runtimeMemory: Awaited<ReturnType<RuntimeMemoryStore["read"]>>
    wakeId: string
    activeOutcome: SessionOutcomeDefinition | null
    lastContextEventId: string | null
    currentAgentSetupFingerprint: string | null
    hasPendingEvents: boolean
    wakeContext: HarnessWakeContext | null
    error: unknown
  }): Promise<HarnessRunResult> {
    const failedAt = new Date().toISOString()
    const errorMessage = input.error instanceof Error ? input.error.message : String(input.error)
    const retryable = isRetryableProviderError(input.error)
    const recoverableWakeRetryDelayMs = input.resilience.retry.recoverableWakeRetryDelayMs
    const retryAt = retryable
      ? new Date(Date.parse(failedAt) + recoverableWakeRetryDelayMs).toISOString()
      : null
    const queuedRetryWakes =
      retryable && !input.hasPendingEvents && input.wakeContext && retryAt
        ? [
            buildRecoverableRetryWake(
              input.session.id,
              input.wakeContext,
              retryAt,
              errorMessage,
              recoverableWakeRetryDelayMs,
            ),
          ]
        : []
    const shouldReschedule = retryable && (input.hasPendingEvents || queuedRetryWakes.length > 0)
    const stopReason = shouldReschedule ? "rescheduling" : "idle"
    const status = shouldReschedule ? "rescheduling" : "idle"
    const summary = shouldReschedule
      ? `Wake deferred after transient provider failure: ${errorMessage}`
      : `Wake failed: ${errorMessage}`

    if (retryable && retryAt && input.hasPendingEvents) {
      await this.sessionStore.deferRunnableSession(input.session.id, retryAt)
    }

    await this.memoryStore.write({
      agentId: input.session.agentId,
      sessionId: input.session.id,
      updatedAt: failedAt,
      wakeId: input.wakeId,
      lastContextEventId: input.lastContextEventId,
      processedEventIds: [],
      producedEventId: null,
      outcome: shouldReschedule ? "continue" : "sleep",
      summary,
      activeOutcome: input.activeOutcome,
      nextWakeAt: retryAt,
      consecutiveFollowUps: 0,
      queuedWakes: queuedRetryWakes,
      stopReason,
      learnings: [],
      responseMessage: null,
      agentSetupFingerprint: input.currentAgentSetupFingerprint,
    })

    const updatedSession = await this.sessionStore.updateSession(input.session.id, (session) => ({
      ...session,
      status,
      updatedAt: failedAt,
      stopReason,
    }))

    if (status === "idle") {
      await this.sessionStore.emitEvent(input.session.id, {
        id: makeUuidV7(),
        type: "session.status_idle",
        createdAt: failedAt,
        processedAt: failedAt,
        wakeId: input.wakeId,
        reason: "idle",
        summary,
        blockingEventIds: null,
      })
    } else {
      await this.sessionStore.emitEvent(input.session.id, {
        id: makeUuidV7(),
        type: "session.status_changed",
        createdAt: failedAt,
        processedAt: failedAt,
        wakeId: input.wakeId,
        fromStatus: "running",
        toStatus: "rescheduling",
        reason: "rescheduling",
      })
    }
    await this.emitSpanCompleted({
      sessionId: input.session.id,
      wakeId: input.wakeId,
      spanId: input.wakeId,
      parentSpanId: null,
      spanKind: "wake",
      name: "session_run",
      result: "error",
      summary,
    })
    await this.syncRuntimeStateArtifacts(input.session.id)

    return {
      session: updatedSession,
      wakeId: input.wakeId,
      response: summary,
      stopReason,
      queuedWakes: queuedRetryWakes,
      processedEventIds: [],
    }
  }

  private async buildSystemPrompt(
    session: Session,
    environment: { id: string; name: string },
  ): Promise<PromptBuildResult> {
    const agentConfig = await loadAgentConfig(this.companyDir, session.agentId)
    const [bootstrapPrompt, runtimeEnvironmentPrompt] = await Promise.all([
      buildBootstrapSystemPrompt(this.companyDir, session.agentId),
      buildRuntimeEnvironmentPrompt({
        companyDir: this.companyDir,
        provider: agentConfig.runtime.provider,
        model: agentConfig.model.id,
        tools: agentConfig.tools,
        sandbox: agentConfig.sandbox,
        skills: agentConfig.skills,
        resources: session.resources,
        environmentId: environment.id,
        environmentName: environment.name,
      }),
    ])
    const harnessAppendix = buildHarnessSystemPromptAppendix()
    const systemPrompt = [bootstrapPrompt, runtimeEnvironmentPrompt, harnessAppendix]
      .filter((part) => part.trim().length > 0)
      .join("\n\n")
    return {
      bootstrapPrompt,
      runtimeEnvironmentPrompt,
      harnessAppendix,
      systemPrompt,
    }
  }

  private async buildAutomaticRecallHistory(input: {
    session: Session
    pendingEvents: PendingEvent[]
    runtimeMemory: Awaited<ReturnType<RuntimeMemoryStore["read"]>>
    skillsConfig: Awaited<ReturnType<typeof loadAgentConfig>>["skills"]
    activeOutcome: SessionOutcomeDefinition | null
    outcomeGrade: ReturnType<typeof gradeSessionOutcome>
    outcomeEvaluation: SessionOutcomeEvaluation
    livePersistentShell: {
      shellId: string
      status: "active" | "closed"
      commandCount: number
      busy: boolean
      currentCommand: string | null
      currentCommandStartedAt: string | null
      currentStdoutPreview: string | null
      currentStderrPreview: string | null
    } | null
    currentAgentSetupFingerprint: string | null
  }) {
    const latestPendingEvent = input.pendingEvents.at(-1) ?? null
    const latestUserMessage = [...input.pendingEvents]
      .reverse()
      .find(
        (event): event is Extract<PendingEvent, { type: "user.message" }> =>
          event.type === "user.message",
      )
    const latestDefinedOutcome = [...input.pendingEvents]
      .reverse()
      .find(
        (event): event is Extract<PendingEvent, { type: "user.define_outcome" }> =>
          event.type === "user.define_outcome",
      )
    const openLoopCue = formatOpenLoopCue({
      session: input.session,
      pendingEvents: input.pendingEvents,
    })
    const blockedToolCue = input.session.pendingToolConfirmationRequest
      ? `blocked confirmation tool ${input.session.pendingToolConfirmationRequest.toolName}`
      : input.session.pendingCustomToolRequest
        ? `blocked custom tool ${input.session.pendingCustomToolRequest.name}`
        : null
    const outcomeGradeCue = [
      `outcome grade ${input.outcomeGrade.status}`,
      input.outcomeGrade.summary,
      input.outcomeGrade.nextSuggestedTool?.tool
        ? `next tool ${input.outcomeGrade.nextSuggestedTool.tool}`
        : null,
    ]
      .filter((part): part is string => Boolean(part && part.trim().length > 0))
      .join("\n")
    const outcomeEvaluationCue = [
      `outcome evaluation ${input.outcomeEvaluation.status}`,
      `promotion ready ${String(input.outcomeEvaluation.promotionReady)}`,
      input.outcomeEvaluation.summary,
      input.outcomeEvaluation.nextSuggestedTool?.tool
        ? `next tool ${input.outcomeEvaluation.nextSuggestedTool.tool}`
        : null,
    ]
      .filter((part): part is string => Boolean(part && part.trim().length > 0))
      .join("\n")
    const query = composeRetrievalQueryParts(
      [
        latestUserMessage?.message ?? null,
        latestDefinedOutcome
          ? [
              latestDefinedOutcome.outcome.title,
              latestDefinedOutcome.outcome.detail,
              ...latestDefinedOutcome.outcome.successCriteria,
            ]
              .filter((part): part is string => Boolean(part && part.trim().length > 0))
              .join("\n")
          : null,
        openLoopCue,
        blockedToolCue,
        outcomeGradeCue,
        outcomeEvaluationCue,
        input.runtimeMemory.checkpoint?.lastSummary ?? null,
        input.runtimeMemory.checkpoint?.responseMessage ?? null,
        input.runtimeMemory.workingBuffer ?? null,
        input.runtimeMemory.sessionState ?? null,
        input.runtimeMemory.checkpoint?.activeOutcome
          ? [
              input.runtimeMemory.checkpoint.activeOutcome.title,
              input.runtimeMemory.checkpoint.activeOutcome.detail,
              ...input.runtimeMemory.checkpoint.activeOutcome.successCriteria,
            ]
              .filter((part): part is string => Boolean(part && part.trim().length > 0))
              .join("\n")
          : null,
      ],
      { maxParts: 6, maxCharsPerPart: 240 },
    )
    const baseTimestamp = latestPendingEvent?.createdAt ?? input.session.updatedAt
    const outcomeRepairHint = formatOutcomeRepairHint({
      activeOutcome: input.activeOutcome,
      outcomeGrade: input.outcomeGrade,
    })
    const promotionGateHint = formatPromotionGateHint({
      activeOutcome: input.activeOutcome,
      outcomeEvaluation: input.outcomeEvaluation,
    })
    const outcomeTrendHint = formatOutcomeTrendHint({
      activeOutcome: input.activeOutcome,
      outcomeEvaluation: input.outcomeEvaluation,
    })
    const outcomeRepairNotes = outcomeRepairHint
      ? [
          {
            role: "assistant" as const,
            kind: "runtime_note" as const,
            message: outcomeRepairHint,
            timestamp: new Date(Date.parse(baseTimestamp) + 1).toISOString(),
          },
        ]
      : []
    const promotionGateNotes = promotionGateHint
      ? [
          {
            role: "assistant" as const,
            kind: "runtime_note" as const,
            message: promotionGateHint,
            timestamp: new Date(
              Date.parse(baseTimestamp) + outcomeRepairNotes.length + 1,
            ).toISOString(),
          },
        ]
      : []
    const outcomeTrendNotes = outcomeTrendHint
      ? [
          {
            role: "assistant" as const,
            kind: "runtime_note" as const,
            message: outcomeTrendHint,
            timestamp: new Date(
              Date.parse(baseTimestamp) + outcomeRepairNotes.length + promotionGateNotes.length + 1,
            ).toISOString(),
          },
        ]
      : []
    const setupDriftHint = formatSetupDriftHint({
      previousFingerprint: input.runtimeMemory.checkpoint?.lastAgentSetupFingerprint ?? null,
      currentFingerprint: input.currentAgentSetupFingerprint,
    })
    const setupDriftNotes = setupDriftHint
      ? [
          {
            role: "assistant" as const,
            kind: "runtime_note" as const,
            message: setupDriftHint,
            timestamp: new Date(
              Date.parse(baseTimestamp) +
                outcomeRepairNotes.length +
                promotionGateNotes.length +
                outcomeTrendNotes.length +
                1,
            ).toISOString(),
          },
        ]
      : []
    const shellBusyHint = formatShellBusyHint({
      shell: input.livePersistentShell,
    })
    const shellBusyNotes = shellBusyHint
      ? [
          {
            role: "assistant" as const,
            kind: "runtime_note" as const,
            message: shellBusyHint,
            timestamp: new Date(
              Date.parse(baseTimestamp) +
                outcomeRepairNotes.length +
                promotionGateNotes.length +
                outcomeTrendNotes.length +
                setupDriftNotes.length +
                1,
            ).toISOString(),
          },
        ]
      : []
    const readFirstHint = formatReadFirstHint({
      latestUserMessage: latestUserMessage?.message ?? null,
      runtimeMemory: input.runtimeMemory,
      livePersistentShell: input.livePersistentShell,
      pendingCustomToolRequest: input.session.pendingCustomToolRequest,
      pendingToolConfirmationRequest: input.session.pendingToolConfirmationRequest,
    })
    const readFirstNotes = readFirstHint
      ? [
          {
            role: "assistant" as const,
            kind: "runtime_note" as const,
            message: readFirstHint,
            timestamp: new Date(
              Date.parse(baseTimestamp) +
                outcomeRepairNotes.length +
                promotionGateNotes.length +
                outcomeTrendNotes.length +
                setupDriftNotes.length +
                shellBusyNotes.length +
                1,
            ).toISOString(),
          },
        ]
      : []

    if (!query) {
      return [
        ...outcomeRepairNotes,
        ...promotionGateNotes,
        ...outcomeTrendNotes,
        ...setupDriftNotes,
        ...shellBusyNotes,
        ...readFirstNotes,
      ]
    }

    const [result, skillEntries] = await Promise.all([
      searchCrossSessionRecall({
        session: input.session,
        sessionStore: this.sessionStore,
        memoryStore: this.memoryStore,
        learningsStore: this.learningsStore,
        currentAgentSetupFingerprint: input.currentAgentSetupFingerprint,
        currentActiveOutcome: input.activeOutcome,
        query,
        limit: MAX_AUTOMATIC_RECALL_HINTS,
        includeCurrent: false,
        backends: ["memory", "session_context", "session_trace"],
      }),
      loadCompanySkillEntries(this.companyDir, input.skillsConfig).catch(() => []),
    ])
    const skillHits = searchSkillEntries(skillEntries, query, MAX_AUTOMATIC_SKILL_HINTS)
    const skillNotes = skillHits.map((hit, index) => ({
      role: "assistant" as const,
      kind: "runtime_note" as const,
      message: [
        "[skill-candidate]",
        `name=${hit.name}`,
        `score=${String(hit.score)}`,
        `reasons=${hit.reasons.join(",")}`,
        `description=${hit.description}`,
        ...(hit.preview ? [`preview=${hit.preview}`] : []),
        "nextTool=skills_read",
        `nextArgs=${JSON.stringify({ name: hit.name })}`,
      ].join(" "),
      timestamp: `${new Date(
        Date.parse(baseTimestamp) +
          outcomeRepairNotes.length +
          promotionGateNotes.length +
          outcomeTrendNotes.length +
          setupDriftNotes.length +
          shellBusyNotes.length +
          readFirstNotes.length +
          index +
          1,
      ).toISOString()}`,
    }))

    const fallbackSessionNotes =
      result.hits.length === 0
        ? await this.buildRecentSessionCandidateNotes({
            session: input.session,
            baseTimestamp: new Date(
              Date.parse(baseTimestamp) +
                outcomeRepairNotes.length +
                promotionGateNotes.length +
                outcomeTrendNotes.length +
                setupDriftNotes.length +
                shellBusyNotes.length +
                readFirstNotes.length +
                skillNotes.length,
            ).toISOString(),
            currentAgentSetupFingerprint: input.currentAgentSetupFingerprint,
          })
        : []

    const retrievalBaseOffset =
      outcomeRepairNotes.length +
      promotionGateNotes.length +
      outcomeTrendNotes.length +
      setupDriftNotes.length +
      shellBusyNotes.length +
      readFirstNotes.length +
      skillNotes.length +
      fallbackSessionNotes.length
    const presentation = presentRetrievalSearchResult(result, {
      currentOutcomeEvaluation: input.outcomeEvaluation,
    })
    const planHint = formatRetrievalPlanHint(presentation)

    const notes = [
      ...outcomeRepairNotes,
      ...promotionGateNotes,
      ...outcomeTrendNotes,
      ...setupDriftNotes,
      ...shellBusyNotes,
      ...readFirstNotes,
      ...skillNotes,
      ...fallbackSessionNotes,
      ...(planHint
        ? [
            {
              role: "assistant" as const,
              kind: "runtime_note" as const,
              message: planHint,
              timestamp: `${new Date(Date.parse(baseTimestamp) + retrievalBaseOffset + 1).toISOString()}`,
            },
          ]
        : []),
      ...result.hits.map((hit, index) => ({
        role: "assistant" as const,
        kind: "runtime_note" as const,
        message: formatRetrievalCandidateHint(hit),
        timestamp: `${new Date(Date.parse(baseTimestamp) + retrievalBaseOffset + index + 2).toISOString()}`,
      })),
    ]

    return notes
  }

  private async buildRecentSessionCandidateNotes(input: {
    session: Session
    baseTimestamp: string
    currentAgentSetupFingerprint: string | null
  }) {
    const sessions = await this.sessionStore.listAgentSessions(input.session.agentId)
    const candidates = await Promise.all(
      sessions
        .filter((session) => session.id !== input.session.id)
        .map(async (session) => {
          const runtimeMemory = await this.memoryStore.read(input.session.agentId, session.id)
          const latestSummary = runtimeMemory.checkpoint?.lastSummary ?? null
          const lastActivityAt = runtimeMemory.checkpoint?.updatedAt ?? session.updatedAt
          const snapshot = await this.sessionStore.getSession(session.id)
          const outcomeEvaluation = evaluateSessionOutcome({
            snapshot,
            runtimeMemory,
          })
          return {
            sessionId: session.id,
            status: session.status,
            lastActivityAt,
            latestSummary,
            requiresAction:
              session.stopReason === "requires_action" ||
              session.pendingToolConfirmationRequest !== null ||
              session.pendingCustomToolRequest !== null,
            pendingActionKind:
              session.pendingToolConfirmationRequest !== null
                ? ("tool_confirmation" as const)
                : session.pendingCustomToolRequest !== null
                  ? ("custom_tool" as const)
                  : null,
            pendingActionToolName:
              session.pendingToolConfirmationRequest?.toolName ??
              session.pendingCustomToolRequest?.name ??
              null,
            outcomeEvaluation,
            setupFingerprint: runtimeMemory.checkpoint?.lastAgentSetupFingerprint ?? null,
          }
        }),
    )

    return candidates
      .filter((candidate) => candidate.latestSummary && candidate.latestSummary.trim().length > 0)
      .sort(
        (left, right) =>
          Number(
            Boolean(
              input.currentAgentSetupFingerprint !== null &&
                right.setupFingerprint === input.currentAgentSetupFingerprint,
            ),
          ) -
            Number(
              Boolean(
                input.currentAgentSetupFingerprint !== null &&
                  left.setupFingerprint === input.currentAgentSetupFingerprint,
              ),
            ) ||
          Number(Boolean(right.requiresAction)) - Number(Boolean(left.requiresAction)) ||
          outcomeTrendPriority(right.outcomeEvaluation.trend) -
            outcomeTrendPriority(left.outcomeEvaluation.trend) ||
          Date.parse(right.lastActivityAt ?? "1970-01-01T00:00:00.000Z") -
            Date.parse(left.lastActivityAt ?? "1970-01-01T00:00:00.000Z"),
      )
      .slice(0, MAX_AUTOMATIC_SESSION_CANDIDATES)
      .map((candidate, index) => {
        const requiresOutcomeHistory =
          candidate.outcomeEvaluation.promotionReady === false &&
          (candidate.outcomeEvaluation.trend === "stable" ||
            candidate.outcomeEvaluation.trend === "regressing")
        return {
          role: "assistant" as const,
          kind: "runtime_note" as const,
          message: [
            "[session-candidate]",
            `session=${candidate.sessionId}`,
            `status=${candidate.status}`,
            `lastActivityAt=${candidate.lastActivityAt}`,
            `setupMatch=${String(
              input.currentAgentSetupFingerprint !== null &&
                candidate.setupFingerprint === input.currentAgentSetupFingerprint,
            )}`,
            `requiresAction=${String(candidate.requiresAction)}`,
            ...(candidate.pendingActionKind
              ? [`pendingActionKind=${candidate.pendingActionKind}`]
              : []),
            ...(candidate.pendingActionToolName
              ? [`pendingActionTool=${candidate.pendingActionToolName}`]
              : []),
            `outcomeStatus=${candidate.outcomeEvaluation.status}`,
            `promotionReady=${String(candidate.outcomeEvaluation.promotionReady)}`,
            `outcomeTrend=${candidate.outcomeEvaluation.trend}`,
            `summary=${candidate.latestSummary}`,
            "nextTool=session_get_snapshot",
            `nextArgs=${JSON.stringify({ sessionId: candidate.sessionId })}`,
            "nextWhy=Inspect the prior same-agent session snapshot and evaluator verdict before rereading detailed events.",
            ...(requiresOutcomeHistory
              ? [
                  "nextAfterSnapshotTool=outcome_history",
                  `nextAfterSnapshotArgs=${JSON.stringify({ sessionId: candidate.sessionId })}`,
                ]
              : []),
          ].join(" "),
          timestamp: `${new Date(Date.parse(input.baseTimestamp) + index + 1).toISOString()}`,
        }
      })
  }
}

function buildRecoverableRetryWake(
  sessionId: string,
  wakeContext: HarnessWakeContext,
  dueAt: string,
  errorMessage: string,
  recoverableWakeRetryDelayMs: number,
): HarnessRunResult["queuedWakes"][number] {
  const retryNotePrefix = wakeContext.note
    ? `${wakeContext.note} | retry after transient provider failure`
    : "retry after transient provider failure"
  return {
    reason: wakeContext.reason,
    delaySeconds: Math.floor(recoverableWakeRetryDelayMs / 1000),
    dueAt,
    note: `${retryNotePrefix}: ${errorMessage}`,
    dedupeKey: `retry:${sessionId}:${wakeContext.reason}`,
    priority: "normal",
  }
}
