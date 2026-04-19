import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { makeUuidV7 } from "../../foundation/ids.js"
import { nowIsoString } from "../../foundation/time.js"
import { CodexAuthProvider } from "../auth/codex-auth.js"
import type { SessionEvent, SessionOutcomeDefinition } from "../schema/runtime.js"
import { type SessionSnapshot, SessionStore } from "../sessions/session-store.js"
import { ensureAgentConfig, ensureOpenboaSetup } from "../setup.js"
import { ActivationJournal, type ActivationJournalRecord } from "./activation-journal.js"
import { AgentOrchestration, type AgentOrchestratorLoopResult } from "./orchestration.js"
import { SessionWakeQueue } from "./session-wake-queue.js"

const DEFAULT_OUTPUT_PATH = "AGENT_SCENARIO_MIXED_SOAK.md"
const DEFAULT_WORKERS = 3
const DEFAULT_IMMEDIATE_SESSIONS = 2
const DEFAULT_DELAYED_SESSIONS = 2
const DEFAULT_APPROVAL_SESSIONS = 2
const DEFAULT_CUSTOM_TOOL_SESSIONS = 2
const DEFAULT_INTERRUPT_SESSIONS = 2
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_DELAY_MS = 350

type MixedSessionKind = "immediate" | "delayed" | "approval" | "custom_tool" | "interrupt"

interface ScenarioMixedSoakRunOptions {
  agentId?: string
  outputPath?: string
  workers?: number
  rounds?: number
  immediateSessions?: number
  delayedSessions?: number
  approvalSessions?: number
  customToolSessions?: number
  interruptSessions?: number
  modelTimeoutMs?: number
  pollIntervalMs?: number
  timeoutMs?: number
}

interface MixedSessionSummary {
  round: number
  kind: MixedSessionKind
  sessionId: string
  passed: boolean
  stopReason: string
  immediateAckCount: number
  delayedAckCount: number
  abandonedCount: number
  notes: string[]
  issue: string | null
}

interface MixedWorkerSummary {
  worker: number
  cycles: number
  executed: number
  stopReason: AgentOrchestratorLoopResult["stopReason"]
}

interface MixedRoundSummary {
  round: number
  immediatePassed: number
  delayedPassed: number
  approvalPassed: number
  customToolPassed: number
  interruptPassed: number
  failed: number
}

interface MixedRuntimeContext {
  companyDir: string
  agentId: string
  store: SessionStore
  wakeQueue: SessionWakeQueue
  journal: ActivationJournal
  timeoutMs: number
}

