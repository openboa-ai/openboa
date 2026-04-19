export type LoopDirectiveOutcome = "sleep" | "continue"
export type QueuedWakePriority = "low" | "normal" | "high"
export type AgentLearningKind = "lesson" | "correction" | "error"

export interface QueuedWakeRequest {
  reason: string
  delaySeconds: number
  note: string | null
  dedupeKey: string | null
  priority: QueuedWakePriority
}

export interface AgentResolvedQueuedWake extends QueuedWakeRequest {
  dueAt: string
}

export interface AgentLearningRequest {
  kind: AgentLearningKind
  title: string
  detail: string
  promoteToMemory?: boolean
  dedupeKey?: string | null
}

export interface AgentResolvedLearning {
  kind: AgentLearningKind
  title: string
  detail: string
  promoteToMemory: boolean
  dedupeKey: string | null
}

export interface CustomToolRequest {
  name: string
  input: Record<string, unknown>
}

export interface LoopDirective {
  outcome: LoopDirectiveOutcome
  summary: string
  followUpSeconds: number | null
  queuedWakes?: QueuedWakeRequest[]
  learnings?: AgentLearningRequest[]
  customToolRequest?: CustomToolRequest | null
}

export interface ResolvedLoopDirective extends Omit<LoopDirective, "queuedWakes" | "learnings"> {
  nextWakeAt: string | null
  enforcedByRuntime: boolean
  queuedWakes: AgentResolvedQueuedWake[]
  learnings: AgentResolvedLearning[]
}

const LOOP_TAG = "openboa-session-loop"
const MAX_QUEUED_WAKES = 3
const MAX_WAKE_DELAY_SECONDS = 24 * 60 * 60
const MAX_LEARNINGS = 3
const MAX_LEARNING_TITLE_LENGTH = 120
const MAX_LEARNING_DETAIL_LENGTH = 400

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function normalizeSummary(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? "No durable summary was provided."
}

