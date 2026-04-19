import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { makeUuidV7 } from "../../foundation/ids.js"
import { nowIsoString } from "../../foundation/time.js"
import { CodexAuthProvider } from "../auth/codex-auth.js"
import type {
  AgentMessageEvent,
  AgentToolUseEvent,
  Session,
  SessionEvent,
  SessionOutcomeDefinition,
} from "../schema/runtime.js"
import { SessionStore } from "../sessions/session-store.js"
import { ensureAgentConfig, ensureOpenboaSetup } from "../setup.js"
import { AgentOrchestration } from "./orchestration.js"
import { SessionWakeQueue } from "./session-wake-queue.js"

const DEFAULT_OUTPUT_PATH = "AGENT_SCENARIO_LOOP.md"
const WATCH_POLL_INTERVAL_MS = 100
const WATCH_IDLE_TIMEOUT_MS = 1500
const FULL_SCENARIO_COUNT = 100
const CURATED_SCENARIO_COUNT = 30
const DEFAULT_SCENARIO_SUITE = "curated"
const MAX_APPROVAL_LOOPS = 3

type ScenarioStatus = "pass" | "fail"
type ScenarioMode = "wake" | "watch"
export type ScenarioSuite = "curated" | "full"
type ScenarioDefinitionSuite = Exclude<ScenarioSuite, "full">
type ScenarioCoverageTag =
  | "bootstrap_quote_agents"
  | "bootstrap_quote_identity"
  | "bootstrap_quote_bootstrap"
  | "bootstrap_quote_memory"
  | "introspection_agent_name"
  | "introspection_session_id"
  | "introspection_workspace_mount"
  | "introspection_substrate_mount"
  | "introspection_runtime_mount"
  | "tool_environment_describe"
  | "tool_session_get_snapshot"
  | "tool_session_search_traces"
  | "tool_resources_list"
  | "tool_permissions_describe"
  | "tool_learning_list"
  | "tool_memory_search"
  | "tool_retrieval_search"
  | "tool_outcome_define"
  | "tool_outcome_evaluate"
  | "continuity_recall"
  | "watch_ingress"
  | "scratch_write_allow"
  | "scratch_write_deny"
  | "promotion_soul"
  | "promotion_identity"
  | "readback_soul"
  | "readback_identity"
  | "custom_tool_roundtrip"
  | "delayed_wake"

interface ScenarioResult {
  number: number
  id: string
  category: string
  title: string
  mode: ScenarioMode
  sessionId: string
  startedAt: string
  finishedAt: string
  status: ScenarioStatus
  stopReason: string
  prompts: string[]
  responsePreview: string | null
  toolNames: string[]
  consumedInputs: string[]
  approvalRequests: string[]
  notes: string[]
  issue: string | null
}

interface ScenarioDefinition {
  number: number
  id: string
  category: string
  title: string
  suites?: readonly ScenarioDefinitionSuite[]
  coverage?: readonly ScenarioCoverageTag[]
  run(ctx: ScenarioContext): Promise<ScenarioResult>
}

class ScenarioExecutionError extends Error {
  constructor(
    message: string,
    readonly partial: Partial<ScenarioResult>,
  ) {
    super(message)
    this.name = "ScenarioExecutionError"
  }
}

interface ScenarioRunOptions {
  agentId?: string
  outputPath?: string
  count?: number
  suite?: ScenarioSuite
  modelTimeoutMs?: number
}

interface WakeRunSummary {
  stopReason: string
  responseMessage: string | null
  responsePreview: string | null
  toolNames: string[]
  consumedInputs: string[]
  approvalRequests: string[]
  events: SessionEvent[]
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
}

class ScenarioContext {
  readonly outputPath: string
  readonly store: SessionStore
  readonly orchestration: AgentOrchestration
  readonly wakeQueue: SessionWakeQueue

  constructor(
    readonly companyDir: string,
    readonly agentId: string,
    outputPath: string,
    readonly suite: ScenarioSuite,
  ) {
    this.outputPath = resolve(companyDir, outputPath)
    this.store = new SessionStore(companyDir)
    this.orchestration = new AgentOrchestration(companyDir)
    this.wakeQueue = new SessionWakeQueue(companyDir, this.store)
  }

  async createSession(): Promise<Session> {
    return this.store.createSession({ agentId: this.agentId })
  }

  async emitUserMessage(sessionId: string, message: string): Promise<void> {
    await this.store.emitEvent(sessionId, {
      id: makeUuidV7(),
      type: "user.message",
      createdAt: nowIsoString(),
      processedAt: null,
      message,
    })
  }

  async emitOutcome(sessionId: string, outcome: SessionOutcomeDefinition): Promise<void> {
    await this.store.emitEvent(sessionId, {
      id: makeUuidV7(),
      type: "user.define_outcome",
      createdAt: nowIsoString(),
      processedAt: null,
      outcome,
    })
  }

  async emitToolConfirmation(sessionId: string, allowed: boolean, note?: string): Promise<string> {
    const snapshot = await this.store.getSession(sessionId)
    const request = snapshot.session.pendingToolConfirmationRequest
    if (!request) {
      throw new Error(`Scenario ${sessionId} expected a pending tool confirmation request`)
    }
    await this.store.emitEvent(sessionId, {
      id: makeUuidV7(),
      type: "user.tool_confirmation",
      createdAt: nowIsoString(),
      processedAt: null,
      requestId: request.id,
      toolName: request.toolName,
      allowed,
      note: note?.trim() ? note.trim() : null,
    })
    return request.id
  }

  async emitCustomToolResult(
    sessionId: string,
    output: string,
    requestId?: string,
  ): Promise<string> {
    const snapshot = await this.store.getSession(sessionId)
    const request = snapshot.session.pendingCustomToolRequest
    if (!request) {
      throw new Error(`Scenario ${sessionId} expected a pending custom tool request`)
    }
    if (requestId && request.id !== requestId) {
      throw new Error(
        `Scenario ${sessionId} expected custom tool request ${request.id} but received ${requestId}`,
      )
    }
    await this.store.emitEvent(sessionId, {
      id: makeUuidV7(),
      type: "user.custom_tool_result",
      createdAt: nowIsoString(),
      processedAt: null,
      requestId: request.id,
      toolName: request.name,
      output,
    })
    return request.id
  }

  async enqueueDelayedWake(input: {
    sessionId: string
    delayMs: number
    reason: string
    note?: string
    dedupeKey?: string
    priority?: "low" | "normal" | "high"
  }): Promise<void> {
    const dueAt = new Date(Date.now() + input.delayMs).toISOString()
    await this.wakeQueue.enqueue({
      sessionId: input.sessionId,
      dueAt,
      reason: input.reason,
      note: input.note?.trim() ? input.note.trim() : null,
      dedupeKey: input.dedupeKey?.trim() ? input.dedupeKey.trim() : null,
      priority: input.priority ?? "normal",
    })
  }

  async wakeSession(sessionId: string): Promise<WakeRunSummary> {
    const result = await this.orchestration.wake(sessionId)
    const snapshot = await this.store.getSession(sessionId)
    const wakeEvents = result.wakeEvents.length > 0 ? result.wakeEvents : snapshot.events
    const responseMessage =
      latestAgentMessage(wakeEvents)?.message ??
      result.response ??
      latestAgentMessage(snapshot.events)?.message ??
      null
    return {
      stopReason: snapshot.session.stopReason,
      responseMessage,
      responsePreview: result.responsePreview ?? compactPreview(responseMessage),
      toolNames: collectToolNames(wakeEvents),
      consumedInputs: result.consumedInputs,
      approvalRequests: collectApprovalRequests(wakeEvents),
      events: wakeEvents,
    }
  }