export async function runAgentScenarioMixedSoak(
  companyDir: string,
  options: ScenarioMixedSoakRunOptions = {},
): Promise<{
  agentId: string
  outputPath: string
  workers: number
  rounds: number
  immediateSessions: number
  delayedSessions: number
  approvalSessions: number
  customToolSessions: number
  interruptSessions: number
  blockedActivations: number
  immediatePassed: number
  delayedPassed: number
  approvalPassed: number
  customToolPassed: number
  interruptPassed: number
  failed: number
}> {
  const outputPath = resolve(companyDir, options.outputPath ?? DEFAULT_OUTPUT_PATH)
  const workers = clampPositiveInteger(options.workers, DEFAULT_WORKERS)
  const rounds = clampPositiveInteger(options.rounds, 1)
  const immediateSessions = clampPositiveInteger(
    options.immediateSessions,
    DEFAULT_IMMEDIATE_SESSIONS,
  )
  const delayedSessions = clampPositiveInteger(options.delayedSessions, DEFAULT_DELAYED_SESSIONS)
  const approvalSessions = clampPositiveInteger(options.approvalSessions, DEFAULT_APPROVAL_SESSIONS)
  const customToolSessions = clampPositiveInteger(
    options.customToolSessions,
    DEFAULT_CUSTOM_TOOL_SESSIONS,
  )
  const interruptSessions = clampPositiveInteger(
    options.interruptSessions,
    DEFAULT_INTERRUPT_SESSIONS,
  )
  const pollIntervalMs = clampPositiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
  const configuredModelTimeoutMs =
    typeof options.modelTimeoutMs === "number" && Number.isFinite(options.modelTimeoutMs)
      ? Math.max(1000, Math.floor(options.modelTimeoutMs))
      : 45_000
  const totalSessions =
    immediateSessions + delayedSessions + approvalSessions + customToolSessions + interruptSessions
  const timeoutMs = clampPositiveInteger(
    options.timeoutMs,
    computeDefaultMixedSoakTimeoutMs({
      modelTimeoutMs: configuredModelTimeoutMs,
      workers,
      totalSessions: totalSessions * rounds,
    }),
  )

  await ensureOpenboaSetup(companyDir)
  const agentId =
    options.agentId?.trim() && options.agentId.trim().length > 0
      ? options.agentId.trim()
      : `scenario-mixed-soak-${new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}`
  await ensureAgentConfig(companyDir, { agentId, provider: "openai-codex" })

  const auth = await new CodexAuthProvider(companyDir).resolve()
  if (auth.mode === "none" || !auth.token) {
    throw new Error(
      'Authentication is required for live mixed soak scenarios. Run "openboa auth login --provider openai-codex" first.',
    )
  }

  process.env.OPENBOA_MODEL_TIMEOUT_MS = String(configuredModelTimeoutMs)

  const store = new SessionStore(companyDir)
  const wakeQueue = new SessionWakeQueue(companyDir, store)
  const journal = new ActivationJournal(store)
  const ctx: MixedRuntimeContext = {
    companyDir,
    agentId,
    store,
    wakeQueue,
    journal,
    timeoutMs,
  }

  const workerController = new AbortController()
  const workerPromises = startWorkers(companyDir, agentId, workers, {
    pollIntervalMs,
    signal: workerController.signal,
  })

  try {
    const sessionSummaries: MixedSessionSummary[] = []
    for (let round = 1; round <= rounds; round += 1) {
      const sessionTasks = [
        ...Array.from({ length: immediateSessions }, (_value, index) =>
          runImmediateSession(ctx, round, index + 1),
        ),
        ...Array.from({ length: delayedSessions }, (_value, index) =>
          runDelayedSession(ctx, round, index + 1),
        ),
        ...Array.from({ length: approvalSessions }, (_value, index) =>
          runApprovalSession(ctx, round, index + 1),
        ),
        ...Array.from({ length: customToolSessions }, (_value, index) =>
          runCustomToolSession(ctx, round, index + 1),
        ),
        ...Array.from({ length: interruptSessions }, (_value, index) =>
          runInterruptSession(ctx, round, index + 1),
        ),
      ]
      sessionSummaries.push(...(await Promise.all(sessionTasks)))
    }
    workerController.abort()
    const workerResults = await Promise.all(workerPromises)

    const blockedActivations = (await journal.list(agentId)).filter(
      (record) => record.kind === "activation.blocked",
    ).length
    const immediatePassed = countKindPassed(sessionSummaries, "immediate")
    const delayedPassed = countKindPassed(sessionSummaries, "delayed")
    const approvalPassed = countKindPassed(sessionSummaries, "approval")
    const customToolPassed = countKindPassed(sessionSummaries, "custom_tool")
    const interruptPassed = countKindPassed(sessionSummaries, "interrupt")
    const failed = sessionSummaries.filter((summary) => !summary.passed).length

    await writeScenarioMixedSoakReport(outputPath, {
      agentId,
      workers,
      rounds,
      immediateSessions,
      delayedSessions,
      approvalSessions,
      customToolSessions,
      interruptSessions,
      blockedActivations,
      immediatePassed,
      delayedPassed,
      approvalPassed,
      customToolPassed,
      interruptPassed,
      failed,
      roundSummaries: buildMixedRoundSummaries(sessionSummaries),
      workerSummaries: workerResults.map((result, index) => ({
        worker: index + 1,
        cycles: result.cycles,
        executed: result.executed,
        stopReason: result.stopReason,
      })),
      sessionSummaries,
    })

    return {
      agentId,
      outputPath,
      workers,
      rounds,
      immediateSessions,
      delayedSessions,
      approvalSessions,
      customToolSessions,
      interruptSessions,
      blockedActivations,
      immediatePassed,
      delayedPassed,
      approvalPassed,
      customToolPassed,
      interruptPassed,
      failed,
    }
  } finally {
    workerController.abort()
  }
}

