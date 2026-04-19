import { readdir } from "node:fs/promises"
import { loadAgentConfig } from "./agents/agent-config.js"
import { loadAgentDefinition } from "./agents/agent-definition.js"
import {
  ensureClaudeCliAvailable,
  runClaudeCliLoginCommand,
} from "./agents/auth/claude-cli-auth.js"
import { CodexAuthProvider } from "./agents/auth/codex-auth.js"
import { runCodexOauthLoginAndSync } from "./agents/auth/codex-oauth-login.js"
import { type AuthTarget, resolveAuthTargets } from "./agents/auth/provider-auth-plan.js"
import { loadBootstrapConfig } from "./agents/environment/bootstrap.js"
import { EnvironmentStore } from "./agents/environment/environment-store.js"
import type { AgentProviderId } from "./agents/providers/provider-capabilities.js"
import { listStagedSubstrateDrafts } from "./agents/resources/resource-access.js"
import {
  ActivationJournal,
  type ActivationJournalRecord,
} from "./agents/runtime/activation-journal.js"
import { AgentOrchestration } from "./agents/runtime/orchestration.js"
import { runAgentScenarioLoop } from "./agents/runtime/scenario-loop.js"
import { runAgentScenarioMixedSoak } from "./agents/runtime/scenario-mixed-soak.js"
import { runAgentScenarioSoak } from "./agents/runtime/scenario-soak.js"
import { SessionWakeQueue } from "./agents/runtime/session-wake-queue.js"
import type { SessionEvent } from "./agents/schema/runtime.js"
import { SessionStore } from "./agents/sessions/session-store.js"
import { ensureAgentConfig, ensureOpenboaSetupWithOptions } from "./agents/setup.js"
import { chatUsageLines, runChatCli } from "./chat/cli/adapter.js"
import { ChatCommandService } from "./chat/policy/command-service.js"
import { makeUuidV7 } from "./foundation/ids.js"
import { nowIsoString } from "./foundation/time.js"

export const OPENBOA_VERSION = "0.3.0"

interface ParsedArgs {
  positionals: string[]
  options: Record<string, string>
}

function usageLines(): string[] {
  return [
    `openboa ${OPENBOA_VERSION}`,
    "",
    "Commands:",
    "  openboa setup [--default-provider <openai-codex|claude-cli>] [--auth <codex|claude-cli|both>]",
    "  openboa auth login [--provider <codex|openai-codex|claude-cli|both>]",
    "  openboa auth status",
    "  openboa agent spawn --name <agent-id> [--provider <openai-codex|claude-cli>]",
    "  openboa agent list",
    "  openboa agent session create --name <agent-id> [--environment <environment-id>]",
    "  openboa agent session send --session <session-id> --message <text>",
    "  openboa agent session interrupt --session <session-id> [--note <text>]",
    "  openboa agent session confirm-tool --session <session-id> [--request <request-id>] --allowed <true|false> [--note <text>]",
    "  openboa agent session custom-tool-result --session <session-id> [--request <request-id>] --output <text>",
    "  openboa agent session status --session <session-id>",
    "  openboa agent session events --session <session-id> [--limit <n>]",
    "  openboa agent activation-events --agent <agent-id> [--session <session-id>] [--claim <claim-id>] [--kind <activation.leased|activation.blocked|activation.acked|activation.requeued|activation.abandoned>[,...]] [--limit <n>]",
    "  openboa agent wake --session <session-id>",
    "  openboa agent orchestrator --agent <agent-id> [--watch] [--log] [--stop-when-idle] [--max-cycles <n>] [--poll-interval-ms <n>] [--idle-timeout-ms <n|0>]",
    "  openboa agent scenario-loop [--agent <agent-id>] [--suite <curated|full>] [--count <n>] [--output <path>] [--model-timeout-ms <n>]",
    "  openboa agent scenario-soak [--agent <agent-id>] [--workers <n>] [--sessions <n>] [--delayed-sessions <n>] [--output <path>] [--model-timeout-ms <n>]",
    "  openboa agent scenario-mixed-soak [--agent <agent-id>] [--workers <n>] [--rounds <n>] [--immediate-sessions <n>] [--delayed-sessions <n>] [--approval-sessions <n>] [--custom-tool-sessions <n>] [--interrupt-sessions <n>] [--output <path>] [--model-timeout-ms <n>]",
    ...chatUsageLines(),
    "  openboa admin bootstrap [--subject-id <actor-id>]",
  ]
}

function usage(): void {
  process.stdout.write(`${usageLines().join("\n")}\n`)
}

function parseArgs(rawArgs: string[]): ParsedArgs {
  const positionals: string[] = []
  const options: Record<string, string> = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const key = arg.slice(2)
    const next = rawArgs[index + 1]
    if (next && !next.startsWith("--")) {
      options[key] = next
      index += 1
      continue
    }

    options[key] = "true"
  }

  return { positionals, options }
}

function normalizeProviderOption(provider: string | undefined): AgentProviderId {
  if (!provider?.trim()) {
    return "openai-codex"
  }
  return provider === "claude" || provider === "claude-code" || provider === "claude-cli"
    ? "claude-cli"
    : "openai-codex"
}

const VALID_ACTIVATION_EVENT_KINDS = new Set<ActivationJournalRecord["kind"]>([
  "activation.leased",
  "activation.blocked",
  "activation.acked",
  "activation.requeued",
  "activation.abandoned",
])

function parseActivationEventKinds(
  rawKinds: string | undefined,
): ActivationJournalRecord["kind"][] | undefined {
  if (!rawKinds?.trim()) {
    return undefined
  }
  const values = rawKinds
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ActivationJournalRecord["kind"] => value.length > 0)
  if (values.length === 0) {
    return undefined
  }
  for (const value of values) {
    if (!VALID_ACTIVATION_EVENT_KINDS.has(value)) {
      throw new Error(`invalid activation event kind: ${value}`)
    }
  }
  return values
}