  async runWatchScenario(sessionId: string, trigger: () => Promise<void>): Promise<WakeRunSummary> {
    let consumedInputs: string[] = []
    let responseMessage: string | null = null
    let responsePreview: string | null = null
    let toolNames: string[] = []
    let approvalRequests: string[] = []
    let wakeEvents: SessionEvent[] = []
    const loopPromise = this.orchestration.runAgentLoop(this.agentId, {
      watch: true,
      pollIntervalMs: WATCH_POLL_INTERVAL_MS,
      idleTimeoutMs: WATCH_IDLE_TIMEOUT_MS,
      allowedSessionIds: [sessionId],
      onActivity: async (activity) => {
        if (activity.sessionId === sessionId) {
          consumedInputs = [...activity.consumedInputs]
          responseMessage = latestAgentMessage(activity.wakeEvents)?.message ?? responseMessage
          responsePreview = activity.responsePreview ?? compactPreview(responseMessage)
          toolNames = collectToolNames(activity.wakeEvents)
          approvalRequests = collectApprovalRequests(activity.wakeEvents)
          wakeEvents = [...activity.wakeEvents]
        }
      },
    })
    await sleep(150)
    await trigger()
    await loopPromise
    const snapshot = await this.store.getSession(sessionId)
    const effectiveEvents = wakeEvents.length > 0 ? wakeEvents : snapshot.events
    const effectiveResponseMessage =
      responseMessage ??
      latestAgentMessage(effectiveEvents)?.message ??
      latestAgentMessage(snapshot.events)?.message ??
      null
    return {
      stopReason: snapshot.session.stopReason,
      responseMessage: effectiveResponseMessage,
      responsePreview: responsePreview ?? compactPreview(effectiveResponseMessage),
      toolNames: toolNames.length > 0 ? toolNames : collectToolNames(effectiveEvents),
      consumedInputs,
      approvalRequests:
        approvalRequests.length > 0 ? approvalRequests : collectApprovalRequests(effectiveEvents),
      events: effectiveEvents,
    }
  }

  async readAgentWorkspaceFile(relativePath: string): Promise<string> {
    return readFile(
      join(this.companyDir, ".openboa", "agents", this.agentId, "workspace", relativePath),
      "utf8",
    )
  }

  async readSessionWorkspaceFile(sessionId: string, relativePath: string): Promise<string> {
    return readFile(
      join(
        this.companyDir,
        ".openboa",
        "agents",
        this.agentId,
        "sessions",
        sessionId,
        "workspace",
        relativePath,
      ),
      "utf8",
    )
  }
}

const CURATED_SCENARIO_SUITES = ["curated"] as const satisfies readonly ScenarioDefinitionSuite[]
const CURATED_REQUIRED_COVERAGE = [
  "bootstrap_quote_agents",
  "bootstrap_quote_identity",
  "bootstrap_quote_bootstrap",
  "bootstrap_quote_memory",
  "introspection_agent_name",
  "introspection_session_id",
  "introspection_workspace_mount",
  "introspection_substrate_mount",
  "introspection_runtime_mount",
  "tool_environment_describe",
  "tool_session_get_snapshot",
  "tool_session_search_traces",
  "tool_resources_list",
  "tool_permissions_describe",
  "tool_learning_list",
  "tool_memory_search",
  "tool_retrieval_search",
  "tool_outcome_define",
  "tool_outcome_evaluate",
  "continuity_recall",
  "watch_ingress",
  "scratch_write_allow",
  "scratch_write_deny",
  "promotion_soul",
  "promotion_identity",
  "readback_soul",
  "readback_identity",
  "custom_tool_roundtrip",
  "delayed_wake",
] as const satisfies readonly ScenarioCoverageTag[]

function curatedScenario(
  ...coverage: ScenarioCoverageTag[]
): Pick<ScenarioDefinition, "suites" | "coverage"> {
  return {
    suites: CURATED_SCENARIO_SUITES,
    coverage,
  }
}

function normalizeScenarioSuite(value: ScenarioSuite | string | undefined): ScenarioSuite {
  if (!value?.trim()) {
    return DEFAULT_SCENARIO_SUITE
  }
  if (value === "curated" || value === "full") {
    return value
  }
  throw new Error(`invalid scenario suite: ${value}`)
}

function selectScenarioSuite(
  definitions: ScenarioDefinition[],
  suite: ScenarioSuite,
): ScenarioDefinition[] {
  if (suite === "full") {
    return definitions
  }
  const selected = definitions.filter((definition) => definition.suites?.includes(suite) === true)
  assertCondition(
    selected.length === CURATED_SCENARIO_COUNT,
    `Expected curated suite to contain exactly ${String(CURATED_SCENARIO_COUNT)} scenarios, selected ${String(selected.length)}`,
  )
  for (const coverage of CURATED_REQUIRED_COVERAGE) {
    assertCondition(
      selected.some((definition) => definition.coverage?.includes(coverage) === true),
      `Curated suite is missing required coverage ${coverage}`,
    )
  }
  return selected
}

function compactPreview(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? ""
  if (!normalized) {
    return null
  }
  if (normalized.length <= 240) {
    return normalized
  }
  return `${normalized.slice(0, 239).trimEnd()}…`
}

function latestAgentMessage(events: SessionEvent[]): AgentMessageEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === "agent.message") {
      return event
    }
  }
  return null
}

function collectToolNames(events: SessionEvent[]): string[] {
  const names = new Set<string>()
  for (const event of events) {
    if (event.type === "agent.tool_use") {
      names.add((event as AgentToolUseEvent).toolName)
    }
    if (event.type === "agent.custom_tool_use") {
      names.add(`custom:${event.toolName}`)
    }
  }
  return [...names]
}

function collectApprovalRequests(events: SessionEvent[]): string[] {
  const approvals = new Set<string>()
  for (const event of events) {
    if (event.type === "agent.tool_use" && event.requestId) {
      approvals.add(`${event.toolName}:${event.requestId}`)
    }
    if (event.type === "user.tool_confirmation") {
      approvals.add(`${event.toolName}:${event.requestId}`)
    }
  }
  return [...approvals]
}

function _countAgentMessages(events: SessionEvent[]): number {
  return events.filter((event) => event.type === "agent.message").length
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function extractQuotedLines(source: string, limit = 4): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && !line.startsWith("---"))
    .slice(0, limit)
}

function countExactLineMatches(response: string, source: string): string[] {
  const matches: string[] = []
  for (const line of extractQuotedLines(source, 6)) {
    if (response.includes(line)) {
      matches.push(line)
    }
  }
  return matches
}

function scenarioId(prefix: string, number: number): string {
  return `${prefix}_${String(number).padStart(3, "0")}`
}

