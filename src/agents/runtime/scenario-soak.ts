import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { makeUuidV7 } from "../../foundation/ids.js"
import { nowIsoString } from "../../foundation/time.js"
import { CodexAuthProvider } from "../auth/codex-auth.js"
import type { SessionEvent } from "../schema/runtime.js"
import { SessionStore } from "../sessions/session-store.js"
import { ensureAgentConfig, ensureOpenboaSetup } from "../setup.js"
import { ActivationJournal, type ActivationJournalRecord } from "./activation-journal.js"
import { AgentOrchestration, type AgentOrchestratorLoopResult } from "./orchestration.js"
import { SessionWakeQueue } from "./session-wake-queue.js"

const DEFAULT_OUTPUT_PATH = "AGENT_SCENARIO_SOAK.md"
const DEFAULT_WORKERS = 3
const DEFAULT_SESSIONS = 6
const DEFAULT_DELAYED_SESSIONS = 3
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_IDLE_TIMEOUT_MS = 4_000

interface ScenarioSoakRunOptions {
  agentId?: string
  outputPath?: string
  workers?: number
  sessions?: number
  delayedSessions?: number
  modelTimeoutMs?: number
  pollIntervalMs?: number
  idleTimeoutMs?: number
}

interface SoakSessionSummary {
  sessionId: string
  immediateProcessed: boolean
  immediateAgentMessages: number
  immediateAckCount: number
  delayedAckCount: number
  abandonedCount: number
}

interface SoakWorkerSummary {
  phase: "immediate" | "delayed"
  worker: number
  cycles: number
  executed: number
  stopReason: AgentOrchestratorLoopResult["stopReason"]
}