function authTargetsToBootstrapProviders(targets: AuthTarget[]): Array<"codex" | "claude-cli"> {
  return Array.from(new Set(targets))
}

async function runAuthLogin(provider: string | undefined): Promise<void> {
  const bootstrap = await loadBootstrapConfig(process.cwd())
  const targets = resolveAuthTargets(provider, bootstrap.defaultProvider)
  const messages: string[] = []

  if (targets.includes("codex")) {
    const result = await runCodexOauthLoginAndSync(process.cwd())
    messages.push(`codex auth synced: ${result.oauthPath}`)
  }
  if (targets.includes("claude-cli")) {
    const result = await runClaudeCliLoginCommand()
    messages.push(`claude auth complete via: ${result.command}`)
  }

  process.stdout.write(`${messages.join("\n")}\n`)
}

async function runAuthStatus(): Promise<void> {
  const bootstrap = await loadBootstrapConfig(process.cwd())
  const codexAuth = await new CodexAuthProvider(process.cwd()).resolve()
  let claudeAvailable = false
  try {
    await ensureClaudeCliAvailable()
    claudeAvailable = true
  } catch {
    claudeAvailable = false
  }

  process.stdout.write(
    `${[
      "openboa auth status",
      `- default provider: ${bootstrap.defaultProvider}`,
      `- codex auth: ${codexAuth.mode}`,
      `- claude cli: ${claudeAvailable ? "available" : "missing"}`,
    ].join("\n")}\n`,
  )
}

async function runSetup(options: Record<string, string>): Promise<void> {
  const defaultProvider = normalizeProviderOption(options["default-provider"] ?? options.provider)
  const authTargets = resolveAuthTargets(options.auth, defaultProvider)
  const result = await ensureOpenboaSetupWithOptions(process.cwd(), {
    defaultProvider,
    authProviders: authTargetsToBootstrapProviders(authTargets),
  })

  const authMessages: string[] = []
  if (authTargets.includes("codex")) {
    const synced = await runCodexOauthLoginAndSync(process.cwd())
    authMessages.push(`- codex auth synced: ${synced.oauthPath}`)
  }
  if (authTargets.includes("claude-cli")) {
    const login = await runClaudeCliLoginCommand()
    authMessages.push(`- claude auth complete via: ${login.command}`)
  }

  process.stdout.write(
    `${[
      "openboa setup complete",
      `- company: ${result.companyDir}`,
      `- default provider: ${result.bootstrapConfig.defaultProvider}`,
      `- auth plan: ${(result.bootstrapConfig.authProviders ?? []).join(", ") || "none"}`,
      ...authMessages,
    ].join("\n")}\n`,
  )
}

async function runAgentSpawn(options: Record<string, string>): Promise<void> {
  const agentId = options.name
  if (!agentId) {
    throw new Error("agent spawn requires --name <agent-id>")
  }
  const provider = options.provider ? normalizeProviderOption(options.provider) : undefined
  const result = await ensureAgentConfig(process.cwd(), {
    agentId,
    provider,
  })
  process.stdout.write(`${result.created ? "created" : "exists"}: ${result.configPath}\n`)
}

async function runAgentList(): Promise<void> {
  const entries = await readdir(`${process.cwd()}/.openboa/agents`, {
    withFileTypes: true,
  }).catch(() => [])
  const agentIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  if (agentIds.length === 0) {
    process.stdout.write("agent list: (empty)\n")
    return
  }

  const sessionStore = new SessionStore(process.cwd())
  process.stdout.write("agent list:\n")
  for (const agentId of agentIds) {
    const definition = await loadAgentDefinition(process.cwd(), agentId)
    const sessions = await sessionStore.listAgentSessions(agentId)
    process.stdout.write(
      `- ${definition.agentId} provider=${definition.provider} model=${definition.model} runner=${definition.runner} sessions=${sessions.length}\n`,
    )
  }
}

async function runAgentSessionCreate(input: {
  agentId: string
  environmentId?: string
}): Promise<void> {
  await ensureAgentConfig(process.cwd(), {
    agentId: input.agentId,
  })
  const environments = new EnvironmentStore(process.cwd())
  const environmentId =
    input.environmentId ?? (await environments.ensureDefaultLocalEnvironment()).id
  const environment = await environments.getEnvironment(environmentId)
  if (!environment) {
    throw new Error(`environment ${environmentId} was not found`)
  }

  const session = await new SessionStore(process.cwd()).createSession({
    agentId: input.agentId,
    environmentId: environment.id,
  })
  process.stdout.write(
    `${[
      "session created",
      `- session: ${session.id}`,
      `- agent: ${session.agentId}`,
      `- environment: ${session.environmentId}`,
      `- status: ${session.status}`,
    ].join("\n")}\n`,
  )
}

async function runAgentSessionSend(input: { sessionId: string; message: string }): Promise<void> {
  const message = input.message.trim()
  if (!message) {
    throw new Error("agent session send requires a non-empty message")
  }
  const store = new SessionStore(process.cwd())
  await store.emitEvent(input.sessionId, {
    id: makeUuidV7(),
    type: "user.message",
    createdAt: nowIsoString(),
    processedAt: null,
    message,
  })
  process.stdout.write(
    `${["session event appended", `- session: ${input.sessionId}`, "- event: user.message"].join(
      "\n",
    )}\n`,
  )
}

async function runAgentSessionInterrupt(input: {
  sessionId: string
  note?: string
}): Promise<void> {
  const store = new SessionStore(process.cwd())
  await store.emitEvent(input.sessionId, {
    id: makeUuidV7(),
    type: "user.interrupt",
    createdAt: nowIsoString(),
    processedAt: null,
    note: input.note?.trim() ? input.note.trim() : null,
  })
  process.stdout.write(
    `${["session event appended", `- session: ${input.sessionId}`, "- event: user.interrupt"].join(
      "\n",
    )}\n`,
  )
}

