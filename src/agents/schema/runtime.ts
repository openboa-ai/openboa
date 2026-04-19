import type { CliSessionBinding } from "../backends/cli-session.js"
import type { AgentProviderId, AgentRunnerKind } from "../providers/provider-capabilities.js"

export type SessionStatus = "idle" | "running" | "rescheduling" | "requires_action" | "terminated"
export type SessionStopReason = "idle" | "requires_action" | "terminated" | "rescheduling"

export type ResourceAttachmentKind =
  | "agent_workspace_substrate"
  | "session_workspace"
  | "local_file"
  | "learnings_memory_store"
  | "session_runtime_memory"
  | "vault"
  | "remote_file_store"
  | "repo_mount"

export interface ResourceAttachment {
  id: string
  kind: ResourceAttachmentKind
  sourceRef: string
  mountPath: string
  access: "read_only" | "read_write"
  metadata?: Record<string, unknown>
}

export interface SessionUsage {
  turns: number
}

export interface SessionCustomToolRequest {
  id: string
  name: string
  input: Record<string, unknown>
  requestedAt: string
}

export interface SessionToolConfirmationRequest {
  id: string
  toolName: string
  ownership: ToolOwnership
  permissionPolicy: PermissionPolicy
  input: Record<string, unknown>
  requestedAt: string
}

export interface SessionMetadata {
  providerSessionBindings?: Partial<Record<AgentProviderId, CliSessionBinding>>
  lastRunner?: AgentRunnerKind
  lastProvider?: AgentProviderId
  lastModel?: string
  parentSessionId?: string
}

export interface SessionOutcomeDefinition {
  title: string
  detail: string | null
  successCriteria: string[]
}

export interface Session {
  id: string
  agentId: string
  environmentId: string
  status: SessionStatus
  createdAt: string
  updatedAt: string
  usage: SessionUsage
  resources: ResourceAttachment[]
  stopReason: SessionStopReason
  pendingCustomToolRequest: SessionCustomToolRequest | null
  pendingToolConfirmationRequest: SessionToolConfirmationRequest | null
  metadata?: SessionMetadata
}

export type SessionEventType =
  | "user.message"
  | "user.define_outcome"
  | "user.interrupt"
  | "user.tool_confirmation"
  | "user.custom_tool_result"
  | "session.child_created"
  | "session.child_idle"
  | "session.status_changed"
  | "session.status_idle"
  | "span.started"
  | "span.completed"
  | "agent.message"
  | "agent.tool_use"
  | "agent.custom_tool_use"

interface BaseSessionEvent {
  id: string
  type: SessionEventType
  createdAt: string
  processedAt: string | null
  wakeId?: string | null
}

export interface UserMessageEvent extends BaseSessionEvent {
  type: "user.message"
  message: string
}

export interface UserDefineOutcomeEvent extends BaseSessionEvent {
  type: "user.define_outcome"
  outcome: SessionOutcomeDefinition
}

export interface UserInterruptEvent extends BaseSessionEvent {
  type: "user.interrupt"
  note: string | null
}

export interface UserToolConfirmationEvent extends BaseSessionEvent {
  type: "user.tool_confirmation"
  requestId: string
  toolName: string
  allowed: boolean
  note: string | null
}

export interface UserCustomToolResultEvent extends BaseSessionEvent {
  type: "user.custom_tool_result"
  requestId: string
  toolName: string
  output: string
}

export interface SessionChildCreatedEvent extends BaseSessionEvent {
  type: "session.child_created"
  childSessionId: string
  outcomeTitle: string | null
  message: string
}

export interface SessionChildIdleEvent extends BaseSessionEvent {
  type: "session.child_idle"
  childSessionId: string
  childStopReason: SessionStopReason
  summary: string
  executedCycles: number
}

export interface SessionStatusChangedEvent extends BaseSessionEvent {
  type: "session.status_changed"
  fromStatus: SessionStatus
  toStatus: SessionStatus
  reason: SessionStopReason
}

export interface SessionStatusIdleEvent extends BaseSessionEvent {
  type: "session.status_idle"
  reason: SessionStopReason
  summary: string
  blockingEventIds: string[] | null
}

export type SessionSpanKind = "wake" | "tool"
export type SessionSpanResult = "success" | "error" | "blocked"

export interface SpanStartedEvent extends BaseSessionEvent {
  type: "span.started"
  spanId: string
  parentSpanId: string | null
  spanKind: SessionSpanKind
  name: string
  summary: string | null
}