function startWorkers(
  companyDir: string,
  agentId: string,
  workers: number,
  options: {
    pollIntervalMs: number
    signal: AbortSignal
  },
): Promise<AgentOrchestratorLoopResult>[] {
  return Array.from({ length: workers }, () =>
    new AgentOrchestration(companyDir).runAgentLoop(agentId, {
      watch: true,
      stopWhenIdle: false,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
    }),
  )
}

async function runImmediateSession(
  ctx: MixedRuntimeContext,
  round: number,
  index: number,
): Promise<MixedSessionSummary> {
  const session = await ctx.store.createSession({ agentId: ctx.agentId })
  const token = `mixed-immediate-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}`
  const prompt = `What is your name? Reply with your exact agent name and include ${token}.`
  await emitUserMessage(ctx.store, session.id, prompt)

  return waitForScenarioSummary(ctx, round, session.id, "immediate", async (snapshot, records) => {
    const response = latestAgentMessage(snapshot.events)?.message ?? ""
    if (
      !allUserMessagesProcessed(snapshot.events) ||
      !response.includes(ctx.agentId) ||
      !response.includes(token)
    ) {
      return null
    }
    return {
      round,
      kind: "immediate",
      sessionId: session.id,
      passed: true,
      stopReason: snapshot.session.stopReason,
      immediateAckCount: countAcked(records, "pending_events"),
      delayedAckCount: countAcked(records, "queued_wake"),
      abandonedCount: countAbandoned(records),
      notes: [`echoed ${token}`],
      issue: null,
    }
  })
}

async function runDelayedSession(
  ctx: MixedRuntimeContext,
  round: number,
  index: number,
): Promise<MixedSessionSummary> {
  const session = await ctx.store.createSession({ agentId: ctx.agentId })
  const token = `mixed-delayed-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}`
  const reason = `mixed-delayed-revisit-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}`
  const prompt = `Reply with "scheduled" right now. When you are later resumed by a queued wake whose note contains ${token}, answer with the exact token ${token} and include the phrase "queued wake".`
  await emitOutcome(ctx.store, session.id, {
    title: `Handle delayed revisit ${token}`,
    detail: `Stay aligned around delayed token ${token}.`,
    successCriteria: [
      'Acknowledge the current turn with "scheduled".',
      `When resumed by a queued wake whose note contains ${token}, answer with the exact token ${token}.`,
      'Mention the phrase "queued wake" in the delayed revisit response.',
    ],
  })
  await emitUserMessage(ctx.store, session.id, prompt)

  await waitForCondition(
    async () => {
      const snapshot = await ctx.store.getSession(session.id)
      return allUserMessagesProcessed(snapshot.events) && countAgentMessages(snapshot.events) >= 1
        ? true
        : null
    },
    ctx.timeoutMs,
    `initial delayed phase for ${session.id}`,
  )

  await ctx.wakeQueue.enqueue({
    sessionId: session.id,
    dueAt: new Date(Date.now() + DEFAULT_DELAY_MS).toISOString(),
    reason,
    note: token,
    dedupeKey: `mixed-delayed-${session.id}`,
    priority: "normal",
  })

  return waitForScenarioSummary(ctx, round, session.id, "delayed", async (snapshot, records) => {
    const response = latestAgentMessage(snapshot.events)?.message ?? ""
    if (
      !response.includes(token) ||
      !response.toLowerCase().includes("queued wake") ||
      countAcked(records, "queued_wake") < 1
    ) {
      return null
    }
    return {
      round,
      kind: "delayed",
      sessionId: session.id,
      passed: true,
      stopReason: snapshot.session.stopReason,
      immediateAckCount: countAcked(records, "pending_events"),
      delayedAckCount: countAcked(records, "queued_wake"),
      abandonedCount: countAbandoned(records),
      notes: [`consumed delayed token ${token}`],
      issue: null,
    }
  })
}