export async function runAgentScenarioSoak(
  companyDir: string,
  options: ScenarioSoakRunOptions = {},
): Promise<{
  agentId: string
  outputPath: string
  workers: number
  sessions: number
  delayedSessions: number
  blockedActivations: number
  immediatePassed: number
  delayedPassed: number
  failed: number
}> {
  const outputPath = resolve(companyDir, options.outputPath ?? DEFAULT_OUTPUT_PATH)
  const workers = clampPositiveInteger(options.workers, DEFAULT_WORKERS)
  const sessions = clampPositiveInteger(options.sessions, DEFAULT_SESSIONS)
  const delayedSessions = Math.min(
    sessions,
    clampPositiveInteger(options.delayedSessions, DEFAULT_DELAYED_SESSIONS),
  )
  const pollIntervalMs = clampPositiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
  const idleTimeoutMs = clampPositiveInteger(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS)

  await ensureOpenboaSetup(companyDir)
  const agentId =
    options.agentId?.trim() && options.agentId.trim().length > 0
      ? options.agentId.trim()
      : `scenario-soak-${new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}`
  await ensureAgentConfig(companyDir, { agentId, provider: "openai-codex" })

  const auth = await new CodexAuthProvider(companyDir).resolve()
  if (auth.mode === "none" || !auth.token) {
    throw new Error(
      'Authentication is required for live agent soak scenarios. Run "openboa auth login --provider openai-codex" first.',
    )
  }

  if (typeof options.modelTimeoutMs === "number" && Number.isFinite(options.modelTimeoutMs)) {
    process.env.OPENBOA_MODEL_TIMEOUT_MS = String(
      Math.max(1000, Math.floor(options.modelTimeoutMs)),
    )
  }

  const store = new SessionStore(companyDir)
  const wakeQueue = new SessionWakeQueue(companyDir, store)
  const journal = new ActivationJournal(store)

  const createdSessions = await Promise.all(
    Array.from({ length: sessions }, async (_value, index) => ({
      index: index + 1,
      session: await store.createSession({ agentId }),
    })),
  )

  const immediateWorkers = runWorkers(companyDir, agentId, workers, "immediate", {
    pollIntervalMs,
    idleTimeoutMs,
  })
  await sleep(150)
  await Promise.all(
    createdSessions.map(({ session, index }) =>
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.message",
        createdAt: nowIsoString(),
        processedAt: null,
        message: `What is your name? [soak-immediate-${String(index)}]`,
      }),
    ),
  )
  const immediateWorkerResults = await Promise.all(immediateWorkers)

  const immediateSessionSummaries = await Promise.all(
    createdSessions.map(async ({ session }) =>
      inspectSessionSummary({
        store,
        journal,
        agentId,
        sessionId: session.id,
        delayedReason: null,
      }),
    ),
  )

  const delayedTargets = createdSessions.slice(0, delayedSessions)
  const delayedWorkers = runWorkers(companyDir, agentId, workers, "delayed", {
    pollIntervalMs,
    idleTimeoutMs,
  })
  await sleep(150)
  await Promise.all(
    delayedTargets.map(({ session, index }) =>
      wakeQueue.enqueue({
        sessionId: session.id,
        dueAt: new Date(Date.now() + 250).toISOString(),
        reason: delayedReasonToken(index + 1),
        note: `soak delayed revisit ${String(index + 1)}`,
        dedupeKey: `soak-delayed-${session.id}`,
        priority: "normal",
      }),
    ),
  )
  const delayedWorkerResults = await Promise.all(delayedWorkers)

  const delayedSessionSummaries = await Promise.all(
    delayedTargets.map(async ({ session, index }) =>
      inspectSessionSummary({
        store,
        journal,
        agentId,
        sessionId: session.id,
        delayedReason: delayedReasonToken(index + 1),
      }),
    ),
  )
  const mergedSessionSummaries = mergeSessionSummaries(
    immediateSessionSummaries,
    delayedSessionSummaries,
  )

  const blockedActivations = (await journal.list(agentId)).filter(
    (record) => record.kind === "activation.blocked",
  ).length
  const immediatePassed = immediateSessionSummaries.filter(
    (summary) => summary.immediateProcessed,
  ).length
  const delayedPassed = delayedSessionSummaries.filter(
    (summary) => summary.delayedAckCount >= 1,
  ).length
  const failed =
    immediateSessionSummaries.filter((summary) => !summary.immediateProcessed).length +
    delayedSessionSummaries.filter((summary) => summary.delayedAckCount < 1).length +
    delayedSessionSummaries.filter((summary) => summary.abandonedCount > 0).length

  const workerSummaries = [
    ...immediateWorkerResults.map((result, index) => ({
      phase: "immediate" as const,
      worker: index + 1,
      ...result,
    })),
    ...delayedWorkerResults.map((result, index) => ({
      phase: "delayed" as const,
      worker: index + 1,
      ...result,
    })),
  ]

  await writeScenarioSoakReport(outputPath, {
    agentId,
    workers,
    sessions,
    delayedSessions,
    blockedActivations,
    immediatePassed,
    delayedPassed,
    failed,
    workerSummaries,
    sessionSummaries: mergedSessionSummaries,
  })

  return {
    agentId,
    outputPath,
    workers,
    sessions,
    delayedSessions,
    blockedActivations,
    immediatePassed,
    delayedPassed,
    failed,
  }
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(1, Math.floor(value))
}

function delayedReasonToken(index: number): string {
  return `soak-delayed-${String(index)}`
}

async function inspectSessionSummary(input: {
  store: SessionStore
  journal: ActivationJournal
  agentId: string
  sessionId: string
  delayedReason: string | null
}): Promise<SoakSessionSummary> {
  const [snapshot, journalRecords] = await Promise.all([
    input.store.getSession(input.sessionId),
    input.journal.listForSession(input.agentId, input.sessionId),
  ])
  const immediateProcessed =
    snapshot.events.filter((event) => event.type === "user.message").length === 1 &&
    snapshot.events
      .filter(
        (event): event is Extract<SessionEvent, { type: "user.message" }> =>
          event.type === "user.message",
      )
      .every((event) => event.processedAt !== null)

  const immediateAgentMessages = snapshot.events.filter(
    (event) => event.type === "agent.message",
  ).length
  const immediateAckCount = countAcked(journalRecords, "pending_events")
  const delayedAckCount =
    input.delayedReason === null
      ? 0
      : journalRecords.filter(
          (record) =>
            record.kind === "activation.acked" &&
            record.activationKind === "queued_wake" &&
            record.reason === input.delayedReason,
        ).length
  const abandonedCount = journalRecords.filter(
    (record) => record.kind === "activation.abandoned",
  ).length

  return {
    sessionId: input.sessionId,
    immediateProcessed:
      immediateProcessed && immediateAckCount === 1 && immediateAgentMessages >= 1,
    immediateAgentMessages,
    immediateAckCount,
    delayedAckCount,
    abandonedCount,
  }
}