async function runScenario(
  definition: ScenarioDefinition,
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const startedAt = nowIsoString()
  try {
    const result = await definition.run(ctx)
    await writeScenarioReport(
      ctx.outputPath,
      ctx.agentId,
      [...(await readScenarioResults(ctx.outputPath)), result],
      ctx.suite,
    )
    return result
  } catch (error) {
    const failure: ScenarioResult = {
      number: definition.number,
      id: definition.id,
      category: definition.category,
      title: definition.title,
      mode:
        error instanceof ScenarioExecutionError && error.partial.mode ? error.partial.mode : "wake",
      sessionId:
        error instanceof ScenarioExecutionError && error.partial.sessionId
          ? error.partial.sessionId
          : "n/a",
      startedAt:
        error instanceof ScenarioExecutionError && error.partial.startedAt
          ? error.partial.startedAt
          : startedAt,
      finishedAt: nowIsoString(),
      status: "fail",
      stopReason:
        error instanceof ScenarioExecutionError && error.partial.stopReason
          ? error.partial.stopReason
          : "error",
      prompts:
        error instanceof ScenarioExecutionError && error.partial.prompts
          ? error.partial.prompts
          : [],
      responsePreview:
        error instanceof ScenarioExecutionError && error.partial.responsePreview !== undefined
          ? (error.partial.responsePreview ?? null)
          : null,
      toolNames:
        error instanceof ScenarioExecutionError && error.partial.toolNames
          ? error.partial.toolNames
          : [],
      consumedInputs:
        error instanceof ScenarioExecutionError && error.partial.consumedInputs
          ? error.partial.consumedInputs
          : [],
      approvalRequests:
        error instanceof ScenarioExecutionError && error.partial.approvalRequests
          ? error.partial.approvalRequests
          : [],
      notes:
        error instanceof ScenarioExecutionError && error.partial.notes ? error.partial.notes : [],
      issue: error instanceof Error ? error.message : String(error),
    }
    await writeScenarioReport(
      ctx.outputPath,
      ctx.agentId,
      [...(await readScenarioResults(ctx.outputPath)), failure],
      ctx.suite,
    )
    return failure
  }
}

async function readScenarioResults(outputPath: string): Promise<ScenarioResult[]> {
  try {
    const raw = await readFile(`${outputPath}.json`, "utf8")
    return JSON.parse(raw) as ScenarioResult[]
  } catch {
    return []
  }
}

async function writeScenarioReport(
  outputPath: string,
  agentId: string,
  results: ScenarioResult[],
  suite: ScenarioSuite,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(`${outputPath}.json`, `${JSON.stringify(results, null, 2)}\n`, "utf8")
  await writeFile(outputPath, renderScenarioMarkdown(agentId, results, suite), "utf8")
}