async function runAgentSessionConfirmTool(input: {
  sessionId: string
  requestId?: string
  allowed: boolean
  note?: string
}): Promise<void> {
  const store = new SessionStore(process.cwd())
  const snapshot = await store.getSession(input.sessionId)
  const request =
    snapshot.session.pendingToolConfirmationRequest &&
    (!input.requestId || input.requestId === snapshot.session.pendingToolConfirmationRequest.id)
      ? snapshot.session.pendingToolConfirmationRequest
      : null

  if (!request) {
    throw new Error("agent session confirm-tool requires a pending tool confirmation request")
  }

  await store.emitEvent(input.sessionId, {
    id: makeUuidV7(),
    type: "user.tool_confirmation",
    createdAt: nowIsoString(),
    processedAt: null,
    requestId: request.id,
    toolName: request.toolName,
    allowed: input.allowed,
    note: input.note?.trim() ? input.note.trim() : null,
  })

  process.stdout.write(
    `${[
      "session event appended",
      `- session: ${input.sessionId}`,
      "- event: user.tool_confirmation",
      `- request: ${request.id}`,
      `- tool: ${request.toolName}`,
      `- allowed: ${String(input.allowed)}`,
    ].join("\n")}\n`,
  )
}

async function runAgentSessionCustomToolResult(input: {
  sessionId: string
  requestId?: string
  output: string
}): Promise<void> {
  const output = input.output.trim()
  if (!output) {
    throw new Error("agent session custom-tool-result requires a non-empty --output <text>")
  }

  const store = new SessionStore(process.cwd())
  const snapshot = await store.getSession(input.sessionId)
  const request =
    snapshot.session.pendingCustomToolRequest &&
    (!input.requestId || input.requestId === snapshot.session.pendingCustomToolRequest.id)
      ? snapshot.session.pendingCustomToolRequest
      : null

  if (!request) {
    throw new Error("agent session custom-tool-result requires a pending custom tool request")
  }

  await store.emitEvent(input.sessionId, {
    id: makeUuidV7(),
    type: "user.custom_tool_result",
    createdAt: nowIsoString(),
    processedAt: null,
    requestId: request.id,
    toolName: request.name,
    output,
  })

  process.stdout.write(
    `${[
      "session event appended",
      `- session: ${input.sessionId}`,
      "- event: user.custom_tool_result",
      `- request: ${request.id}`,
      `- tool: ${request.name}`,
    ].join("\n")}\n`,
  )
}

function formatStructuredValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function renderSessionEvent(event: SessionEvent): string {
  switch (event.type) {
    case "user.message":
    case "agent.message":
      return `${event.createdAt} ${event.type} ${JSON.stringify(event.message)} processed=${event.processedAt ?? "pending"}`
    case "user.define_outcome":
      return `${event.createdAt} ${event.type} title=${JSON.stringify(event.outcome.title)} processed=${event.processedAt ?? "pending"}`
    case "user.interrupt":
      return `${event.createdAt} ${event.type}${event.note ? ` note=${JSON.stringify(event.note)}` : ""} processed=${event.processedAt ?? "pending"}`
    case "span.started":
      return `${event.createdAt} ${event.type} ${event.spanKind}/${event.name} span=${event.spanId}${event.parentSpanId ? ` parent=${event.parentSpanId}` : ""}`
    case "span.completed":
      return `${event.createdAt} ${event.type} ${event.spanKind}/${event.name} span=${event.spanId} result=${event.result}${event.parentSpanId ? ` parent=${event.parentSpanId}` : ""}${event.summary ? ` summary=${JSON.stringify(event.summary)}` : ""}`
    case "user.tool_confirmation":
      return `${event.createdAt} ${event.type} ${event.toolName} request=${event.requestId} allowed=${String(event.allowed)} processed=${event.processedAt ?? "pending"}`
    case "user.custom_tool_result":
      return `${event.createdAt} ${event.type} ${event.toolName} request=${event.requestId} output=${JSON.stringify(event.output)} processed=${event.processedAt ?? "pending"}`
    case "session.child_created":
      return `${event.createdAt} ${event.type} child=${event.childSessionId}${event.outcomeTitle ? ` outcome=${JSON.stringify(event.outcomeTitle)}` : ""} processed=${event.processedAt ?? "pending"}`
    case "session.child_idle":
      return `${event.createdAt} ${event.type} child=${event.childSessionId} stopReason=${event.childStopReason} cycles=${event.executedCycles} summary=${JSON.stringify(event.summary)}`
    case "agent.tool_use":
      return `${event.createdAt} ${event.type} ${event.toolName}${event.requestId ? ` request=${event.requestId}` : ""} ownership=${event.ownership} permission=${event.permissionPolicy}`
    case "agent.custom_tool_use":
      return `${event.createdAt} ${event.type} ${event.toolName} request=${event.requestId} input=${formatStructuredValue(event.input)}`
    case "session.status_changed":
      return `${event.createdAt} ${event.type} ${event.fromStatus}->${event.toStatus} reason=${event.reason}`
    case "session.status_idle":
      return `${event.createdAt} ${event.type} reason=${event.reason} summary=${JSON.stringify(event.summary)}${event.blockingEventIds && event.blockingEventIds.length > 0 ? ` blocking=${event.blockingEventIds.join(",")}` : ""}`
  }
}