export interface SpanCompletedEvent extends BaseSessionEvent {
  type: "span.completed"
  spanId: string
  parentSpanId: string | null
  spanKind: SessionSpanKind
  name: string
  result: SessionSpanResult
  summary: string | null
}

export interface AgentMessageEvent extends BaseSessionEvent {
  type: "agent.message"
  message: string
  summary: string
}

export interface AgentToolUseEvent extends BaseSessionEvent {
  type: "agent.tool_use"
  requestId: string | null
  toolName: string
  ownership: ToolOwnership
  permissionPolicy: PermissionPolicy
  input: Record<string, unknown>
  output: string | null
}

export interface AgentCustomToolUseEvent extends BaseSessionEvent {
  type: "agent.custom_tool_use"
  requestId: string
  toolName: string
  input: Record<string, unknown>
}

export type SessionEvent =
  | UserMessageEvent
  | UserDefineOutcomeEvent
  | UserInterruptEvent
  | UserToolConfirmationEvent
  | UserCustomToolResultEvent
  | SessionChildCreatedEvent
  | SessionChildIdleEvent
  | SessionStatusChangedEvent
  | SessionStatusIdleEvent
  | SpanStartedEvent
  | SpanCompletedEvent
  | AgentMessageEvent
  | AgentToolUseEvent
  | AgentCustomToolUseEvent

export type PendingEvent = SessionEvent & {
  processedAt: null
}

export interface SandboxConfigShape {
  mode: "off" | "workspace"
  workspaceAccess: "none" | "ro" | "rw"
  networkAccess: "enabled" | "disabled"
  packagePolicy: "workspace" | "none"
}

export interface Environment {
  id: string
  name: string
  kind: "local"
  sandbox: SandboxConfigShape
  workspaceMountDefaults: {
    workspacePath: string
    runtimePath: string
  }
  createdAt: string
  updatedAt: string
}

export interface AgentDefinition {
  agentId: string
  provider: AgentProviderId
  model: string
  runner: AgentRunnerKind
}

export type ToolOwnership = "managed" | "mcp" | "custom"
export type PermissionPolicy = "always_allow" | "always_ask"
export type ToolEffect =
  | "session_read"
  | "session_write"
  | "resource_read"
  | "resource_write"
  | "memory_read"
  | "memory_write"
  | "learning_read"
  | "skill_read"
  | "sandbox_execute"
export type ToolInterruptBehavior = "cancel" | "block"

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  ownership: ToolOwnership
  permissionPolicy: PermissionPolicy
  effects: ToolEffect[]
  readOnly: boolean
  destructive: boolean
  interruptBehavior: ToolInterruptBehavior
}

export interface SandboxExecutionArtifact {
  sourceRef: string
  title: string
  mimeType?: string
}

export interface SandboxExecutionError {
  code: string
  message: string
  retryable: boolean
}

export interface SandboxActionExample {
  name: string
  description: string
  inputExample?: unknown
}

export interface SandboxActionCapability {
  name: string
  description: string
  access: "read_only" | "read_write"
}

export interface SandboxCommandPolicy {
  shell: boolean
  allowlistedCommands: string[]
  cwdScope: string
  maxTimeoutMs: number
  exposedEnvKeys: string[]
}

export interface SandboxDescription {
  kind: string
  summary: string
  provisionedResourceCount: number
  resources: Array<{
    id: string
    kind: ResourceAttachmentKind
    mountPath: string
    access: "read_only" | "read_write"
    scope?: string
  }>
  constraints: string[]
  actions: SandboxActionCapability[]
  commandPolicy?: SandboxCommandPolicy
  actionExamples: SandboxActionExample[]
}

export interface SandboxExecutionResult {
  ok: boolean
  name: string
  text: string | null
  output?: unknown
  artifacts: SandboxExecutionArtifact[]
  usage?: Record<string, number>
  error?: SandboxExecutionError | null
}

export interface Sandbox {
  provision(resources: ResourceAttachment[]): Promise<void>
  describe(): Promise<SandboxDescription>
  execute(name: string, input: unknown): Promise<SandboxExecutionResult>
}

export interface Harness {
  run(sessionId: string): Promise<HarnessRunResult>
}

export interface HarnessRunResult {
  session: Session
  wakeId: string | null
  response: string | null
  stopReason: SessionStopReason
  queuedWakes: Array<{
    reason: string
    delaySeconds: number
    dueAt: string
    note: string | null
    dedupeKey: string | null
    priority: "low" | "normal" | "high"
  }>
  processedEventIds: string[]
}