async function runApprovalSession(
  ctx: MixedRuntimeContext,
  round: number,
  index: number,
): Promise<MixedSessionSummary> {
  const session = await ctx.store.createSession({ agentId: ctx.agentId })
  const fileName = `mixed-approval-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}.txt`
  const marker = `mixed-approval-marker-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}`
  const prompt = `Use shell_run in /workspace to create notes/${fileName} with exactly one line: ${marker}. Do not ask for plain-text confirmation; rely on the runtime confirmation flow if it is required.`
  await emitUserMessage(ctx.store, session.id, prompt)

  await waitForCondition(
    async () => {
      const snapshot = await ctx.store.getSession(session.id)
      return snapshot.session.stopReason === "requires_action" &&
        snapshot.session.pendingToolConfirmationRequest?.toolName === "shell_run"
        ? snapshot.session.pendingToolConfirmationRequest.id
        : null
    },
    ctx.timeoutMs,
    `approval pause for ${session.id}`,
  )

  await emitToolConfirmation(ctx.store, session.id, true, "approve mixed soak shell_run")

  return waitForScenarioSummary(ctx, round, session.id, "approval", async (snapshot, records) => {
    const written = await readSessionWorkspaceFile(ctx.companyDir, ctx.agentId, session.id, [
      "notes",
      fileName,
    ]).catch(() => null)
    if (
      snapshot.session.stopReason !== "idle" ||
      snapshot.session.pendingToolConfirmationRequest !== null ||
      written?.trim() !== marker
    ) {
      return null
    }
    return {
      round,
      kind: "approval",
      sessionId: session.id,
      passed: true,
      stopReason: snapshot.session.stopReason,
      immediateAckCount: countAcked(records, "pending_events"),
      delayedAckCount: countAcked(records, "queued_wake"),
      abandonedCount: countAbandoned(records),
      notes: [`wrote notes/${fileName}`],
      issue: null,
    }
  })
}

async function runCustomToolSession(
  ctx: MixedRuntimeContext,
  round: number,
  index: number,
): Promise<MixedSessionSummary> {
  const session = await ctx.store.createSession({ agentId: ctx.agentId })
  const toolName = `fetch_spec_r${String(round).padStart(2, "0")}_${String(index).padStart(2, "0")}`
  const token = `mixed-custom-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}`
  const prompt = `Do not answer directly. Pause and request a custom tool result named ${toolName} with input ${JSON.stringify({ token })}.`
  await emitUserMessage(ctx.store, session.id, prompt)

  await waitForCondition(
    async () => {
      const snapshot = await ctx.store.getSession(session.id)
      return snapshot.session.stopReason === "requires_action" &&
        snapshot.session.pendingCustomToolRequest?.name === toolName
        ? snapshot.session.pendingCustomToolRequest.id
        : null
    },
    ctx.timeoutMs,
    `custom tool pause for ${session.id}`,
  )

  await emitCustomToolResult(
    ctx.store,
    session.id,
    `# Mixed Spec\n- Token: ${token}\n- Goal: Keep custom tool execution explicit.`,
  )

  return waitForScenarioSummary(
    ctx,
    round,
    session.id,
    "custom_tool",
    async (snapshot, records) => {
      const response = latestAgentMessage(snapshot.events)?.message ?? ""
      if (
        snapshot.session.stopReason !== "idle" ||
        snapshot.session.pendingCustomToolRequest !== null ||
        !response.includes(token)
      ) {
        return null
      }
      return {
        round,
        kind: "custom_tool",
        sessionId: session.id,
        passed: true,
        stopReason: snapshot.session.stopReason,
        immediateAckCount: countAcked(records, "pending_events"),
        delayedAckCount: countAcked(records, "queued_wake"),
        abandonedCount: countAbandoned(records),
        notes: [`completed ${toolName}`],
        issue: null,
      }
    },
  )
}