async function runAgentSessionStatus(input: { sessionId: string }): Promise<void> {
  const sessionStore = new SessionStore(process.cwd())
  const wakeQueue = new SessionWakeQueue(process.cwd(), sessionStore)
  const snapshot = await sessionStore.getSession(input.sessionId)
  const activationJournal = new ActivationJournal(sessionStore)
  const [executionState, pendingWakeState, latestActivation, agentConfig] = await Promise.all([
    sessionStore.getSessionExecutionRuntimeState(input.sessionId),
    wakeQueue.inspectPending(input.sessionId),
    activationJournal.latestForSession(snapshot.session.agentId, snapshot.session.id),
    loadAgentConfig(process.cwd(), snapshot.session.agentId),
  ])
  const stagedDrafts = await listStagedSubstrateDrafts({
    session: snapshot.session,
  })
  const pending = snapshot.events.filter((event) => event.processedAt === null)
  process.stdout.write(
    `${[
      "session status",
      `- session: ${snapshot.session.id}`,
      `- agent: ${snapshot.session.agentId}`,
      `- environment: ${snapshot.session.environmentId}`,
      `- status: ${snapshot.session.status}`,
      `- stopReason: ${snapshot.session.stopReason}`,
      `- turns: ${String(snapshot.session.usage.turns)}`,
      `- pendingEvents: ${String(pending.length)}`,
      `- runnablePendingEvent: ${executionState.runnablePendingEventType ?? "none"}`,
      `- nextRetryAt: ${executionState.deferUntil ?? "none"}`,
      `- retryStreak: ${String(executionState.failureStreak)}`,
      `- pendingQueuedWakes: ${String(pendingWakeState.pendingCount)}`,
      `- nextQueuedWakeAt: ${pendingWakeState.nextDueAt ?? "none"}`,
      `- activeWakeLeaseOwner: ${executionState.activeWakeLease?.owner ?? "none"}`,
      `- activeWakeLeaseAcquiredAt: ${executionState.activeWakeLease?.acquiredAt ?? "none"}`,
      `- resilienceProfile: ${agentConfig.resilience.profile}`,
      `- resilienceRecoverableWakeRetryDelayMs: ${String(agentConfig.resilience.retry.recoverableWakeRetryDelayMs)}`,
      `- resilienceWakeFailureReplayDelayMs: ${String(agentConfig.resilience.retry.wakeFailureReplayDelayMs)}`,
      `- resiliencePendingEventBackoffBaseMs: ${String(agentConfig.resilience.retry.pendingEventBackoffBaseMs)}`,
      `- resiliencePendingEventBackoffMaxMs: ${String(agentConfig.resilience.retry.pendingEventBackoffMaxMs)}`,
      `- stagedSubstrateDrafts: ${String(stagedDrafts.length)}`,
      ...stagedDrafts
        .slice(0, 5)
        .map(
          (draft, index) =>
            `- stagedDraft[${String(index + 1)}]: sessionPath=${draft.sessionPath} substratePath=${draft.substratePath} status=${draft.status} sourceChanged=${String(draft.sourceChangedSinceStage)} draftChanged=${String(draft.draftChangedSinceStage)}`,
        ),
      ...renderLatestActivationStatusLines(latestActivation),
      `- resources: ${String(snapshot.session.resources.length)}`,
      ...(snapshot.session.pendingCustomToolRequest
        ? [
            `- pendingCustomTool: ${snapshot.session.pendingCustomToolRequest.name}`,
            `- pendingCustomToolRequestId: ${snapshot.session.pendingCustomToolRequest.id}`,
            `- pendingCustomToolRequestedAt: ${snapshot.session.pendingCustomToolRequest.requestedAt}`,
            `- pendingCustomToolInput: ${formatStructuredValue(snapshot.session.pendingCustomToolRequest.input)}`,
            `- submitCustomToolResult: pnpm openboa agent session custom-tool-result --session ${snapshot.session.id} --request ${snapshot.session.pendingCustomToolRequest.id} --output '<result>'`,
          ]
        : []),
      ...(snapshot.session.pendingToolConfirmationRequest
        ? [
            `- pendingToolConfirmation: ${snapshot.session.pendingToolConfirmationRequest.toolName}`,
            `- pendingToolRequestId: ${snapshot.session.pendingToolConfirmationRequest.id}`,
            `- pendingToolPermission: ${snapshot.session.pendingToolConfirmationRequest.permissionPolicy}`,
            `- pendingToolRequestedAt: ${snapshot.session.pendingToolConfirmationRequest.requestedAt}`,
          ]
        : []),
    ].join("\n")}\n`,
  )
}

function renderLatestActivationStatusLines(
  latestActivation: ActivationJournalRecord | null,
): string[] {
  if (!latestActivation) {
    return [
      "- lastActivationKind: none",
      "- lastActivationAt: none",
      "- lastActivationReason: none",
      "- lastActivationLeaseOwner: none",
    ]
  }

  const lines = [
    `- lastActivationKind: ${latestActivation.kind}`,
    `- lastActivationAt: ${latestActivation.createdAt}`,
    `- lastActivationClaimId: ${latestActivation.claimId}`,
    `- lastActivationReason: ${latestActivation.reason}`,
    `- lastActivationLeaseOwner: ${latestActivation.leaseOwner}`,
  ]

  switch (latestActivation.kind) {
    case "activation.leased":
      return lines
    case "activation.blocked":
      return [...lines, `- lastActivationBlockedReason: ${latestActivation.blockedReason}`]
    case "activation.acked":
      return [
        ...lines,
        `- lastActivationStopReason: ${latestActivation.stopReason}`,
        `- lastActivationProcessedEvents: ${String(latestActivation.processedEventIds.length)}`,
        `- lastActivationQueuedWakes: ${String(latestActivation.queuedWakeIds.length)}`,
      ]
    case "activation.requeued":
      return [
        ...lines,
        `- lastActivationImmediateRetryAt: ${latestActivation.immediateRetryAt ?? "none"}`,
        `- lastActivationNextQueuedWakeAt: ${latestActivation.nextQueuedWakeAt ?? "none"}`,
        `- lastActivationQueuedWakeIds: ${
          latestActivation.queuedWakeIds.length > 0
            ? latestActivation.queuedWakeIds.join(", ")
            : "none"
        }`,
      ]
    case "activation.abandoned":
      return [
        ...lines,
        `- lastActivationAbandonReason: ${latestActivation.abandonReason}`,
        `- lastActivationError: ${latestActivation.errorMessage ?? "none"}`,
      ]
  }
}