function countAcked(
  records: ActivationJournalRecord[],
  activationKind: "pending_events" | "queued_wake",
): number {
  return records.filter(
    (record) => record.kind === "activation.acked" && record.activationKind === activationKind,
  ).length
}

function runWorkers(
  companyDir: string,
  agentId: string,
  workers: number,
  _phase: "immediate" | "delayed",
  options: {
    pollIntervalMs: number
    idleTimeoutMs: number
  },
): Promise<AgentOrchestratorLoopResult>[] {
  return Array.from({ length: workers }, () =>
    new AgentOrchestration(companyDir).runAgentLoop(agentId, {
      watch: true,
      stopWhenIdle: false,
      pollIntervalMs: options.pollIntervalMs,
      idleTimeoutMs: options.idleTimeoutMs,
    }),
  )
}

async function writeScenarioSoakReport(
  outputPath: string,
  summary: {
    agentId: string
    workers: number
    sessions: number
    delayedSessions: number
    blockedActivations: number
    immediatePassed: number
    delayedPassed: number
    failed: number
    workerSummaries: SoakWorkerSummary[]
    sessionSummaries: SoakSessionSummary[]
  },
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  const lines = [
    "# Agent Scenario Soak",
    "",
    `- Agent: ${summary.agentId}`,
    `- Workers: ${String(summary.workers)}`,
    `- Sessions: ${String(summary.sessions)}`,
    `- Delayed Sessions: ${String(summary.delayedSessions)}`,
    `- Blocked Activations: ${String(summary.blockedActivations)}`,
    `- Immediate Passed: ${String(summary.immediatePassed)}`,
    `- Delayed Passed: ${String(summary.delayedPassed)}`,
    `- Failed: ${String(summary.failed)}`,
    "",
    "## Workers",
    ...summary.workerSummaries.map(
      (worker) =>
        `- phase=${worker.phase} worker=${String(worker.worker)} stopReason=${worker.stopReason} cycles=${String(worker.cycles)} executed=${String(worker.executed)}`,
    ),
    "",
    "## Sessions",
    ...summary.sessionSummaries.map(
      (session) =>
        `- session=${session.sessionId} immediateProcessed=${String(session.immediateProcessed)} immediateAgentMessages=${String(session.immediateAgentMessages)} immediateAckCount=${String(session.immediateAckCount)} delayedAckCount=${String(session.delayedAckCount)} abandonedCount=${String(session.abandonedCount)}`,
    ),
    "",
  ]
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8")
  await writeFile(`${outputPath}.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
}

function mergeSessionSummaries(
  immediate: SoakSessionSummary[],
  delayed: SoakSessionSummary[],
): SoakSessionSummary[] {
  const delayedBySessionId = new Map(
    delayed.map((summary) => [summary.sessionId, summary] as const),
  )
  return immediate.map((summary) => {
    const delayedSummary = delayedBySessionId.get(summary.sessionId)
    if (!delayedSummary) {
      return summary
    }
    return {
      sessionId: summary.sessionId,
      immediateProcessed: summary.immediateProcessed,
      immediateAgentMessages: Math.max(
        summary.immediateAgentMessages,
        delayedSummary.immediateAgentMessages,
      ),
      immediateAckCount: summary.immediateAckCount,
      delayedAckCount: delayedSummary.delayedAckCount,
      abandonedCount: delayedSummary.abandonedCount,
    }
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