function computeNextWakeAt(createdAt: string, followUpSeconds: number | null): string | null {
  if (followUpSeconds === null) {
    return null
  }
  const created = Date.parse(createdAt)
  const base = Number.isFinite(created) ? created : Date.now()
  return new Date(base + followUpSeconds * 1000).toISOString()
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trimEnd()}...` : value
}

function resolveQueuedWakes(createdAt: string, value: unknown): AgentResolvedQueuedWake[] {
  if (!Array.isArray(value)) {
    return []
  }

  const results: AgentResolvedQueuedWake[] = []
  for (const entry of value) {
    if (results.length >= MAX_QUEUED_WAKES) {
      break
    }
    if (!entry || typeof entry !== "object") {
      continue
    }
    const record = entry as Record<string, unknown>
    const reason = normalizeOptionalText(typeof record.reason === "string" ? record.reason : null)
    const rawDelay =
      typeof record.delaySeconds === "number" &&
      Number.isFinite(record.delaySeconds) &&
      record.delaySeconds > 0
        ? Math.floor(record.delaySeconds)
        : null
    if (!reason || rawDelay === null) {
      continue
    }
    const delaySeconds = Math.min(rawDelay, MAX_WAKE_DELAY_SECONDS)
    results.push({
      reason,
      delaySeconds,
      note: normalizeOptionalText(typeof record.note === "string" ? record.note : null),
      dedupeKey: normalizeOptionalText(
        typeof record.dedupeKey === "string" ? record.dedupeKey : null,
      ),
      priority:
        record.priority === "low" || record.priority === "high" ? record.priority : "normal",
      dueAt: computeNextWakeAt(createdAt, delaySeconds) ?? createdAt,
    })
  }
  return results
}

function resolveLearnings(value: unknown): AgentResolvedLearning[] {
  if (!Array.isArray(value)) {
    return []
  }
  const results: AgentResolvedLearning[] = []
  for (const entry of value) {
    if (results.length >= MAX_LEARNINGS) {
      break
    }
    if (!entry || typeof entry !== "object") {
      continue
    }
    const record = entry as Record<string, unknown>
    const title = normalizeOptionalText(typeof record.title === "string" ? record.title : null)
    const detail = normalizeOptionalText(typeof record.detail === "string" ? record.detail : null)
    if (!title || !detail) {
      continue
    }
    results.push({
      kind: record.kind === "correction" || record.kind === "error" ? record.kind : "lesson",
      title: truncateText(title, MAX_LEARNING_TITLE_LENGTH),
      detail: truncateText(detail, MAX_LEARNING_DETAIL_LENGTH),
      promoteToMemory: record.promoteToMemory === true,
      dedupeKey: normalizeOptionalText(
        typeof record.dedupeKey === "string" ? record.dedupeKey : null,
      ),
    })
  }
  return results
}

function resolveCustomToolRequest(value: unknown): CustomToolRequest | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const record = value as Record<string, unknown>
  const name = normalizeOptionalText(typeof record.name === "string" ? record.name : null)
  if (!name) {
    return null
  }
  const input =
    record.input && typeof record.input === "object" && !Array.isArray(record.input)
      ? (record.input as Record<string, unknown>)
      : {}
  return { name, input }
}

function summarizeResponse(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim()
  if (!normalized) {
    return "No response content was produced."
  }
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized
}

export function buildHarnessSystemPromptAppendix(): string {
  return [
    "<harness-guidance>",
    "You are running inside the openboa session harness.",
    "The durable truth is the session log, not the current context window.",
    "Review the pending session events and choose one bounded next move.",
    "Treat retrieval hints, summaries, and runtime notes as leads to verify, not as final truth.",
    "If prior work may matter, navigate same-agent history with session_list, session_list_children, session_list_traces, session_search_traces, retrieval_search, session_search_context, session_get_snapshot, session_get_events, and session_get_trace before assuming details.",
    "If the work cleanly splits into an isolated bounded subproblem, create a child session with session_delegate instead of overloading the current session context.",
    "If delegated child work should make immediate forward progress, continue that direct child with session_run_child for only a few bounded cycles instead of trying to inline the whole subproblem here.",
    "If the current session is itself a delegated child, treat parentSessionId as a durable navigation hint and inspect the parent with session_get_snapshot or session_get_trace before assuming delegated intent.",
    "Use environment_describe and vault_list before assuming execution posture, writable roots, or the presence of protected mounts.",
    "Use permissions_describe before assuming the overall confirmation posture, and use permissions_check before write-heavy or confirmation-gated tools only when that preflight materially changes the next bounded move.",
    "If the user has already requested a concrete write or mutation and you are ready to do it, call the managed tool directly instead of asking for confirmation in plain text. Let the runtime surface the authoritative user.tool_confirmation pause if explicit approval is required.",
    "If the user explicitly names a managed tool and asks you to use it, call that exact tool instead of substituting a nearby tool or answering only from cached context, unless the named tool is impossible or safety-blocked.",
    "Use session_get_events with aroundEventId slices when you need the lead-up to a specific moment.",
    "Use outcome_read to inspect the current durable session outcome before assuming the goal, use outcome_define when the session needs a better explicit success target, use outcome_evaluate before promoting shared memory or shared substrate changes when a durable outcome exists, and use outcome_history when evaluator posture looks stable or regressing across repeated bounded revisions.",
    "Use memory_write when you need to externalize bounded session-local state into session-state.md or working-buffer.md instead of carrying it only in the current response.",
    "If the task sounds procedural or role-specific, use skills_search to find the right procedure and skills_read to load the full skill before guessing the workflow.",
    "If a sandbox hand is attached, call sandbox_describe before blind sandbox_execute calls and read its constraints, actions, and commandPolicy first.",
    "Use shell_describe to inspect the durable session-scoped shell hand before assuming the current cwd, shell env, or persistent shell status; use shell_wait when a live persistent shell command is still busy and the next move is to wait for bounded completion or running status; use shell_history when prior command output matters; use shell_set_cwd when the next bounded commands should continue from a different workspace directory; use shell_set_env or shell_unset_env when the session hand needs stable command-scoped variables; use shell_open and shell_exec when multi-step shell work should preserve shell-local cwd and exports across steps; use shell_restart when shell_describe reports that the live persistent shell is closed or stale but shell-local continuity should continue.",
    "Treat /workspace as the writable session execution hand, /workspace/agent as shared read-only substrate, and /vaults/* as read-only protected mounts.",
    "Treat /runtime as the primary mounted session runtime state. The mirrored files under /workspace/.openboa-runtime are reread guides inside the writable hand, not a replacement for the /runtime mount.",
    "Prefer first-class built-in file tools such as read, write, edit, glob, grep, bash, and shell_run for ordinary workspace work. Reserve sandbox_execute for uncommon hand actions that are not already exposed directly.",
    "When command execution is needed, use bash for bounded read-only inspection and shell_run for writable shell composition inside the session execution hand after confirmation.",
    "If a shared substrate file needs editing, first stage it into /workspace with resources_stage_from_substrate.",
    "Bootstrap substrate files such as AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, and MEMORY.md live under /workspace/agent, not /workspace. Do not assume /workspace/<bootstrap-file> already exists; stage it first, edit the staged copy, then compare and promote it back if warranted.",
    "If the user is only asking what a bootstrap substrate file says, prefer quoting from the current bootstrap context or use read on /workspace/agent/<bootstrap-file>. Do not use shell_run or shell_exec for read-only bootstrap inspection.",
    "When quoting a bootstrap substrate file, preserve the exact full line text including leading markdown markers, punctuation, and capitalization. Do not normalize bullets into prose or decorative quotation marks.",
    "Before promoting a changed session file back into shared substrate, prefer resources_compare_with_substrate when you need to inspect what changed.",
    "If a file created in /workspace should become durable shared substrate for future sessions, use resources_promote_to_substrate instead of assuming /workspace/agent is writable.",
    "If the session should be revisited later, request queuedWakes in the loop JSON block.",
    "If the user explicitly asks for a reminder, follow-up, or revisit after a delay, emit queuedWakes for that delayed work instead of only waiting silently or hoping the session will be woken manually later.",
    "If this turn produced a reusable lesson, emit it through learnings.",
    "If execution must pause for a user-provided custom tool result, emit customToolRequest.",
    "If a managed tool requires explicit confirmation, treat the interruption as authoritative and wait for a matching user.tool_confirmation event before retrying it.",
    "Respond with any useful plain-text output first.",
    `Then end with exactly one <${LOOP_TAG}> JSON block.`,
    'Required JSON shape: {"outcome":"sleep"|"continue","summary":"...","followUpSeconds":number|null,"queuedWakes":[{"reason":"...","delaySeconds":number,"note":"...","dedupeKey":"...","priority":"low"|"normal"|"high"}],"learnings":[{"kind":"lesson"|"correction"|"error","title":"...","detail":"...","promoteToMemory":true|false,"dedupeKey":"..."}],"customToolRequest":{"name":"...","input":{}}}.',
    "Use outcome=continue only when the same session deserves one immediate bounded revisit.",
    "</harness-guidance>",
  ].join("\n")
}

export function buildHarnessMessage(input: {
  sessionId: string
  sessionParentId: string | null
  directChildCount: number
  stopReason: string
  pendingEvents: string[]
  latestSummary: string | null
  latestResponse: string | null
  runtimeSessionState: string | null
  runtimeWorkingBuffer: string | null
  runtimeShellState: {
    cwd: string
    envKeyCount?: number
    envKeys?: string[]
    persistentShell: {
      shellId: string
      status: "active" | "closed"
      commandCount: number
      busy?: boolean
      currentCommand?: string | null
      currentCommandStartedAt?: string | null
    } | null
    recentCommandCount?: number
    lastCommand: {
      command: string
      cwd: string
      exitCode: number | null
      timedOut: boolean
      outputPreview: string | null
    } | null
  } | null
  activeOutcome: SessionOutcomeDefinition | null
  outcomeGrade: SessionOutcomeGrade
  outcomeEvaluation: SessionOutcomeEvaluation
  pendingToolConfirmationRequest?: {
    id: string
    toolName: string
  } | null
}): string {
  return [
    "<session-wake>",
    `<session-id>${input.sessionId}</session-id>`,
    `<previous-stop-reason>${input.stopReason}</previous-stop-reason>`,
    "",
    "<session-relations>",
    `- parentSessionId: ${input.sessionParentId ?? "none"}`,
    `- directChildCount: ${String(input.directChildCount)}`,
    "</session-relations>",
    "",
    "<pending-events>",
    ...input.pendingEvents.map((event) => `- ${event}`),
    ...(input.pendingEvents.length === 0 ? ["- none"] : []),
    "</pending-events>",
    "",
    "<previous-session-memory>",
    `- latestSummary: ${input.latestSummary ?? "none"}`,
    `- latestResponse: ${input.latestResponse ?? "none"}`,
    `- activeOutcome: ${input.activeOutcome?.title ?? "none"}`,
    `- pendingToolConfirmation: ${input.pendingToolConfirmationRequest ? `${input.pendingToolConfirmationRequest.toolName} (${input.pendingToolConfirmationRequest.id})` : "none"}`,
    "</previous-session-memory>",
    ...(input.activeOutcome
      ? [
          "",
          "<active-outcome>",
          "",
          `- Title: ${input.activeOutcome.title}`,
          `- Detail: ${input.activeOutcome.detail ?? "none"}`,
          `- Success Criteria: ${
            input.activeOutcome.successCriteria.length > 0
              ? input.activeOutcome.successCriteria.join(" | ")
              : "none"
          }`,
          "</active-outcome>",
        ]
      : []),
    "",
    "<outcome-grade>",
    `- status: ${input.outcomeGrade.status}`,
    `- confidence: ${input.outcomeGrade.confidence}`,
    `- matchedCriteria: ${String(input.outcomeGrade.matchedCriteria)}/${String(input.outcomeGrade.totalCriteria)}`,
    `- summary: ${input.outcomeGrade.summary}`,
    ...(input.outcomeGrade.evidence.length > 0
      ? input.outcomeGrade.evidence.map((evidence) => `- evidence: ${evidence}`)
      : ["- evidence: none"]),
    `- nextSuggestedTool: ${
      input.outcomeGrade.nextSuggestedTool
        ? `${input.outcomeGrade.nextSuggestedTool.tool} ${JSON.stringify(input.outcomeGrade.nextSuggestedTool.args)}`
        : "none"
    }`,
    "</outcome-grade>",
    "",
    "<outcome-evaluation>",
    `- status: ${input.outcomeEvaluation.status}`,
    `- confidence: ${input.outcomeEvaluation.confidence}`,
    `- promotionReady: ${String(input.outcomeEvaluation.promotionReady)}`,
    `- summary: ${input.outcomeEvaluation.summary}`,
    ...(input.outcomeEvaluation.evidence.length > 0
      ? input.outcomeEvaluation.evidence.map((evidence) => `- evidence: ${evidence}`)
      : ["- evidence: none"]),
    `- nextSuggestedTool: ${
      input.outcomeEvaluation.nextSuggestedTool
        ? `${input.outcomeEvaluation.nextSuggestedTool.tool} ${JSON.stringify(input.outcomeEvaluation.nextSuggestedTool.args)}`
        : "none"
    }`,
    "</outcome-evaluation>",
    ...(input.runtimeSessionState
      ? ["", "<runtime-session-state>", "", input.runtimeSessionState, "</runtime-session-state>"]
      : []),
    ...(input.runtimeWorkingBuffer
      ? [
          "",
          "<runtime-working-buffer>",
          "",
          input.runtimeWorkingBuffer,
          "</runtime-working-buffer>",
        ]
      : []),
    ...(input.runtimeShellState
      ? [
          "",
          "<runtime-shell-state>",
          `- cwd: ${input.runtimeShellState.cwd}`,
          `- envKeys: ${String(input.runtimeShellState.envKeyCount ?? 0)}${
            input.runtimeShellState.envKeys && input.runtimeShellState.envKeys.length > 0
              ? ` (${input.runtimeShellState.envKeys.join(", ")})`
              : ""
          }`,
          `- persistentShell: ${
            input.runtimeShellState.persistentShell
              ? `${input.runtimeShellState.persistentShell.status} (${input.runtimeShellState.persistentShell.shellId}, commands=${String(input.runtimeShellState.persistentShell.commandCount)}, busy=${String(input.runtimeShellState.persistentShell.busy ?? false)})`
              : "none"
          }`,
          ...(input.runtimeShellState.persistentShell?.currentCommand
            ? [`- currentShellCommand: ${input.runtimeShellState.persistentShell.currentCommand}`]
            : []),
          ...(input.runtimeShellState.persistentShell?.currentCommandStartedAt
            ? [
                `- currentShellCommandStartedAt: ${input.runtimeShellState.persistentShell.currentCommandStartedAt}`,
              ]
            : []),
          `- recentCommands: ${String(input.runtimeShellState.recentCommandCount ?? 0)}`,
          `- lastCommand: ${
            input.runtimeShellState.lastCommand
              ? `${input.runtimeShellState.lastCommand.command} @ ${input.runtimeShellState.lastCommand.cwd} (exit=${String(input.runtimeShellState.lastCommand.exitCode)}, timedOut=${String(input.runtimeShellState.lastCommand.timedOut)})`
              : "none"
          }`,
          ...(input.runtimeShellState.lastCommand?.outputPreview
            ? [`- lastCommandPreview: ${input.runtimeShellState.lastCommand.outputPreview}`]
            : []),
          "</runtime-shell-state>",
        ]
      : []),
    "</session-wake>",
  ].join("\n")
}

export function resolveLoopDirective(input: {
  rawResponse: string
  createdAt: string
  defaultFollowUpSeconds: number
  maxConsecutiveFollowUps: number
  currentConsecutiveFollowUps: number
}): {
  assistantResponse: string
  directive: ResolvedLoopDirective
} {
  const match = input.rawResponse.match(new RegExp(`<${LOOP_TAG}>([\\s\\S]*?)</${LOOP_TAG}>`, "u"))
  const assistantResponse = match
    ? input.rawResponse.replace(match[0], "").trim()
    : input.rawResponse.trim()

  let parsed: Partial<LoopDirective> | null = null
  if (match) {
    try {
      parsed = JSON.parse(match[1]) as Partial<LoopDirective>
    } catch {
      parsed = null
    }
  }

  const rawOutcome = parsed?.outcome === "continue" ? "continue" : "sleep"
  const requestedFollowUp =
    typeof parsed?.followUpSeconds === "number" &&
    Number.isFinite(parsed.followUpSeconds) &&
    parsed.followUpSeconds > 0
      ? Math.floor(parsed.followUpSeconds)
      : null
  const nextConsecutiveFollowUps =
    rawOutcome === "continue" ? input.currentConsecutiveFollowUps + 1 : 0
  const enforcedByRuntime = nextConsecutiveFollowUps > input.maxConsecutiveFollowUps
  const outcome: LoopDirectiveOutcome = enforcedByRuntime ? "sleep" : rawOutcome
  const followUpSeconds =
    outcome === "continue" ? (requestedFollowUp ?? input.defaultFollowUpSeconds) : null

  return {
    assistantResponse,
    directive: {
      outcome,
      summary: normalizeSummary(parsed?.summary) || summarizeResponse(assistantResponse),
      followUpSeconds,
      nextWakeAt: computeNextWakeAt(input.createdAt, followUpSeconds),
      enforcedByRuntime,
      queuedWakes: resolveQueuedWakes(input.createdAt, parsed?.queuedWakes),
      learnings: resolveLearnings(parsed?.learnings),
      customToolRequest: resolveCustomToolRequest(parsed?.customToolRequest),
    },
  }
}

import type { SessionOutcomeEvaluation } from "../outcomes/outcome-evaluate.js"
import type { SessionOutcomeGrade } from "../outcomes/outcome-grade.js"
import type { SessionOutcomeDefinition } from "../schema/runtime.js"