async function runAgentSessionEvents(input: { sessionId: string; limit?: string }): Promise<void> {
  const snapshot = await new SessionStore(process.cwd()).getSession(input.sessionId)
  const limit =
    input.limit && Number.isFinite(Number(input.limit)) && Number(input.limit) > 0
      ? Math.floor(Number(input.limit))
      : snapshot.events.length
  const selected = snapshot.events.slice(-limit)
  process.stdout.write(`session events: ${snapshot.session.id}\n`)
  for (const event of selected) {
    process.stdout.write(`${renderSessionEvent(event)}\n`)
  }
}

function renderActivationJournalEvent(event: ActivationJournalRecord): string {
  const base = `${event.createdAt} ${event.kind} claim=${event.claimId} session=${event.sessionId} activationKind=${event.activationKind} priority=${event.priority} owner=${event.leaseOwner} reason=${JSON.stringify(event.reason)}`
  switch (event.kind) {
    case "activation.leased":
      return `${base}${event.note ? ` note=${JSON.stringify(event.note)}` : ""}${event.dueAt ? ` dueAt=${event.dueAt}` : ""}`
    case "activation.blocked":
      return `${base} blockedReason=${event.blockedReason}`
    case "activation.acked":
      return `${base} wakeId=${event.wakeId ?? "none"} stopReason=${event.stopReason} queuedWakes=${String(event.queuedWakeIds.length)} processedEvents=${String(event.processedEventIds.length)}`
    case "activation.requeued":
      return `${base} immediateRetryAt=${event.immediateRetryAt ?? "none"} nextQueuedWakeAt=${event.nextQueuedWakeAt ?? "none"} queuedWakes=${String(event.queuedWakeIds.length)}`
    case "activation.abandoned":
      return `${base} abandonReason=${event.abandonReason}${event.errorMessage ? ` error=${JSON.stringify(event.errorMessage)}` : ""}`
  }
}

function renderWakeRequeueLines(
  requeue:
    | {
        immediateRetryAt: string | null
        nextQueuedWakeAt: string | null
        queuedWakeIds: string[]
      }
    | null
    | undefined,
): string[] {
  if (!requeue) {
    return ["- activationRequeued: false"]
  }
  return [
    "- activationRequeued: true",
    `- activationImmediateRetryAt: ${requeue.immediateRetryAt ?? "none"}`,
    `- activationNextQueuedWakeAt: ${requeue.nextQueuedWakeAt ?? "none"}`,
    `- activationQueuedWakeIds: ${requeue.queuedWakeIds.join(", ") || "none"}`,
  ]
}