async function runInterruptSession(
  ctx: MixedRuntimeContext,
  round: number,
  index: number,
): Promise<MixedSessionSummary> {
  const session = await ctx.store.createSession({ agentId: ctx.agentId })
  const fileName = `mixed-interrupt-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}.txt`
  const marker = `mixed-interrupt-marker-r${String(round).padStart(2, "0")}-${String(index).padStart(2, "0")}`
  const prompt = `Use shell_run in /workspace to create notes/${fileName} with exactly one line: ${marker}. Do not ask for plain-text confirmation; rely on the runtime confirmation flow if it is required.`
  await emitUserMessage(ctx.store, session.id, prompt)

  await waitForCondition(
    async () => {
      const snapshot = await ctx.store.getSession(session.id)
      return snapshot.session.stopReason === "requires_action" &&
        snapshot.session.pendingToolConfirmationRequest?.toolName === "shell_run"
        ? snapshot.session.pendingToolConfirmationRequest.id
        : null
    },
    ctx.timeoutMs,
    `interrupt pause for ${session.id}`,
  )

  await emitInterrupt(
    ctx.store,
    session.id,
    "cancel the blocked shell write and continue without it",
  )
  await emitUserMessage(
    ctx.store,
    session.id,
    "Continue without the old blocked command. Confirm that no file change was made.",
  )

  return waitForScenarioSummary(ctx, round, session.id, "interrupt", async (snapshot, records) => {
    const written = await readSessionWorkspaceFile(ctx.companyDir, ctx.agentId, session.id, [
      "notes",
      fileName,
    ]).catch(() => null)
    if (
      snapshot.session.stopReason !== "idle" ||
      snapshot.session.pendingToolConfirmationRequest !== null ||
      written !== null
    ) {
      return null
    }
    return {
      round,
      kind: "interrupt",
      sessionId: session.id,
      passed: true,
      stopReason: snapshot.session.stopReason,
      immediateAckCount: countAcked(records, "pending_events"),
      delayedAckCount: countAcked(records, "queued_wake"),
      abandonedCount: countAbandoned(records),
      notes: ["interrupt cleared blocked approval before write"],
      issue: null,
    }
  })
}

async function waitForScenarioSummary(
  ctx: MixedRuntimeContext,
  round: number,
  sessionId: string,
  kind: MixedSessionKind,
  predicate: (
    snapshot: SessionSnapshot,
    records: ActivationJournalRecord[],
  ) => Promise<MixedSessionSummary | null>,
): Promise<MixedSessionSummary> {
  try {
    return await waitForCondition(
      async () => {
        const [snapshot, records] = await Promise.all([
          ctx.store.getSession(sessionId),
          ctx.journal.listForSession(ctx.agentId, sessionId),
        ])
        return predicate(snapshot, records)
      },
      ctx.timeoutMs,
      `${kind} session ${sessionId}`,
    )
  } catch (error) {
    const [snapshot, records] = await Promise.all([
      ctx.store.getSession(sessionId),
      ctx.journal.listForSession(ctx.agentId, sessionId),
    ])
    return {
      round,
      kind,
      sessionId,
      passed: false,
      stopReason: snapshot.session.stopReason,
      immediateAckCount: countAcked(records, "pending_events"),
      delayedAckCount: countAcked(records, "queued_wake"),
      abandonedCount: countAbandoned(records),
      notes: [],
      issue: error instanceof Error ? error.message : String(error),
    }
  }
}