function renderScenarioMarkdown(
  agentId: string,
  results: ScenarioResult[],
  suite: ScenarioSuite,
): string {
  const passed = results.filter((result) => result.status === "pass").length
  const failed = results.length - passed
  const lines = [
    "# Agent Scenario Loop",
    "",
    `- Agent: \`${agentId}\``,
    `- Suite: \`${suite}\``,
    `- Generated At: \`${nowIsoString()}\``,
    `- Total Scenarios Recorded: \`${String(results.length)}\``,
    `- Passed: \`${String(passed)}\``,
    `- Failed: \`${String(failed)}\``,
    "",
    "## Summary",
    "",
    "| # | Category | Title | Status | Session | Stop Reason | Tools | Issue |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((result) =>
      [
        `| ${String(result.number).padStart(3, "0")}`,
        result.category,
        escapeMarkdownTableCell(result.title),
        result.status.toUpperCase(),
        `\`${result.sessionId}\``,
        `\`${result.stopReason}\``,
        result.toolNames.length > 0 ? `\`${result.toolNames.join(", ")}\`` : "`none`",
        result.issue ? escapeMarkdownTableCell(result.issue) : "none",
        "|",
      ].join(" "),
    ),
    "",
    "## Details",
    "",
  ]

  for (const result of results) {
    lines.push(`### ${String(result.number).padStart(3, "0")}. ${result.title}`)
    lines.push(`- Category: \`${result.category}\``)
    lines.push(`- Status: \`${result.status}\``)
    lines.push(`- Mode: \`${result.mode}\``)
    lines.push(`- Session: \`${result.sessionId}\``)
    lines.push(`- Stop Reason: \`${result.stopReason}\``)
    lines.push(`- Started At: \`${result.startedAt}\``)
    lines.push(`- Finished At: \`${result.finishedAt}\``)
    lines.push(
      `- Prompts: ${result.prompts.length > 0 ? result.prompts.map((prompt) => `\`${prompt.replace(/`/g, "'")}\``).join(" | ") : "none"}`,
    )
    lines.push(
      `- Tool Use: ${result.toolNames.length > 0 ? result.toolNames.map((tool) => `\`${tool}\``).join(", ") : "none"}`,
    )
    lines.push(
      `- Consumed Inputs: ${result.consumedInputs.length > 0 ? result.consumedInputs.map((value) => `\`${value.replace(/`/g, "'")}\``).join(" | ") : "none"}`,
    )
    lines.push(
      `- Approval Requests: ${result.approvalRequests.length > 0 ? result.approvalRequests.map((request) => `\`${request}\``).join(", ") : "none"}`,
    )
    lines.push(`- Response Preview: ${result.responsePreview ? result.responsePreview : "none"}`)
    lines.push(`- Notes: ${result.notes.length > 0 ? result.notes.join(" | ") : "none"}`)
    lines.push(`- Issue: ${result.issue ?? "none"}`)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

async function oneTurnPromptScenario(input: {
  ctx: ScenarioContext
  number: number
  id: string
  category: string
  title: string
  prompt: string
  mode?: ScenarioMode
  setup?: (session: Session, ctx: ScenarioContext) => Promise<void>
  validate: (payload: {
    session: Session
    summary: WakeRunSummary
    response: string
    ctx: ScenarioContext
  }) => Promise<string[]>
}): Promise<ScenarioResult> {
  const session = await input.ctx.createSession()
  const startedAt = nowIsoString()
  await input.setup?.(session, input.ctx)
  let summary: WakeRunSummary
  if (input.mode === "watch") {
    summary = await input.ctx.runWatchScenario(session.id, () =>
      input.ctx.emitUserMessage(session.id, input.prompt),
    )
  } else {
    await input.ctx.emitUserMessage(session.id, input.prompt)
    summary = await input.ctx.wakeSession(session.id)
  }
  const response = summary.responseMessage ?? latestAgentMessage(summary.events)?.message ?? ""
  let notes: string[]
  try {
    notes = await input.validate({
      session,
      summary,
      response,
      ctx: input.ctx,
    })
  } catch (error) {
    throw new ScenarioExecutionError(error instanceof Error ? error.message : String(error), {
      mode: input.mode ?? "wake",
      sessionId: session.id,
      startedAt,
      stopReason: summary.stopReason,
      prompts: [input.prompt],
      responsePreview: compactPreview(response),
      toolNames: summary.toolNames,
      approvalRequests: summary.approvalRequests,
    })
  }
  return {
    number: input.number,
    id: input.id,
    category: input.category,
    title: input.title,
    mode: input.mode ?? "wake",
    sessionId: session.id,
    startedAt,
    finishedAt: nowIsoString(),
    status: "pass",
    stopReason: summary.stopReason,
    prompts: [input.prompt],
    responsePreview: compactPreview(response),
    toolNames: summary.toolNames,
    consumedInputs: summary.consumedInputs,
    approvalRequests: summary.approvalRequests,
    notes,
    issue: null,
  }
}

async function continuityScenario(input: {
  ctx: ScenarioContext
  number: number
  title: string
  token: string
}): Promise<ScenarioResult> {
  const session = await input.ctx.createSession()
  const startedAt = nowIsoString()
  const prompts = [
    `Remember this session token exactly: ${input.token}. Reply briefly when stored.`,
    "What session token did I just ask you to remember? Answer with the exact token only.",
  ]
  await input.ctx.emitUserMessage(session.id, prompts[0])
  await input.ctx.wakeSession(session.id)
  await input.ctx.emitUserMessage(session.id, prompts[1])
  const summary = await input.ctx.wakeSession(session.id)
  const response = summary.responseMessage ?? latestAgentMessage(summary.events)?.message ?? ""
  assertCondition(
    response.includes(input.token),
    `Expected continuity response to include ${input.token}, received: ${response}`,
  )
  return {
    number: input.number,
    id: scenarioId("continuity", input.number),
    category: "continuity",
    title: input.title,
    mode: "wake",
    sessionId: session.id,
    startedAt,
    finishedAt: nowIsoString(),
    status: "pass",
    stopReason: summary.stopReason,
    prompts,
    responsePreview: compactPreview(response),
    toolNames: summary.toolNames,
    consumedInputs: summary.consumedInputs,
    approvalRequests: summary.approvalRequests,
    notes: [`recalled token ${input.token}`],
    issue: null,
  }
}

async function scratchWriteScenario(input: {
  ctx: ScenarioContext
  number: number
  title: string
  fileName: string
  marker: string
  allowed: boolean
}): Promise<ScenarioResult> {
  const session = await input.ctx.createSession()
  const startedAt = nowIsoString()
  const prompt = `Use shell_run in /workspace to create notes/${input.fileName} with exactly one line: ${input.marker}. Do not ask for plain-text confirmation; rely on the runtime confirmation flow if it is required.`
  await input.ctx.emitUserMessage(session.id, prompt)
  await input.ctx.wakeSession(session.id)
  const snapshot = await input.ctx.store.getSession(session.id)
  assertCondition(
    snapshot.session.stopReason === "requires_action" &&
      snapshot.session.pendingToolConfirmationRequest?.toolName === "shell_run",
    `Expected scratch write scenario to pause for shell_run confirmation, received stopReason=${snapshot.session.stopReason}`,
  )
  await input.ctx.emitToolConfirmation(
    session.id,
    input.allowed,
    input.allowed ? "approve" : "deny",
  )
  const second = await input.ctx.wakeSession(session.id)
  const response = second.responseMessage ?? latestAgentMessage(second.events)?.message ?? ""
  const filePath = join(
    input.ctx.companyDir,
    ".openboa",
    "agents",
    input.ctx.agentId,
    "sessions",
    session.id,
    "workspace",
    "notes",
    input.fileName,
  )
  const written = await readFile(filePath, "utf8").catch(() => null)
  if (input.allowed) {
    assertCondition(
      written?.trim() === input.marker,
      `Expected scratch write to create ${input.fileName} with ${input.marker}, received ${written}`,
    )
  } else {
    assertCondition(
      written === null,
      `Expected denied scratch write to keep ${input.fileName} absent`,
    )
  }
  return {
    number: input.number,
    id: scenarioId("scratch_write", input.number),
    category: "scratch_write",
    title: input.title,
    mode: "wake",
    sessionId: session.id,
    startedAt,
    finishedAt: nowIsoString(),
    status: "pass",
    stopReason: second.stopReason,
    prompts: [prompt],
    responsePreview: compactPreview(response),
    toolNames: second.toolNames,
    consumedInputs: second.consumedInputs,
    approvalRequests: second.approvalRequests,
    notes: [input.allowed ? `created notes/${input.fileName}` : `denied notes/${input.fileName}`],
    issue: null,
  }
}

async function bootstrapPromotionScenario(input: {
  ctx: ScenarioContext
  number: number
  title: string
  fileName: string
  marker: string
}): Promise<ScenarioResult> {
  const session = await input.ctx.createSession()
  const startedAt = nowIsoString()
  const sharedBefore = await input.ctx.readAgentWorkspaceFile(input.fileName)
  const markerCountBefore = countExactLineOccurrences(sharedBefore, input.marker)
  const markerAlreadyPresent = markerCountBefore > 0
  const prompt = markerAlreadyPresent
    ? `Use resources_stage_from_substrate to copy /workspace/agent/${input.fileName} into /workspace/drafts/${input.fileName}. The shared ${input.fileName} already contains exactly one "${input.marker}" line. Do not duplicate it. Use resources_compare_with_substrate to verify whether the staged draft already matches the substrate. Only use resources_promote_to_substrate if you discover a missing intentional change that still needs promotion. Do not ask for plain-text confirmation; rely on runtime approval if needed.`
    : `Use resources_stage_from_substrate to copy /workspace/agent/${input.fileName} into /workspace/drafts/${input.fileName}. Append exactly "${input.marker}" to the staged file. Use resources_compare_with_substrate to inspect the diff, then use resources_promote_to_substrate to replace ${input.fileName} if the requested line is the only intentional change. Do not ask for plain-text confirmation; rely on runtime approval if needed.`
  let summary: WakeRunSummary | null = null
  const toolNames = new Set<string>()
  const consumedInputs: string[] = []
  const approvalRequests = new Set<string>()
  try {
    await input.ctx.emitOutcome(session.id, {
      title: `Promote one bounded edit into ${input.fileName}`,
      detail: `Add exactly one new line to ${input.fileName} and persist it through staged substrate promotion.`,
      successCriteria: [
        `Stage ${input.fileName} from the shared substrate into /workspace/drafts/${input.fileName}`,
        `Append exactly ${input.marker}`,
        `Compare the staged file with the substrate before promotion`,
        `Promote the staged file back into ${input.fileName} only if the requested line is the only intentional diff`,
      ],
    })
    await input.ctx.emitUserMessage(session.id, prompt)

    summary = await input.ctx.wakeSession(session.id)
    mergeWakeSummaryEvidence(summary, toolNames, consumedInputs, approvalRequests)
    for (let approvalLoop = 0; approvalLoop < MAX_APPROVAL_LOOPS; approvalLoop += 1) {
      const snapshot = await input.ctx.store.getSession(session.id)
      if (snapshot.session.stopReason !== "requires_action") {
        break
      }
      await input.ctx.emitToolConfirmation(session.id, true, "approve bootstrap promotion")
      summary = await input.ctx.wakeSession(session.id)
      mergeWakeSummaryEvidence(summary, toolNames, consumedInputs, approvalRequests)
    }

    const shared = await input.ctx.readAgentWorkspaceFile(input.fileName)
    const markerCountAfter = countExactLineOccurrences(shared, input.marker)
    assertCondition(
      shared.includes(input.marker),
      `Expected promoted ${input.fileName} to include ${input.marker}`,
    )
    assertCondition(
      toolNames.has("resources_stage_from_substrate"),
      `Expected ${input.fileName} promotion to use resources_stage_from_substrate`,
    )
    assertCondition(
      toolNames.has("resources_compare_with_substrate"),
      `Expected ${input.fileName} promotion to use resources_compare_with_substrate`,
    )
    if (markerAlreadyPresent) {
      assertCondition(
        markerCountAfter === markerCountBefore,
        `Expected rerun of ${input.fileName} promotion to avoid duplicating ${input.marker}`,
      )
    } else {
      assertCondition(
        toolNames.has("resources_promote_to_substrate"),
        `Expected ${input.fileName} promotion to use resources_promote_to_substrate`,
      )
      assertCondition(
        markerCountAfter === markerCountBefore + 1,
        `Expected ${input.fileName} promotion to add exactly one ${input.marker} line`,
      )
    }
    return {
      number: input.number,
      id: scenarioId("bootstrap_promote", input.number),
      category: "bootstrap_promotion",
      title: input.title,
      mode: "wake",
      sessionId: session.id,
      startedAt,
      finishedAt: nowIsoString(),
      status: "pass",
      stopReason: summary.stopReason,
      prompts: [prompt],
      responsePreview: compactPreview(latestAgentMessage(summary.events)?.message ?? null),
      toolNames: [...toolNames],
      consumedInputs,
      approvalRequests: [...approvalRequests],
      notes: markerAlreadyPresent
        ? [`verified existing ${input.marker} in ${input.fileName} without duplication`]
        : [`promoted ${input.marker} into ${input.fileName}`],
      issue: null,
    }
  } catch (error) {
    throw new ScenarioExecutionError(error instanceof Error ? error.message : String(error), {
      mode: "wake",
      sessionId: session.id,
      startedAt,
      stopReason: summary?.stopReason ?? "error",
      prompts: [prompt],
      responsePreview:
        summary !== null
          ? compactPreview(latestAgentMessage(summary.events)?.message ?? null)
          : null,
      toolNames: [...toolNames],
      consumedInputs,
      approvalRequests: [...approvalRequests],
      notes: summary ? [`bootstrap promotion reached ${summary.stopReason}`] : [],
    })
  }
}

function mergeWakeSummaryEvidence(
  summary: WakeRunSummary,
  toolNames: Set<string>,
  consumedInputs: string[],
  approvalRequests: Set<string>,
): void {
  for (const toolName of summary.toolNames) {
    toolNames.add(toolName)
  }
  for (const input of summary.consumedInputs) {
    if (!consumedInputs.includes(input)) {
      consumedInputs.push(input)
    }
  }
  for (const request of summary.approvalRequests) {
    approvalRequests.add(request)
  }
}

function countExactLineOccurrences(content: string, line: string): number {
  return content
    .split(/\r?\n/u)
    .reduce((count, candidate) => count + (candidate === line ? 1 : 0), 0)
}

async function customToolRoundtripScenario(input: {
  ctx: ScenarioContext
  number: number
  title: string
  toolName: string
  toolInput: Record<string, unknown>
  output: string
  expectedTokens: string[]
}): Promise<ScenarioResult> {
  const session = await input.ctx.createSession()
  const startedAt = nowIsoString()
  const prompt = `Do not answer directly. Pause and request a custom tool result named ${input.toolName} with input ${JSON.stringify(input.toolInput)}.`
  let first: WakeRunSummary | null = null
  let second: WakeRunSummary | null = null
  try {
    await input.ctx.emitUserMessage(session.id, prompt)
    first = await input.ctx.wakeSession(session.id)
    const waiting = await input.ctx.store.getSession(session.id)
    assertCondition(
      waiting.session.stopReason === "requires_action" &&
        waiting.session.pendingCustomToolRequest?.name === input.toolName,
      `Expected custom tool roundtrip to pause for ${input.toolName}, received stopReason=${waiting.session.stopReason}`,
    )
    await input.ctx.emitCustomToolResult(session.id, input.output)
    second = await input.ctx.wakeSession(session.id)
    const response = latestAgentMessage(second.events)?.message ?? ""
    const normalizedResponse = response.toLowerCase()
    for (const token of input.expectedTokens) {
      assertCondition(
        normalizedResponse.includes(token.toLowerCase()),
        `Expected custom tool response to include ${token}, received: ${response}`,
      )
    }
    return {
      number: input.number,
      id: scenarioId("custom_tool", input.number),
      category: "custom_tool",
      title: input.title,
      mode: "wake",
      sessionId: session.id,
      startedAt,
      finishedAt: nowIsoString(),
      status: "pass",
      stopReason: second.stopReason,
      prompts: [prompt],
      responsePreview: compactPreview(response),
      toolNames: second.toolNames,
      consumedInputs: second.consumedInputs,
      approvalRequests: first.approvalRequests,
      notes: [`completed ${input.toolName} roundtrip`],
      issue: null,
    }
  } catch (error) {
    throw new ScenarioExecutionError(error instanceof Error ? error.message : String(error), {
      mode: "wake",
      sessionId: session.id,
      startedAt,
      stopReason: second?.stopReason ?? first?.stopReason ?? "error",
      prompts: [prompt],
      responsePreview: compactPreview(
        second?.responseMessage ??
          first?.responseMessage ??
          latestAgentMessage((second ?? first)?.events ?? [])?.message ??
          null,
      ),
      toolNames: second?.toolNames ?? first?.toolNames ?? [],
      consumedInputs: second?.consumedInputs ?? first?.consumedInputs ?? [],
      approvalRequests: second?.approvalRequests ?? first?.approvalRequests ?? [],
      notes: [`custom tool ${input.toolName}`],
    })
  }
}

async function delayedWakeScenario(input: {
  ctx: ScenarioContext
  number: number
  title: string
  token: string
}): Promise<ScenarioResult> {
  const session = await input.ctx.createSession()
  const startedAt = nowIsoString()
  const prompt = `Reply with "scheduled" right now. When you are later resumed by a queued wake whose note contains ${input.token}, answer with the exact token ${input.token} and include the phrase "queued wake".`
  let first: WakeRunSummary | null = null
  let second: WakeRunSummary | null = null
  try {
    await input.ctx.emitOutcome(session.id, {
      title: `Handle delayed revisit ${input.token}`,
      detail: `Stay aligned around the delayed revisit token ${input.token} until the queued wake arrives.`,
      successCriteria: [
        'Acknowledge the current turn with "scheduled".',
        `When resumed by a queued wake whose note contains ${input.token}, answer with the exact token ${input.token}.`,
        'Mention the phrase "queued wake" in the delayed revisit response.',
      ],
    })
    await input.ctx.emitUserMessage(session.id, prompt)
    first = await input.ctx.wakeSession(session.id)
    await input.ctx.enqueueDelayedWake({
      sessionId: session.id,
      delayMs: 400,
      reason: "session.revisit",
      note: input.token,
      dedupeKey: `scenario-delayed-${input.token}`,
    })
    second = await input.ctx.runWatchScenario(session.id, async () => {
      await sleep(500)
    })
    const response = second.responseMessage ?? latestAgentMessage(second.events)?.message ?? ""
    const consumedQueuedWake = second.consumedInputs.some(
      (value) => value.includes("queued_wake:") && value.includes(input.token),
    )
    assertCondition(
      response.trim().length > 0,
      `Expected delayed wake scenario to produce a non-empty delayed response`,
    )
    assertCondition(
      response.includes(input.token),
      `Expected delayed wake response to include ${input.token}, received: ${response}`,
    )
    assertCondition(
      consumedQueuedWake || response.toLowerCase().includes("queued wake"),
      `Expected delayed wake scenario to consume queued wake input for ${input.token}, received response: ${response}`,
    )
    return {
      number: input.number,
      id: scenarioId("delayed_wake", input.number),
      category: "delayed_wake",
      title: input.title,
      mode: "watch",
      sessionId: session.id,
      startedAt,
      finishedAt: nowIsoString(),
      status: "pass",
      stopReason: second.stopReason,
      prompts: [prompt],
      responsePreview: compactPreview(response),
      toolNames: second.toolNames,
      consumedInputs: second.consumedInputs,
      approvalRequests: second.approvalRequests,
      notes: [`consumed delayed wake ${input.token}`],
      issue: null,
    }
  } catch (error) {
    throw new ScenarioExecutionError(error instanceof Error ? error.message : String(error), {
      mode: "watch",
      sessionId: session.id,
      startedAt,
      stopReason: second?.stopReason ?? first?.stopReason ?? "error",
      prompts: [prompt],
      responsePreview: compactPreview(
        second?.responseMessage ??
          first?.responseMessage ??
          latestAgentMessage((second ?? first)?.events ?? [])?.message ??
          null,
      ),
      toolNames: second?.toolNames ?? first?.toolNames ?? [],
      consumedInputs: second?.consumedInputs ?? first?.consumedInputs ?? [],
      approvalRequests: second?.approvalRequests ?? first?.approvalRequests ?? [],
      notes: [`delayed wake ${input.token}`],
    })
  }
}

async function buildScenarios(ctx: ScenarioContext): Promise<ScenarioDefinition[]> {
  const scenarios: ScenarioDefinition[] = []
  let number = 1

  const bootstrapFiles = [
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "IDENTITY.md",
    "USER.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
    "MEMORY.md",
  ]
  const quoteTemplates = [
    (fileName: string) =>
      `Call read with path /workspace/agent/${fileName}. Then quote two exact non-empty full lines from ${fileName}, including any leading markdown markers and punctuation. Copy the lines verbatim with no decorative quotes.`,
    (fileName: string) =>
      `Use read on /workspace/agent/${fileName}. Return two exact non-empty full lines from the file, including leading markdown markers and punctuation, plus one short grounded sentence. Do not paraphrase or decorate the quoted lines.`,
    (fileName: string) =>
      `Read /workspace/agent/${fileName} and answer with two exact full lines plus one grounded summary sentence. Preserve the exact line text, including leading markdown markers and punctuation. Do not rewrite the quoted text.`,
    (fileName: string) =>
      `Quote exact text from ${fileName} by reading /workspace/agent/${fileName}: give me two exact non-empty full lines from the file, preserving leading markdown markers and punctuation, and nothing speculative.`,
  ]
  for (const fileName of bootstrapFiles) {
    for (let templateIndex = 0; templateIndex < quoteTemplates.length; templateIndex += 1) {
      const currentNumber = number
      const prompt = quoteTemplates[templateIndex](fileName)
      const curated =
        templateIndex === 0 &&
        ["AGENTS.md", "IDENTITY.md", "BOOTSTRAP.md", "MEMORY.md"].includes(fileName)
      scenarios.push({
        number: currentNumber,
        id: scenarioId("bootstrap_quote", currentNumber),
        category: "bootstrap_quote",
        title: `Quote ${fileName} (${templateIndex + 1})`,
        ...(curated
          ? curatedScenario(
              fileName === "AGENTS.md"
                ? "bootstrap_quote_agents"
                : fileName === "IDENTITY.md"
                  ? "bootstrap_quote_identity"
                  : fileName === "BOOTSTRAP.md"
                    ? "bootstrap_quote_bootstrap"
                    : "bootstrap_quote_memory",
            )
          : {}),
        run: async (scenarioCtx) => {
          const expectedText = await scenarioCtx.readAgentWorkspaceFile(fileName)
          return oneTurnPromptScenario({
            ctx: scenarioCtx,
            number: currentNumber,
            id: scenarioId("bootstrap_quote", currentNumber),
            category: "bootstrap_quote",
            title: `Quote ${fileName} (${templateIndex + 1})`,
            prompt,
            validate: async ({ response, summary }) => {
              assertCondition(
                !(
                  response.trim().length === 0 &&
                  summary.toolNames.includes("shell_run") &&
                  summary.stopReason === "requires_action"
                ),
                `Read-only ${fileName} quote scenario incorrectly escalated to confirmation-gated shell_run`,
              )
              const matches = countExactLineMatches(response, expectedText)
              assertCondition(
                matches.length >= 1,
                `Expected response to quote at least one exact line from ${fileName}`,
              )
              return [`quoted ${matches.length} exact line(s) from ${fileName}`]
            },
          })
        },
      })
      number += 1
    }
  }

  const introspectionScenarios: Array<{
    title: string
    curated?: boolean
    prompt: (session: Session) => string
    expected: (session: Session) => string[]
  }> = [
    {
      title: "State the agent name",
      curated: true,
      prompt: () => "What is your name? Answer with the exact agent name only.",
      expected: () => [ctx.agentId],
    },
    {
      title: "State the current session id",
      curated: true,
      prompt: (_session) => "What is your current session id? Answer with the exact id only.",
      expected: (session) => [session.id],
    },
    {
      title: "State the current environment id",
      prompt: (_session) =>
        "What environment id are you attached to right now? Answer with the exact id only.",
      expected: (session) => [session.environmentId],
    },
    {
      title: "State the writable workspace mount",
      curated: true,
      prompt: () =>
        "Where is your writable session workspace mounted? Answer with the exact mount path only.",
      expected: () => ["/workspace"],
    },
    {
      title: "State the shared substrate mount",
      curated: true,
      prompt: () =>
        "Where is your shared agent substrate mounted? Answer with the exact mount path only.",
      expected: () => ["/workspace/agent"],
    },
    {
      title: "State the runtime artifact directory",
      curated: true,
      prompt: () =>
        "Which exact mount path is reserved for session runtime artifacts and continuity state? Answer with the exact mount path only. Do not answer /workspace or /workspace/.openboa-runtime.",
      expected: () => ["/runtime"],
    },
    {
      title: "State the operating contract file",
      prompt: () =>
        "Which bootstrap file defines your operating contract? Answer with the exact file name only.",
      expected: () => ["AGENTS.md"],
    },
    {
      title: "State the durable memory file",
      prompt: () =>
        "Which bootstrap file holds durable shared memory? Answer with the exact file name only.",
      expected: () => ["MEMORY.md"],
    },
    {
      title: "Distinguish writable and shared workspaces",
      prompt: () =>
        "Explain the difference between /workspace and /workspace/agent in one sentence, using both exact mount paths.",
      expected: () => ["/workspace", "/workspace/agent"],
    },
    {
      title: "State pending confirmation posture",
      prompt: () =>
        "Do you currently have a pending tool confirmation request? Answer with 'none' if not.",
      expected: () => ["none"],
    },
  ]
  for (const definition of introspectionScenarios) {
    const currentNumber = number
    scenarios.push({
      number: currentNumber,
      id: scenarioId("introspection", currentNumber),
      category: "introspection",
      title: definition.title,
      ...(definition.curated
        ? curatedScenario(
            definition.title === "State the agent name"
              ? "introspection_agent_name"
              : definition.title === "State the current session id"
                ? "introspection_session_id"
                : definition.title === "State the writable workspace mount"
                  ? "introspection_workspace_mount"
                  : definition.title === "State the shared substrate mount"
                    ? "introspection_substrate_mount"
                    : "introspection_runtime_mount",
          )
        : {}),
      run: async (scenarioCtx) => {
        const session = await scenarioCtx.createSession()
        const prompt = definition.prompt(session)
        try {
          await scenarioCtx.emitUserMessage(session.id, prompt)
          const summary = await scenarioCtx.wakeSession(session.id)
          const response = latestAgentMessage(summary.events)?.message ?? ""
          for (const token of definition.expected(session)) {
            assertCondition(
              response.includes(token),
              `Expected introspection response to include ${token}, received: ${response}`,
            )
          }
          return {
            number: currentNumber,
            id: scenarioId("introspection", currentNumber),
            category: "introspection",
            title: definition.title,
            mode: "wake",
            sessionId: session.id,
            startedAt: nowIsoString(),
            finishedAt: nowIsoString(),
            status: "pass",
            stopReason: summary.stopReason,
            prompts: [prompt],
            responsePreview: compactPreview(response),
            toolNames: summary.toolNames,
            consumedInputs: summary.consumedInputs,
            approvalRequests: summary.approvalRequests,
            notes: definition.expected(session),
            issue: null,
          }
        } catch (error) {
          const snapshot = await scenarioCtx.store.getSession(session.id)
          const response = latestAgentMessage(snapshot.events)?.message ?? null
          throw new ScenarioExecutionError(error instanceof Error ? error.message : String(error), {
            mode: "wake",
            sessionId: session.id,
            startedAt: nowIsoString(),
            stopReason: snapshot.session.stopReason,
            prompts: [prompt],
            responsePreview: compactPreview(response),
            toolNames: collectToolNames(snapshot.events),
            consumedInputs: [],
            approvalRequests: collectApprovalRequests(snapshot.events),
            notes: definition.expected(session),
          })
        }
      },
    })
    number += 1
  }

  const toolScenarios: Array<{
    title: string
    prompt: string
    expectedTool: string
    curated?: boolean
    setup?: (session: Session, scenarioCtx: ScenarioContext) => Promise<void>
  }> = [
    {
      title: "Use environment_describe",
      curated: true,
      prompt: "Use environment_describe to report your environment id and sandbox mode.",
      expectedTool: "environment_describe",
    },
    {
      title: "Use agent_describe_setup",
      prompt: "Use agent_describe_setup to summarize your provider, model, and runner.",
      expectedTool: "agent_describe_setup",
    },
    {
      title: "Use agent_compare_setup",
      prompt:
        "Use agent_compare_setup to compare your current setup with the current session and summarize whether it matches.",
      expectedTool: "agent_compare_setup",
    },
    {
      title: "Use vault_list",
      prompt: "Use vault_list to report whether any vault mounts are attached.",
      expectedTool: "vault_list",
    },
    {
      title: "Use session_get_snapshot",
      curated: true,
      prompt: "Use session_get_snapshot to report your current session id and stop reason.",
      expectedTool: "session_get_snapshot",
    },
    {
      title: "Use session_describe_context",
      prompt: "Use session_describe_context to report the current context pressure.",
      expectedTool: "session_describe_context",
    },
    {
      title: "Use session_list",
      prompt: "Use session_list to report how many sessions this agent currently has.",
      expectedTool: "session_list",
    },
    {
      title: "Use session_list_traces",
      prompt: "Use session_list_traces to report whether any wake traces exist for this session.",
      expectedTool: "session_list_traces",
    },
    {
      title: "Use session_search_context",
      prompt:
        "Use session_search_context to search for the phrase 'openboa agent' in this session context and report the match.",
      expectedTool: "session_search_context",
    },
    {
      title: "Use session_search_traces",
      curated: true,
      prompt:
        "Use session_search_traces to search for a recent wake about the current session and report the best match.",
      expectedTool: "session_search_traces",
    },
    {
      title: "Use resources_list",
      curated: true,
      prompt: "Use resources_list to list the mounted resource paths available in this session.",
      expectedTool: "resources_list",
    },
    {
      title: "Use shell_describe",
      prompt: "Use shell_describe to report the current shell posture.",
      expectedTool: "shell_describe",
    },
    {
      title: "Use permissions_describe",
      curated: true,
      prompt:
        "Use permissions_describe to explain the current permission posture for shell writes.",
      expectedTool: "permissions_describe",
    },
    {
      title: "Use sandbox_describe",
      prompt: "Use sandbox_describe to summarize the current sandbox constraints.",
      expectedTool: "sandbox_describe",
    },
    {
      title: "Use skills_list",
      prompt: "Use skills_list to list up to three available skills.",
      expectedTool: "skills_list",
    },
    {
      title: "Use skills_search",
      prompt: "Use skills_search to search for wiki-related skills and report the best match.",
      expectedTool: "skills_search",
    },
    {
      title: "Use learning_list",
      curated: true,
      prompt: "Use learning_list to report whether any learnings are recorded for this agent.",
      expectedTool: "learning_list",
    },
    {
      title: "Use memory_list",
      prompt: "Use memory_list to report whether any durable memory notes exist.",
      expectedTool: "memory_list",
    },
    {
      title: "Use memory_search",
      curated: true,
      prompt: "Use memory_search to search for notes about 'openboa' and report the result.",
      expectedTool: "memory_search",
    },
    {
      title: "Use retrieval_search",
      curated: true,
      prompt: "Use retrieval_search to look for evidence about AGENTS.md and report the top hit.",
      expectedTool: "retrieval_search",
    },
    {
      title: "Use outcome_define",
      curated: true,
      prompt: "Use outcome_define to create a bounded outcome titled 'Scenario Tool Outcome'.",
      expectedTool: "outcome_define",
    },
    {
      title: "Use outcome_read",
      prompt: "Use outcome_read to summarize the current active outcome.",
      expectedTool: "outcome_read",
      setup: async (session, scenarioCtx) => {
        await scenarioCtx.emitOutcome(session.id, {
          title: "Outcome read scenario",
          detail: "Read back the currently active outcome.",
          successCriteria: ["Use outcome_read to summarize the active outcome."],
        })
      },
    },
    {
      title: "Use outcome_grade",
      prompt: "Use outcome_grade to summarize the current outcome grade.",
      expectedTool: "outcome_grade",
      setup: async (session, scenarioCtx) => {
        await scenarioCtx.emitOutcome(session.id, {
          title: "Outcome grade scenario",
          detail: "Grade the currently active outcome.",
          successCriteria: ["Use outcome_grade and explain the current posture."],
        })
      },
    },
    {
      title: "Use outcome_evaluate",
      curated: true,
      prompt: "Use outcome_evaluate to say whether promotion is ready right now.",
      expectedTool: "outcome_evaluate",
      setup: async (session, scenarioCtx) => {
        await scenarioCtx.emitOutcome(session.id, {
          title: "Outcome evaluate scenario",
          detail: "Evaluate whether promotion is ready.",
          successCriteria: ["Use outcome_evaluate before any promotion."],
        })
      },
    },
    {
      title: "Use outcome_history",
      prompt: "Use outcome_history to report how many evaluator iterations exist so far.",
      expectedTool: "outcome_history",
      setup: async (session, scenarioCtx) => {
        await scenarioCtx.emitOutcome(session.id, {
          title: "Outcome history scenario",
          detail: "Inspect evaluator iteration history.",
          successCriteria: ["Use outcome_history and report the iteration count."],
        })
      },
    },
    {
      title: "Use session_get_events",
      prompt: "Use session_get_events to report the latest user message in this session.",
      expectedTool: "session_get_events",
    },
  ]
  for (const definition of toolScenarios) {
    const currentNumber = number
    scenarios.push({
      number: currentNumber,
      id: scenarioId("tool", currentNumber),
      category: "tool",
      title: definition.title,
      ...(definition.curated
        ? curatedScenario(
            definition.expectedTool === "environment_describe"
              ? "tool_environment_describe"
              : definition.expectedTool === "session_get_snapshot"
                ? "tool_session_get_snapshot"
                : definition.expectedTool === "session_search_traces"
                  ? "tool_session_search_traces"
                  : definition.expectedTool === "resources_list"
                    ? "tool_resources_list"
                    : definition.expectedTool === "permissions_describe"
                      ? "tool_permissions_describe"
                      : definition.expectedTool === "learning_list"
                        ? "tool_learning_list"
                        : definition.expectedTool === "memory_search"
                          ? "tool_memory_search"
                          : definition.expectedTool === "retrieval_search"
                            ? "tool_retrieval_search"
                            : definition.expectedTool === "outcome_define"
                              ? "tool_outcome_define"
                              : "tool_outcome_evaluate",
          )
        : {}),
      run: async (scenarioCtx) =>
        oneTurnPromptScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          id: scenarioId("tool", currentNumber),
          category: "tool",
          title: definition.title,
          prompt: `Call ${definition.expectedTool} directly for this turn. Do not substitute a different managed tool and do not answer only from cached context unless the named tool is impossible or safety-blocked. ${definition.prompt}`,
          setup: definition.setup,
          validate: async ({ summary }) => {
            assertCondition(
              summary.toolNames.includes(definition.expectedTool),
              `Expected tool scenario to use ${definition.expectedTool}, used ${summary.toolNames.join(", ")}`,
            )
            return [`used ${definition.expectedTool}`]
          },
        }),
    })
    number += 1
  }

  for (let index = 0; index < 10; index += 1) {
    const currentNumber = number
    const token = `continuity-token-${String(index + 1).padStart(2, "0")}`
    scenarios.push({
      number: currentNumber,
      id: scenarioId("continuity", currentNumber),
      category: "continuity",
      title: `Recall session token ${token}`,
      ...(index < 2 ? curatedScenario("continuity_recall") : {}),
      run: async (scenarioCtx) =>
        continuityScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          title: `Recall session token ${token}`,
          token,
        }),
    })
    number += 1
  }

  for (let index = 0; index < 8; index += 1) {
    const currentNumber = number
    const token = `watch-token-${String(index + 1).padStart(2, "0")}`
    scenarios.push({
      number: currentNumber,
      id: scenarioId("watch", currentNumber),
      category: "watch",
      title: `Watch mode consumes immediate message ${token}`,
      ...(index === 0 ? curatedScenario("watch_ingress") : {}),
      run: async (scenarioCtx) =>
        oneTurnPromptScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          id: scenarioId("watch", currentNumber),
          category: "watch",
          title: `Watch mode consumes immediate message ${token}`,
          prompt: `Reply with the exact token ${token}.`,
          mode: "watch",
          validate: async ({ response }) => {
            assertCondition(
              response.includes(token),
              `Expected watch response to include ${token}, received: ${response}`,
            )
            return [`watch consumed ${token}`]
          },
        }),
    })
    number += 1
  }

  for (let index = 0; index < 8; index += 1) {
    const currentNumber = number
    const allowed = index < 4
    const fileName = `scenario-write-${String(index + 1).padStart(2, "0")}.txt`
    const marker = `scratch-marker-${String(index + 1).padStart(2, "0")}`
    scenarios.push({
      number: currentNumber,
      id: scenarioId("scratch_write", currentNumber),
      category: "scratch_write",
      title: `${allowed ? "Approve" : "Deny"} scratch write ${fileName}`,
      ...(index === 0
        ? curatedScenario("scratch_write_allow")
        : index === 4
          ? curatedScenario("scratch_write_deny")
          : {}),
      run: async (scenarioCtx) =>
        scratchWriteScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          title: `${allowed ? "Approve" : "Deny"} scratch write ${fileName}`,
          fileName,
          marker,
          allowed,
        }),
    })
    number += 1
  }

  const promotionTargets = [
    { fileName: "SOUL.md", marker: "- Scenario-PROMOTE-SOUL" },
    { fileName: "IDENTITY.md", marker: "- Scenario-PROMOTE-IDENTITY" },
  ]
  for (const target of promotionTargets) {
    const currentNumber = number
    scenarios.push({
      number: currentNumber,
      id: scenarioId("bootstrap_promote", currentNumber),
      category: "bootstrap_promotion",
      title: `Promote ${target.marker} into ${target.fileName}`,
      ...curatedScenario(target.fileName === "SOUL.md" ? "promotion_soul" : "promotion_identity"),
      run: async (scenarioCtx) =>
        bootstrapPromotionScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          title: `Promote ${target.marker} into ${target.fileName}`,
          fileName: target.fileName,
          marker: target.marker,
        }),
    })
    number += 1
  }

  const readBackTargets = [
    { fileName: "SOUL.md", marker: "- Scenario-PROMOTE-SOUL" },
    { fileName: "IDENTITY.md", marker: "- Scenario-PROMOTE-IDENTITY" },
  ]
  for (const target of readBackTargets) {
    const currentNumber = number
    scenarios.push({
      number: currentNumber,
      id: scenarioId("readback", currentNumber),
      category: "readback",
      title: `Read back ${target.marker} from ${target.fileName}`,
      ...curatedScenario(target.fileName === "SOUL.md" ? "readback_soul" : "readback_identity"),
      run: async (scenarioCtx) =>
        oneTurnPromptScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          id: scenarioId("readback", currentNumber),
          category: "readback",
          title: `Read back ${target.marker} from ${target.fileName}`,
          prompt: `Read your current ${target.fileName} and quote the exact full line ${target.marker}, preserving the leading punctuation exactly as it appears in the file.`,
          validate: async ({ response }) => {
            assertCondition(
              response.includes(target.marker),
              `Expected readback response to include ${target.marker}, received: ${response}`,
            )
            return [`read back ${target.marker}`]
          },
        }),
    })
    number += 1
  }

  {
    const currentNumber = number
    scenarios.push({
      number: currentNumber,
      id: scenarioId("custom_tool", currentNumber),
      category: "custom_tool",
      title: "Complete a custom tool roundtrip",
      ...curatedScenario("custom_tool_roundtrip"),
      run: async (scenarioCtx) =>
        customToolRoundtripScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          title: "Complete a custom tool roundtrip",
          toolName: "fetch_spec",
          toolInput: { path: "spec.md" },
          output:
            "# Spec\n- Title: Activation Queue\n- Goal: Execute ready work without scanning every session\n- Constraints: Respect leases and surface approval pauses clearly",
          expectedTokens: ["Activation Queue", "Respect leases"],
        }),
    })
    number += 1
  }

  {
    const currentNumber = number
    const token = "delayed-wake-token-01"
    scenarios.push({
      number: currentNumber,
      id: scenarioId("delayed_wake", currentNumber),
      category: "delayed_wake",
      title: "Consume a delayed queued wake in watch mode",
      ...curatedScenario("delayed_wake"),
      run: async (scenarioCtx) =>
        delayedWakeScenario({
          ctx: scenarioCtx,
          number: currentNumber,
          title: "Consume a delayed queued wake in watch mode",
          token,
        }),
    })
    number += 1
  }

  assertCondition(
    scenarios.length === FULL_SCENARIO_COUNT,
    `Expected exactly ${String(FULL_SCENARIO_COUNT)} scenarios, built ${String(scenarios.length)}`,
  )
  return scenarios
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export async function runAgentScenarioLoop(
  companyDir: string,
  options: ScenarioRunOptions = {},
): Promise<{
  agentId: string
  outputPath: string
  suite: ScenarioSuite
  available: number
  executed: number
  passed: number
  failed: number
}> {
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  await ensureOpenboaSetup(companyDir)
  const agentId =
    options.agentId?.trim() && options.agentId.trim().length > 0
      ? options.agentId.trim()
      : `scenario-loop-${new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}`
  await ensureAgentConfig(companyDir, { agentId, provider: "openai-codex" })

  const auth = await new CodexAuthProvider(companyDir).resolve()
  if (auth.mode === "none" || !auth.token) {
    throw new Error(
      'Authentication is required for live agent scenarios. Run "openboa auth login --provider openai-codex" first.',
    )
  }

  if (typeof options.modelTimeoutMs === "number" && Number.isFinite(options.modelTimeoutMs)) {
    process.env.OPENBOA_MODEL_TIMEOUT_MS = String(
      Math.max(1000, Math.floor(options.modelTimeoutMs)),
    )
  }

  const suite = normalizeScenarioSuite(options.suite)
  const ctx = new ScenarioContext(companyDir, agentId, outputPath, suite)
  const scenarios = selectScenarioSuite(await buildScenarios(ctx), suite)
  const count =
    typeof options.count === "number" && Number.isFinite(options.count)
      ? Math.max(1, Math.min(scenarios.length, Math.floor(options.count)))
      : scenarios.length
  await writeScenarioReport(ctx.outputPath, agentId, [], suite)

  let passed = 0
  let failed = 0
  for (const definition of scenarios.slice(0, count)) {
    process.stdout.write(
      `scenario-loop: start ${String(definition.number).padStart(3, "0")} ${definition.title}\n`,
    )
    const result = await runScenario(definition, ctx)
    if (result.status === "pass") {
      passed += 1
      process.stdout.write(
        `scenario-loop: pass ${String(result.number).padStart(3, "0")} session=${result.sessionId} stopReason=${result.stopReason}\n`,
      )
    } else {
      failed += 1
      process.stdout.write(
        `scenario-loop: fail ${String(result.number).padStart(3, "0")} issue=${result.issue ?? "unknown"}\n`,
      )
    }
  }

  return {
    agentId,
    outputPath: ctx.outputPath,
    suite,
    available: scenarios.length,
    executed: count,
    passed,
    failed,
  }
}