async function runAgentActivationEvents(input: {
  agentId: string
  sessionId?: string
  claimId?: string
  kinds?: ActivationJournalRecord["kind"][]
  limit?: string
}): Promise<void> {
  const journal = new ActivationJournal(new SessionStore(process.cwd()))
  const records = await journal.listMatching(input.agentId, {
    sessionId: input.sessionId,
    claimId: input.claimId,
    kinds: input.kinds,
  })
  const limit =
    input.limit && Number.isFinite(Number(input.limit)) && Number(input.limit) > 0
      ? Math.floor(Number(input.limit))
      : records.length
  const selected = records.slice(-limit)
  const header = [
    `activation events: ${input.agentId}`,
    input.sessionId ? `- session: ${input.sessionId}` : null,
    input.claimId ? `- claim: ${input.claimId}` : null,
    input.kinds && input.kinds.length > 0 ? `- kinds: ${input.kinds.join(", ")}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
  process.stdout.write(`${header}\n`)
  for (const record of selected) {
    process.stdout.write(`${renderActivationJournalEvent(record)}\n`)
  }
}

async function runAgentWake(input: { sessionId: string }): Promise<void> {
  const orchestration = new AgentOrchestration(process.cwd())
  const result = await orchestration.wake(input.sessionId)
  if (!result.executed) {
    process.stdout.write(
      `${[
        "wake: no-op",
        `- session: ${result.session.id}`,
        `- status: ${result.session.status}`,
        `- stopReason: ${result.stopReason}`,
        `- skippedReason: ${result.skippedReason ?? "none"}`,
      ].join("\n")}\n`,
    )
    return
  }

  process.stdout.write(
    `${[
      result.response ?? "No response content was produced.",
      "",
      "wake: executed",
      `- session: ${result.session.id}`,
      `- stopReason: ${result.stopReason}`,
      `- processedEvents: ${String(result.processedEventIds.length)}`,
      `- queuedWakes: ${result.queuedWakeIds.join(", ") || "none"}`,
      ...renderWakeRequeueLines(result.requeue),
      ...result.consumedInputs.map((summary, index) => `- input[${String(index + 1)}]: ${summary}`),
    ].join("\n")}\n`,
  )
}

async function runAgentOrchestrator(input: {
  agentId: string
  stopWhenIdle?: boolean
  maxCycles?: string
  watch?: boolean
  log?: boolean
  pollIntervalMs?: string
  idleTimeoutMs?: string
}): Promise<void> {
  const orchestration = new AgentOrchestration(process.cwd())
  const pollIntervalMs =
    input.pollIntervalMs && Number.isFinite(Number(input.pollIntervalMs))
      ? Math.floor(Number(input.pollIntervalMs))
      : undefined
  const idleTimeoutMs =
    input.idleTimeoutMs && Number.isFinite(Number(input.idleTimeoutMs))
      ? normalizeIdleTimeoutMs(Number(input.idleTimeoutMs))
      : undefined
  const controller = input.watch ? new AbortController() : null
  const teardownSignalHandlers = controller ? registerOrchestratorSignalHandlers(controller) : null

  if (input.watch) {
    process.stdout.write(
      `${[
        "orchestrator: watching",
        `- agent: ${input.agentId}`,
        `- pollIntervalMs: ${String(pollIntervalMs ?? 1000)}`,
        `- idleTimeoutMs: ${idleTimeoutMs === undefined ? "none" : String(idleTimeoutMs)}`,
        `- log: ${String(input.log === true)}`,
      ].join("\n")}\n`,
    )
  }

  const result = await orchestration.runAgentLoop(input.agentId, {
    stopWhenIdle: input.stopWhenIdle,
    watch: input.watch,
    maxCycles:
      input.maxCycles && Number.isFinite(Number(input.maxCycles))
        ? Math.floor(Number(input.maxCycles))
        : undefined,
    pollIntervalMs,
    idleTimeoutMs,
    signal: controller?.signal,
    onActivity: input.watch
      ? (activity) => {
          process.stdout.write(
            `${[
              "orchestrator: activity",
              `- cycle: ${String(activity.cycle)}`,
              `- session: ${activity.sessionId}`,
              `- activationClaimId: ${activity.activationClaimId}`,
              `- stopReason: ${activity.stopReason}`,
              `- processedEvents: ${String(activity.processedEventCount)}`,
              `- queuedWakes: ${String(activity.queuedWakeCount)}`,
              `- runnablePendingEvent: ${activity.runnablePendingEventType ?? "none"}`,
              `- nextRetryAt: ${activity.deferUntil ?? "none"}`,
              `- retryStreak: ${String(activity.failureStreak)}`,
              `- pendingQueuedWakes: ${String(activity.pendingWakeCount)}`,
              `- nextQueuedWakeAt: ${activity.nextQueuedWakeAt ?? "none"}`,
              ...renderWakeRequeueLines(activity.requeue),
              ...activity.queuedWakeSummaries.map(
                (wake, index) =>
                  `- queuedWake[${String(index + 1)}]: dueAt=${wake.dueAt} priority=${wake.priority} reason=${wake.reason}${wake.note ? ` note=${wake.note}` : ""}`,
              ),
              ...activity.consumedInputs.map(
                (summary, index) => `- input[${String(index + 1)}]: ${summary}`,
              ),
              `- responsePreview: ${activity.responsePreview ?? "none"}`,
              ...(activity.pendingToolConfirmation
                ? [
                    "- approvalRequired: true",
                    `- pendingTool: ${activity.pendingToolConfirmation.toolName}`,
                    `- pendingToolRequestId: ${activity.pendingToolConfirmation.id}`,
                    `- pendingToolPermission: ${activity.pendingToolConfirmation.permissionPolicy}`,
                    `- confirmAllow: pnpm openboa agent session confirm-tool --session ${activity.sessionId} --request ${activity.pendingToolConfirmation.id} --allowed true`,
                    `- confirmDeny: pnpm openboa agent session confirm-tool --session ${activity.sessionId} --request ${activity.pendingToolConfirmation.id} --allowed false`,
                  ]
                : []),
              ...(activity.pendingCustomTool
                ? [
                    "- customToolRequired: true",
                    `- pendingCustomTool: ${activity.pendingCustomTool.name}`,
                    `- pendingCustomToolRequestId: ${activity.pendingCustomTool.id}`,
                    `- pendingCustomToolRequestedAt: ${activity.pendingCustomTool.requestedAt}`,
                    `- pendingCustomToolInput: ${formatStructuredValue(activity.pendingCustomTool.input)}`,
                    `- submitCustomToolResult: pnpm openboa agent session custom-tool-result --session ${activity.sessionId} --request ${activity.pendingCustomTool.id} --output '<result>'`,
                  ]
                : []),
              ...(input.log
                ? activity.wakeEvents.map((event) => `- event: ${renderSessionEvent(event)}`)
                : []),
            ].join("\n")}\n`,
          )
        }
      : undefined,
    onSkip:
      input.watch && input.log
        ? (skip) => {
            process.stdout.write(
              `${[
                "orchestrator: skipped",
                `- cycle: ${String(skip.cycle)}`,
                `- session: ${skip.sessionId}`,
                `- activationClaimId: ${skip.activationClaimId}`,
                `- activationKind: ${skip.activationKind}`,
                `- reason: ${skip.reason}`,
                `- error: ${skip.errorMessage ?? "none"}`,
                `- nextRetryAt: ${skip.nextRetryAt ?? "none"}`,
                `- retryStreak: ${String(skip.failureStreak ?? 0)}`,
                `- activeWakeLeaseOwner: ${skip.activeWakeLease?.owner ?? "none"}`,
                `- activeWakeLeaseAcquiredAt: ${skip.activeWakeLease?.acquiredAt ?? "none"}`,
              ].join("\n")}\n`,
            )
          }
        : undefined,
  })
  teardownSignalHandlers?.()
  process.stdout.write(
    `${[
      "orchestrator: stopped",
      `- agent: ${input.agentId}`,
      `- watch: ${String(input.watch === true)}`,
      `- stopReason: ${result.stopReason}`,
      `- cycles: ${String(result.cycles)}`,
      `- executed: ${String(result.executed)}`,
    ].join("\n")}\n`,
  )
}

async function runAgentScenarioLoopCommand(input: {
  agentId?: string
  suite?: string
  count?: string
  outputPath?: string
  modelTimeoutMs?: string
}): Promise<void> {
  const result = await runAgentScenarioLoop(process.cwd(), {
    agentId: input.agentId,
    suite: input.suite === "full" ? "full" : input.suite === "curated" ? "curated" : undefined,
    count:
      input.count && Number.isFinite(Number(input.count))
        ? Math.floor(Number(input.count))
        : undefined,
    outputPath: input.outputPath,
    modelTimeoutMs:
      input.modelTimeoutMs && Number.isFinite(Number(input.modelTimeoutMs))
        ? Math.floor(Number(input.modelTimeoutMs))
        : undefined,
  })
  process.stdout.write(
    `${[
      "scenario-loop: completed",
      `- agent: ${result.agentId}`,
      `- suite: ${result.suite}`,
      `- available: ${String(result.available)}`,
      `- output: ${result.outputPath}`,
      `- executed: ${String(result.executed)}`,
      `- passed: ${String(result.passed)}`,
      `- failed: ${String(result.failed)}`,
    ].join("\n")}\n`,
  )
}

async function runAgentScenarioSoakCommand(input: {
  agentId?: string
  workers?: string
  sessions?: string
  delayedSessions?: string
  outputPath?: string
  modelTimeoutMs?: string
}): Promise<void> {
  const result = await runAgentScenarioSoak(process.cwd(), {
    agentId: input.agentId,
    workers:
      input.workers && Number.isFinite(Number(input.workers))
        ? Math.floor(Number(input.workers))
        : undefined,
    sessions:
      input.sessions && Number.isFinite(Number(input.sessions))
        ? Math.floor(Number(input.sessions))
        : undefined,
    delayedSessions:
      input.delayedSessions && Number.isFinite(Number(input.delayedSessions))
        ? Math.floor(Number(input.delayedSessions))
        : undefined,
    outputPath: input.outputPath,
    modelTimeoutMs:
      input.modelTimeoutMs && Number.isFinite(Number(input.modelTimeoutMs))
        ? Math.floor(Number(input.modelTimeoutMs))
        : undefined,
  })
  process.stdout.write(
    `${[
      "scenario-soak: completed",
      `- agent: ${result.agentId}`,
      `- output: ${result.outputPath}`,
      `- workers: ${String(result.workers)}`,
      `- sessions: ${String(result.sessions)}`,
      `- delayedSessions: ${String(result.delayedSessions)}`,
      `- blockedActivations: ${String(result.blockedActivations)}`,
      `- immediatePassed: ${String(result.immediatePassed)}`,
      `- delayedPassed: ${String(result.delayedPassed)}`,
      `- failed: ${String(result.failed)}`,
    ].join("\n")}\n`,
  )
}

async function runAgentScenarioMixedSoakCommand(input: {
  agentId?: string
  workers?: string
  rounds?: string
  immediateSessions?: string
  delayedSessions?: string
  approvalSessions?: string
  customToolSessions?: string
  interruptSessions?: string
  outputPath?: string
  modelTimeoutMs?: string
}): Promise<void> {
  const result = await runAgentScenarioMixedSoak(process.cwd(), {
    agentId: input.agentId,
    workers:
      input.workers && Number.isFinite(Number(input.workers))
        ? Math.floor(Number(input.workers))
        : undefined,
    rounds:
      input.rounds && Number.isFinite(Number(input.rounds))
        ? Math.floor(Number(input.rounds))
        : undefined,
    immediateSessions:
      input.immediateSessions && Number.isFinite(Number(input.immediateSessions))
        ? Math.floor(Number(input.immediateSessions))
        : undefined,
    delayedSessions:
      input.delayedSessions && Number.isFinite(Number(input.delayedSessions))
        ? Math.floor(Number(input.delayedSessions))
        : undefined,
    approvalSessions:
      input.approvalSessions && Number.isFinite(Number(input.approvalSessions))
        ? Math.floor(Number(input.approvalSessions))
        : undefined,
    customToolSessions:
      input.customToolSessions && Number.isFinite(Number(input.customToolSessions))
        ? Math.floor(Number(input.customToolSessions))
        : undefined,
    interruptSessions:
      input.interruptSessions && Number.isFinite(Number(input.interruptSessions))
        ? Math.floor(Number(input.interruptSessions))
        : undefined,
    outputPath: input.outputPath,
    modelTimeoutMs:
      input.modelTimeoutMs && Number.isFinite(Number(input.modelTimeoutMs))
        ? Math.floor(Number(input.modelTimeoutMs))
        : undefined,
  })
  process.stdout.write(
    `${[
      "scenario-mixed-soak: completed",
      `- agent: ${result.agentId}`,
      `- output: ${result.outputPath}`,
      `- workers: ${String(result.workers)}`,
      `- rounds: ${String(result.rounds)}`,
      `- immediateSessions: ${String(result.immediateSessions)}`,
      `- delayedSessions: ${String(result.delayedSessions)}`,
      `- approvalSessions: ${String(result.approvalSessions)}`,
      `- customToolSessions: ${String(result.customToolSessions)}`,
      `- interruptSessions: ${String(result.interruptSessions)}`,
      `- blockedActivations: ${String(result.blockedActivations)}`,
      `- immediatePassed: ${String(result.immediatePassed)}`,
      `- delayedPassed: ${String(result.delayedPassed)}`,
      `- approvalPassed: ${String(result.approvalPassed)}`,
      `- customToolPassed: ${String(result.customToolPassed)}`,
      `- interruptPassed: ${String(result.interruptPassed)}`,
      `- failed: ${String(result.failed)}`,
    ].join("\n")}\n`,
  )
}

function normalizeIdleTimeoutMs(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined
  }
  const normalized = Math.floor(value)
  return normalized <= 0 ? undefined : normalized
}

function registerOrchestratorSignalHandlers(controller: AbortController): () => void {
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  return () => {
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
  }
}

async function runAdminBootstrap(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const binding = await app.bootstrapChatAdmin({
    subjectId: options["subject-id"],
  })
  process.stdout.write(
    `${[
      "chat admin bootstrapped",
      `- bindingId: ${binding.bindingId}`,
      `- subjectId: ${binding.subjectId}`,
    ].join("\n")}\n`,
  )
}

export async function runCli(rawArgs: string[]): Promise<void> {
  const parsed = parseArgs(rawArgs)
  const [command, subcommand, third, ...rest] = parsed.positionals

  if (!command || command === "help") {
    usage()
    return
  }

  switch (command) {
    case "setup":
      await runSetup(parsed.options)
      return
    case "auth":
      if (subcommand === "login") {
        await runAuthLogin(parsed.options.provider)
        return
      }
      if (subcommand === "status") {
        await runAuthStatus()
        return
      }
      throw new Error("auth requires either 'login' or 'status'")
    case "agent":
      if (subcommand === "spawn") {
        await runAgentSpawn(parsed.options)
        return
      }
      if (subcommand === "list") {
        await runAgentList()
        return
      }
      if (subcommand === "session") {
        if (third === "create") {
          const agentId = parsed.options.name ?? parsed.options.agent ?? rest[0]
          if (!agentId) {
            throw new Error("agent session create requires --name <agent-id>")
          }
          await runAgentSessionCreate({
            agentId,
            environmentId: parsed.options.environment,
          })
          return
        }
        if (third === "send") {
          const sessionId = parsed.options.session ?? rest[0]
          if (!sessionId?.trim()) {
            throw new Error("agent session send requires --session <session-id>")
          }
          const message = parsed.options.message ?? rest.slice(1).join(" ")
          await runAgentSessionSend({
            sessionId,
            message,
          })
          return
        }
        if (third === "interrupt") {
          const sessionId = parsed.options.session ?? rest[0]
          if (!sessionId?.trim()) {
            throw new Error("agent session interrupt requires --session <session-id>")
          }
          await runAgentSessionInterrupt({
            sessionId,
            note: parsed.options.note,
          })
          return
        }
        if (third === "confirm-tool") {
          const sessionId = parsed.options.session ?? rest[0]
          if (!sessionId?.trim()) {
            throw new Error("agent session confirm-tool requires --session <session-id>")
          }
          const allowedValue = parsed.options.allowed ?? rest[1]
          if (allowedValue !== "true" && allowedValue !== "false") {
            throw new Error("agent session confirm-tool requires --allowed <true|false>")
          }
          await runAgentSessionConfirmTool({
            sessionId,
            requestId: parsed.options.request,
            allowed: allowedValue === "true",
            note: parsed.options.note,
          })
          return
        }
        if (third === "custom-tool-result") {
          const sessionId = parsed.options.session ?? rest[0]
          if (!sessionId?.trim()) {
            throw new Error("agent session custom-tool-result requires --session <session-id>")
          }
          const output = parsed.options.output ?? rest.slice(1).join(" ")
          await runAgentSessionCustomToolResult({
            sessionId,
            requestId: parsed.options.request,
            output,
          })
          return
        }
        if (third === "status") {
          const sessionId = parsed.options.session ?? rest[0]
          if (!sessionId?.trim()) {
            throw new Error("agent session status requires --session <session-id>")
          }
          await runAgentSessionStatus({ sessionId })
          return
        }
        if (third === "events") {
          const sessionId = parsed.options.session ?? rest[0]
          if (!sessionId?.trim()) {
            throw new Error("agent session events requires --session <session-id>")
          }
          await runAgentSessionEvents({
            sessionId,
            limit: parsed.options.limit,
          })
          return
        }
        throw new Error(
          "agent session requires one of: create, send, interrupt, confirm-tool, custom-tool-result, status, events",
        )
      }
      if (subcommand === "wake") {
        const sessionId = parsed.options.session ?? parsed.options.id ?? third
        if (!sessionId?.trim()) {
          throw new Error("agent wake requires --session <session-id>")
        }
        await runAgentWake({ sessionId })
        return
      }
      if (subcommand === "activation-events") {
        const agentId = parsed.options.agent ?? parsed.options.name ?? third
        if (!agentId?.trim()) {
          throw new Error("agent activation-events requires --agent <agent-id>")
        }
        await runAgentActivationEvents({
          agentId,
          sessionId: parsed.options.session,
          claimId: parsed.options.claim,
          kinds: parseActivationEventKinds(parsed.options.kind),
          limit: parsed.options.limit,
        })
        return
      }
      if (subcommand === "orchestrator") {
        const agentId = parsed.options.agent ?? parsed.options.name ?? third
        if (!agentId) {
          throw new Error("agent orchestrator requires --agent <agent-id>")
        }
        await runAgentOrchestrator({
          agentId,
          stopWhenIdle:
            parsed.options.watch === "true" || parsed.options.watch === ""
              ? parsed.options["stop-when-idle"] === "true"
              : parsed.options["stop-when-idle"] !== "false",
          watch: parsed.options.watch === "true" || parsed.options.watch === "",
          log: parsed.options.log === "true" || parsed.options.log === "",
          maxCycles: parsed.options["max-cycles"],
          pollIntervalMs: parsed.options["poll-interval-ms"],
          idleTimeoutMs: parsed.options["idle-timeout-ms"],
        })
        return
      }
      if (subcommand === "scenario-loop") {
        await runAgentScenarioLoopCommand({
          agentId: parsed.options.agent ?? parsed.options.name ?? third,
          suite: parsed.options.suite,
          count: parsed.options.count,
          outputPath: parsed.options.output,
          modelTimeoutMs: parsed.options["model-timeout-ms"],
        })
        return
      }
      if (subcommand === "scenario-soak") {
        await runAgentScenarioSoakCommand({
          agentId: parsed.options.agent ?? parsed.options.name ?? third,
          workers: parsed.options.workers,
          sessions: parsed.options.sessions,
          delayedSessions: parsed.options["delayed-sessions"],
          outputPath: parsed.options.output,
          modelTimeoutMs: parsed.options["model-timeout-ms"],
        })
        return
      }
      if (subcommand === "scenario-mixed-soak") {
        await runAgentScenarioMixedSoakCommand({
          agentId: parsed.options.agent ?? parsed.options.name ?? third,
          workers: parsed.options.workers,
          rounds: parsed.options.rounds,
          immediateSessions: parsed.options["immediate-sessions"],
          delayedSessions: parsed.options["delayed-sessions"],
          approvalSessions: parsed.options["approval-sessions"],
          customToolSessions: parsed.options["custom-tool-sessions"],
          interruptSessions: parsed.options["interrupt-sessions"],
          outputPath: parsed.options.output,
          modelTimeoutMs: parsed.options["model-timeout-ms"],
        })
        return
      }
      throw new Error(
        "agent requires one of: spawn, list, session, activation-events, wake, orchestrator, scenario-loop, scenario-soak, scenario-mixed-soak",
      )
    case "chat": {
      await runChatCli({
        subcommand,
        third,
        rest,
        options: parsed.options,
      })
      return
    }
    case "admin":
      if (subcommand === "bootstrap") {
        await runAdminBootstrap(parsed.options)
        return
      }
      throw new Error("admin requires 'bootstrap'")
    default:
      throw new Error(`unknown command: ${command}`)
  }
}