async function waitForCondition<T>(
  fn: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: string | null = null
  while (Date.now() <= deadline) {
    try {
      const value = await fn()
      if (value !== null) {
        return value
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(100)
  }
  throw new Error(lastError ? `${label} timed out: ${lastError}` : `${label} timed out`)
}

async function emitUserMessage(
  store: SessionStore,
  sessionId: string,
  message: string,
): Promise<void> {
  await store.emitEvent(sessionId, {
    id: makeUuidV7(),
    type: "user.message",
    createdAt: nowIsoString(),
    processedAt: null,
    message,
  })
}

async function emitOutcome(
  store: SessionStore,
  sessionId: string,
  outcome: SessionOutcomeDefinition,
): Promise<void> {
  await store.emitEvent(sessionId, {
    id: makeUuidV7(),
    type: "user.define_outcome",
    createdAt: nowIsoString(),
    processedAt: null,
    outcome,
  })
}

async function emitToolConfirmation(
  store: SessionStore,
  sessionId: string,
  allowed: boolean,
  note: string,
): Promise<void> {
  const snapshot = await store.getSession(sessionId)
  const request = snapshot.session.pendingToolConfirmationRequest
  if (!request) {
    throw new Error(`Session ${sessionId} does not have a pending tool confirmation request`)
  }
  await store.emitEvent(sessionId, {
    id: makeUuidV7(),
    type: "user.tool_confirmation",
    createdAt: nowIsoString(),
    processedAt: null,
    requestId: request.id,
    toolName: request.toolName,
    allowed,
    note,
  })
}

async function emitCustomToolResult(
  store: SessionStore,
  sessionId: string,
  output: string,
): Promise<void> {
  const snapshot = await store.getSession(sessionId)
  const request = snapshot.session.pendingCustomToolRequest
  if (!request) {
    throw new Error(`Session ${sessionId} does not have a pending custom tool request`)
  }
  await store.emitEvent(sessionId, {
    id: makeUuidV7(),
    type: "user.custom_tool_result",
    createdAt: nowIsoString(),
    processedAt: null,
    requestId: request.id,
    toolName: request.name,
    output,
  })
}

async function emitInterrupt(store: SessionStore, sessionId: string, note: string): Promise<void> {
  await store.emitEvent(sessionId, {
    id: makeUuidV7(),
    type: "user.interrupt",
    createdAt: nowIsoString(),
    processedAt: null,
    note,
  })
}

function latestAgentMessage(events: SessionEvent[]): { message: string } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === "agent.message") {
      return { message: event.message }
    }
  }
  return null
}

function allUserMessagesProcessed(events: SessionEvent[]): boolean {
  const userMessages = events.filter((event) => event.type === "user.message")
  return userMessages.length > 0 && userMessages.every((event) => event.processedAt !== null)
}

function countAgentMessages(events: SessionEvent[]): number {
  return events.filter((event) => event.type === "agent.message").length
}

function countAcked(
  records: ActivationJournalRecord[],
  activationKind: "pending_events" | "queued_wake",
): number {
  return records.filter(
    (record) => record.kind === "activation.acked" && record.activationKind === activationKind,
  ).length
}

function countAbandoned(records: ActivationJournalRecord[]): number {
  return records.filter((record) => record.kind === "activation.abandoned").length
}

function countKindPassed(summaries: MixedSessionSummary[], kind: MixedSessionKind): number {
  return summaries.filter((summary) => summary.kind === kind && summary.passed).length
}

async function readSessionWorkspaceFile(
  companyDir: string,
  agentId: string,
  sessionId: string,
  relativeParts: string[],
): Promise<string> {
  return readFile(
    join(
      companyDir,
      ".openboa",
      "agents",
      agentId,
      "sessions",
      sessionId,
      "workspace",
      ...relativeParts,
    ),
    "utf8",
  )
}

async function writeScenarioMixedSoakReport(
  outputPath: string,
  summary: {
    agentId: string
    workers: number
    rounds: number
    immediateSessions: number
    delayedSessions: number
    approvalSessions: number
    customToolSessions: number
    interruptSessions: number
    blockedActivations: number
    immediatePassed: number
    delayedPassed: number
    approvalPassed: number
    customToolPassed: number
    interruptPassed: number
    failed: number
    roundSummaries: MixedRoundSummary[]
    workerSummaries: MixedWorkerSummary[]
    sessionSummaries: MixedSessionSummary[]
  },
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  const lines = [
    "# Agent Scenario Mixed Soak",
    "",
    `- Agent: ${summary.agentId}`,
    `- Workers: ${String(summary.workers)}`,
    `- Rounds: ${String(summary.rounds)}`,
    `- Immediate Sessions: ${String(summary.immediateSessions)}`,
    `- Delayed Sessions: ${String(summary.delayedSessions)}`,
    `- Approval Sessions: ${String(summary.approvalSessions)}`,
    `- Custom Tool Sessions: ${String(summary.customToolSessions)}`,
    `- Interrupt Sessions: ${String(summary.interruptSessions)}`,
    `- Blocked Activations: ${String(summary.blockedActivations)}`,
    `- Immediate Passed: ${String(summary.immediatePassed)}`,
    `- Delayed Passed: ${String(summary.delayedPassed)}`,
    `- Approval Passed: ${String(summary.approvalPassed)}`,
    `- Custom Tool Passed: ${String(summary.customToolPassed)}`,
    `- Interrupt Passed: ${String(summary.interruptPassed)}`,
    `- Failed: ${String(summary.failed)}`,
    "",
    "## Rounds",
    ...summary.roundSummaries.map(
      (round) =>
        `- round=${String(round.round)} immediatePassed=${String(round.immediatePassed)} delayedPassed=${String(round.delayedPassed)} approvalPassed=${String(round.approvalPassed)} customToolPassed=${String(round.customToolPassed)} interruptPassed=${String(round.interruptPassed)} failed=${String(round.failed)}`,
    ),
    "",
    "## Workers",
    ...summary.workerSummaries.map(
      (worker) =>
        `- worker=${String(worker.worker)} stopReason=${worker.stopReason} cycles=${String(worker.cycles)} executed=${String(worker.executed)}`,
    ),
    "",
    "## Sessions",
    ...summary.sessionSummaries.map(
      (session) =>
        `- round=${String(session.round)} kind=${session.kind} session=${session.sessionId} passed=${String(session.passed)} stopReason=${session.stopReason} immediateAckCount=${String(session.immediateAckCount)} delayedAckCount=${String(session.delayedAckCount)} abandonedCount=${String(session.abandonedCount)} notes=${session.notes.join(" | ") || "none"} issue=${session.issue ?? "none"}`,
    ),
    "",
  ]
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8")
  await writeFile(`${outputPath}.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(1, Math.floor(value))
}

function computeDefaultMixedSoakTimeoutMs(input: {
  modelTimeoutMs: number
  workers: number
  totalSessions: number
}): number {
  const waves = Math.max(1, Math.ceil(input.totalSessions / Math.max(1, input.workers)))
  return Math.max(
    DEFAULT_TIMEOUT_MS,
    input.modelTimeoutMs * 2,
    input.modelTimeoutMs + waves * 5_000,
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function buildMixedRoundSummaries(summaries: MixedSessionSummary[]): MixedRoundSummary[] {
  const rounds = new Map<number, MixedRoundSummary>()
  for (const summary of summaries) {
    const current = rounds.get(summary.round) ?? {
      round: summary.round,
      immediatePassed: 0,
      delayedPassed: 0,
      approvalPassed: 0,
      customToolPassed: 0,
      interruptPassed: 0,
      failed: 0,
    }
    if (!summary.passed) {
      current.failed += 1
    } else {
      switch (summary.kind) {
        case "immediate":
          current.immediatePassed += 1
          break
        case "delayed":
          current.delayedPassed += 1
          break
        case "approval":
          current.approvalPassed += 1
          break
        case "custom_tool":
          current.customToolPassed += 1
          break
        case "interrupt":
          current.interruptPassed += 1
          break
      }
    }
    rounds.set(summary.round, current)
  }
  return [...rounds.values()].sort((left, right) => left.round - right.round)
}
