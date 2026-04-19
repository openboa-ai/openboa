import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type AgentProviderId,
  normalizeProviderId,
  resolveProviderCapabilities,
} from "./providers/provider-capabilities.js"
import type { SandboxConfig } from "./sandbox/sandbox-policy.js"
import type { AgentSkillsConfig } from "./skills/agent-skills.js"
import type { ToolPolicyLike } from "./tools/tool-policy.js"

export type CodexAuthMethod = "oauth-browser" | "api-key"

export interface AgentAuthConfig {
  provider: "codex"
  required: boolean
  method: CodexAuthMethod
}

export interface AgentUiConfig {
  mode: "tui"
}

export interface AgentWakeLeaseConfig {
  staleAfterSeconds: number
  heartbeatSeconds: number
}

export type AgentResilienceProfile = "resilient"

export interface AgentResilienceRetryConfig {
  recoverableWakeRetryDelayMs: number
  wakeFailureReplayDelayMs: number
  pendingEventBackoffBaseMs: number
  pendingEventBackoffMaxMs: number
}

export interface AgentResilienceConfig {
  profile: AgentResilienceProfile
  retry: AgentResilienceRetryConfig
}

export interface AgentRuntimeConfig {
  kind: "embedded" | "cli"
  provider: AgentProviderId
  wakeLease: AgentWakeLeaseConfig
}

export interface AgentModelConfig {
  provider: AgentProviderId
  id: string
}

export interface AgentSessionConfig {
  reuse: "provider" | "none"
}

export interface AgentHeartbeatConfig {
  enabled: boolean
  intervalSeconds: number
  maxConsecutiveFollowUps: number
}

export interface AgentConfig {
  runtime: AgentRuntimeConfig
  model: AgentModelConfig
  auth: AgentAuthConfig
  ui: AgentUiConfig
  resilience: AgentResilienceConfig
  tools?: ToolPolicyLike
  sandbox?: SandboxConfig
  skills?: AgentSkillsConfig
  session?: AgentSessionConfig
  heartbeat?: AgentHeartbeatConfig
}

export function agentConfigPath(companyDir: string, agentId: string): string {
  return join(companyDir, ".openboa", "agents", agentId, "agent.json")
}

const DEFAULT_PROVIDER = "openai-codex" as const
const DEFAULT_AGENT_WAKE_LEASE: AgentWakeLeaseConfig = {
  staleAfterSeconds: 10 * 60,
  heartbeatSeconds: 60,
}
const DEFAULT_AGENT_HEARTBEAT: AgentHeartbeatConfig = {
  enabled: true,
  intervalSeconds: 300,
  maxConsecutiveFollowUps: 3,
}
const DEFAULT_AGENT_RESILIENCE: AgentResilienceConfig = {
  profile: "resilient",
  retry: {
    recoverableWakeRetryDelayMs: 5_000,
    wakeFailureReplayDelayMs: 2_000,
    pendingEventBackoffBaseMs: 2_000,
    pendingEventBackoffMaxMs: 30_000,
  },
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  runtime: {
    kind: "embedded",
    provider: DEFAULT_PROVIDER,
    wakeLease: DEFAULT_AGENT_WAKE_LEASE,
  },
  model: {
    provider: DEFAULT_PROVIDER,
    id: resolveProviderCapabilities(DEFAULT_PROVIDER).defaultModel,
  },
  auth: {
    provider: "codex",
    required: false,
    method: "oauth-browser",
  },
  ui: {
    mode: "tui",
  },
  resilience: DEFAULT_AGENT_RESILIENCE,
  tools: {
    profile: "default",
  },
  sandbox: {
    mode: "workspace",
    workspaceAccess: "rw",
  },
  skills: {
    enabled: true,
  },
  session: {
    reuse: "provider",
  },
  heartbeat: DEFAULT_AGENT_HEARTBEAT,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const normalized = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return normalized.length > 0 ? normalized : undefined
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseToolPolicy(value: unknown): ToolPolicyLike | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const allow = readStringArray(value.allow)
  const alsoAllow = readStringArray(value.alsoAllow)
  const deny = readStringArray(value.deny)
  const profile =
    typeof value.profile === "string" && value.profile.trim() ? value.profile.trim() : undefined

  if (!allow && !alsoAllow && !deny && !profile) {
    return undefined
  }

  return {
    ...(allow ? { allow } : {}),
    ...(alsoAllow ? { alsoAllow } : {}),
    ...(deny ? { deny } : {}),
    ...(profile ? { profile } : {}),
  }
}

function parseSandboxConfig(value: unknown): SandboxConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const mode = value.mode === "workspace" ? "workspace" : value.mode === "off" ? "off" : undefined
  const workspaceAccess =
    value.workspaceAccess === "none" ||
    value.workspaceAccess === "ro" ||
    value.workspaceAccess === "rw"
      ? value.workspaceAccess
      : undefined
  const tools = parseToolPolicy(value.tools)

  if (!mode && !workspaceAccess && !tools) {
    return undefined
  }

  return {
    ...(mode ? { mode } : {}),
    ...(workspaceAccess ? { workspaceAccess } : {}),
    ...(tools ? { tools } : {}),
  }
}

function parseSkillsConfig(value: unknown): AgentSkillsConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined
  const directories = readStringArray(value.directories)
  const include = readOptionalStringArray(value.include)
  const maxPromptEntries =
    typeof value.maxPromptEntries === "number" && Number.isFinite(value.maxPromptEntries)
      ? value.maxPromptEntries
      : undefined

  if (enabled === undefined && !directories && !include && maxPromptEntries === undefined) {
    return undefined
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(directories ? { directories } : {}),
    ...(include ? { include } : {}),
    ...(maxPromptEntries !== undefined ? { maxPromptEntries } : {}),
  }
}

function parseSessionConfig(value: unknown): AgentSessionConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const reuse =
    value.reuse === "none" ? "none" : value.reuse === "provider" ? "provider" : undefined
  return reuse ? { reuse } : undefined
}

function parseHeartbeatConfig(value: unknown): AgentHeartbeatConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined
  const intervalSeconds =
    typeof value.intervalSeconds === "number" &&
    Number.isFinite(value.intervalSeconds) &&
    value.intervalSeconds > 0
      ? Math.floor(value.intervalSeconds)
      : undefined
  const maxConsecutiveFollowUps =
    typeof value.maxConsecutiveFollowUps === "number" &&
    Number.isFinite(value.maxConsecutiveFollowUps) &&
    value.maxConsecutiveFollowUps >= 0
      ? Math.floor(value.maxConsecutiveFollowUps)
      : undefined

  if (
    enabled === undefined &&
    intervalSeconds === undefined &&
    maxConsecutiveFollowUps === undefined
  ) {
    return undefined
  }

  return {
    enabled: enabled ?? DEFAULT_AGENT_HEARTBEAT.enabled,
    intervalSeconds: intervalSeconds ?? DEFAULT_AGENT_HEARTBEAT.intervalSeconds,
    maxConsecutiveFollowUps:
      maxConsecutiveFollowUps ?? DEFAULT_AGENT_HEARTBEAT.maxConsecutiveFollowUps,
  }
}

function parseWakeLeaseConfig(value: unknown): AgentWakeLeaseConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const staleAfterSeconds =
    typeof value.staleAfterSeconds === "number" &&
    Number.isFinite(value.staleAfterSeconds) &&
    value.staleAfterSeconds > 0
      ? Math.floor(value.staleAfterSeconds)
      : undefined
  const heartbeatSeconds =
    typeof value.heartbeatSeconds === "number" &&
    Number.isFinite(value.heartbeatSeconds) &&
    value.heartbeatSeconds > 0
      ? Math.floor(value.heartbeatSeconds)
      : undefined

  if (staleAfterSeconds === undefined && heartbeatSeconds === undefined) {
    return undefined
  }

  return {
    staleAfterSeconds: staleAfterSeconds ?? DEFAULT_AGENT_WAKE_LEASE.staleAfterSeconds,
    heartbeatSeconds: heartbeatSeconds ?? DEFAULT_AGENT_WAKE_LEASE.heartbeatSeconds,
  }
}

function resolveLegacyProvider(parsed: Record<string, unknown>): AgentProviderId {
  const runtimeValue = parsed.runtime
  if (runtimeValue === "pi") {
    return "openai-codex"
  }
  if (runtimeValue === "claude-cli" || runtimeValue === "claude-code") {
    return "claude-cli"
  }

  const authValue = parsed.auth
  if (isRecord(authValue) && authValue.provider === "codex") {
    return "openai-codex"
  }

  return DEFAULT_PROVIDER
}

function parseRuntimeConfig(
  parsed: Record<string, unknown>,
  providerFromLegacy: AgentProviderId,
): AgentRuntimeConfig {
  const runtimeValue = parsed.runtime
  if (isRecord(runtimeValue)) {
    const provider = normalizeProviderId(
      typeof runtimeValue.provider === "string" ? runtimeValue.provider : providerFromLegacy,
    )
    const kind =
      runtimeValue.kind === "cli" || runtimeValue.kind === "embedded"
        ? runtimeValue.kind
        : resolveProviderCapabilities(provider).runner
    return {
      kind,
      provider,
      wakeLease: parseWakeLeaseConfig(runtimeValue.wakeLease) ?? DEFAULT_AGENT_WAKE_LEASE,
    }
  }

  if (
    runtimeValue !== undefined &&
    runtimeValue !== "pi" &&
    runtimeValue !== "claude-cli" &&
    runtimeValue !== "claude-code"
  ) {
    throw new Error(`unsupported agent runtime: ${String(runtimeValue)}`)
  }

  const provider = providerFromLegacy
  return {
    kind: resolveProviderCapabilities(provider).runner,
    provider,
    wakeLease: DEFAULT_AGENT_WAKE_LEASE,
  }
}

function parseModelConfig(
  parsed: Record<string, unknown>,
  runtime: AgentRuntimeConfig,
): AgentModelConfig {
  const modelValue = parsed.model
  if (isRecord(modelValue)) {
    const provider = normalizeProviderId(
      typeof modelValue.provider === "string" ? modelValue.provider : runtime.provider,
    )
    const idRaw =
      typeof modelValue.id === "string" && modelValue.id.trim()
        ? modelValue.id.trim()
        : resolveProviderCapabilities(provider).defaultModel
    return { provider, id: idRaw }
  }

  if (typeof modelValue === "string" && modelValue.trim()) {
    return { provider: runtime.provider, id: modelValue.trim() }
  }

  return {
    provider: runtime.provider,
    id: resolveProviderCapabilities(runtime.provider).defaultModel,
  }
}

function parseAuthConfig(
  parsed: Record<string, unknown>,
  runtime: AgentRuntimeConfig,
): AgentAuthConfig {
  if (runtime.provider !== "openai-codex") {
    return {
      provider: "codex",
      required: false,
      method: "oauth-browser",
    }
  }

  const authValue = parsed.auth
  if (authValue !== undefined && !isRecord(authValue)) {
    throw new Error("invalid agent auth config")
  }

  const provider = isRecord(authValue) ? authValue.provider : undefined
  if (provider !== undefined && provider !== "codex") {
    throw new Error(`unsupported auth provider: ${String(provider)}`)
  }

  const required = isRecord(authValue) ? authValue.required : undefined
  if (required !== undefined && typeof required !== "boolean") {
    throw new Error(`invalid auth.required value: ${String(required)}`)
  }

  const method = isRecord(authValue) ? authValue.method : undefined
  if (method !== undefined && method !== "oauth-browser" && method !== "api-key") {
    throw new Error(`unsupported auth method: ${String(method)}`)
  }

  return {
    provider: "codex",
    required: required ?? DEFAULT_AGENT_CONFIG.auth.required,
    method: method ?? DEFAULT_AGENT_CONFIG.auth.method,
  }
}

function parseUiConfig(parsed: Record<string, unknown>): AgentUiConfig {
  const uiValue = parsed.ui
  if (uiValue !== undefined && !isRecord(uiValue)) {
    throw new Error("invalid agent ui config")
  }
  const uiMode = isRecord(uiValue) ? uiValue.mode : undefined
  if (uiMode !== undefined && uiMode !== "tui") {
    throw new Error(`unsupported ui mode: ${String(uiMode)}`)
  }
  return { mode: "tui" }
}

function parseResilienceConfig(value: unknown): AgentResilienceConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const profile = value.profile === "resilient" ? "resilient" : undefined
  const retryValue = isRecord(value.retry) ? value.retry : null
  const recoverableWakeRetryDelayMs =
    retryValue &&
    typeof retryValue.recoverableWakeRetryDelayMs === "number" &&
    Number.isFinite(retryValue.recoverableWakeRetryDelayMs) &&
    retryValue.recoverableWakeRetryDelayMs >= 0
      ? Math.floor(retryValue.recoverableWakeRetryDelayMs)
      : undefined
  const wakeFailureReplayDelayMs =
    retryValue &&
    typeof retryValue.wakeFailureReplayDelayMs === "number" &&
    Number.isFinite(retryValue.wakeFailureReplayDelayMs) &&
    retryValue.wakeFailureReplayDelayMs >= 0
      ? Math.floor(retryValue.wakeFailureReplayDelayMs)
      : undefined
  const pendingEventBackoffBaseMs =
    retryValue &&
    typeof retryValue.pendingEventBackoffBaseMs === "number" &&
    Number.isFinite(retryValue.pendingEventBackoffBaseMs) &&
    retryValue.pendingEventBackoffBaseMs >= 0
      ? Math.floor(retryValue.pendingEventBackoffBaseMs)
      : undefined
  const pendingEventBackoffMaxMs =
    retryValue &&
    typeof retryValue.pendingEventBackoffMaxMs === "number" &&
    Number.isFinite(retryValue.pendingEventBackoffMaxMs) &&
    retryValue.pendingEventBackoffMaxMs >= 0
      ? Math.floor(retryValue.pendingEventBackoffMaxMs)
      : undefined

  if (
    profile === undefined &&
    recoverableWakeRetryDelayMs === undefined &&
    wakeFailureReplayDelayMs === undefined &&
    pendingEventBackoffBaseMs === undefined &&
    pendingEventBackoffMaxMs === undefined
  ) {
    return undefined
  }

  return {
    profile: profile ?? DEFAULT_AGENT_RESILIENCE.profile,
    retry: {
      recoverableWakeRetryDelayMs:
        recoverableWakeRetryDelayMs ?? DEFAULT_AGENT_RESILIENCE.retry.recoverableWakeRetryDelayMs,
      wakeFailureReplayDelayMs:
        wakeFailureReplayDelayMs ?? DEFAULT_AGENT_RESILIENCE.retry.wakeFailureReplayDelayMs,
      pendingEventBackoffBaseMs:
        pendingEventBackoffBaseMs ?? DEFAULT_AGENT_RESILIENCE.retry.pendingEventBackoffBaseMs,
      pendingEventBackoffMaxMs:
        pendingEventBackoffMaxMs ?? DEFAULT_AGENT_RESILIENCE.retry.pendingEventBackoffMaxMs,
    },
  }
}

export async function loadAgentConfig(companyDir: string, agentId: string): Promise<AgentConfig> {
  const configPath = agentConfigPath(companyDir, agentId)
  let parsed: unknown

  try {
    const raw = await readFile(configPath, "utf8")
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_AGENT_CONFIG
  }

  if (!isRecord(parsed)) {
    throw new Error(`invalid agent config: ${configPath}`)
  }

  const providerFromLegacy = resolveLegacyProvider(parsed)
  const runtime = parseRuntimeConfig(parsed, providerFromLegacy)
  const model = parseModelConfig(parsed, runtime)
  const auth = parseAuthConfig(parsed, runtime)
  const ui = parseUiConfig(parsed)
  const resilience = parseResilienceConfig(parsed.resilience) ?? DEFAULT_AGENT_CONFIG.resilience
  const tools = parseToolPolicy(parsed.tools) ?? DEFAULT_AGENT_CONFIG.tools
  const sandbox = parseSandboxConfig(parsed.sandbox) ?? DEFAULT_AGENT_CONFIG.sandbox
  const skills = parseSkillsConfig(parsed.skills) ?? DEFAULT_AGENT_CONFIG.skills
  const session = parseSessionConfig(parsed.session) ?? DEFAULT_AGENT_CONFIG.session
  const heartbeat = parseHeartbeatConfig(parsed.heartbeat) ?? DEFAULT_AGENT_CONFIG.heartbeat

  return {
    runtime,
    model,
    auth,
    ui,
    resilience,
    ...(tools ? { tools } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(skills ? { skills } : {}),
    ...(session ? { session } : {}),
    ...(heartbeat ? { heartbeat } : {}),
  }
}

export interface ResolvedWakeLeasePolicy {
  staleAfterMs: number
  heartbeatMs: number
}

export function resolveWakeLeasePolicy(
  runtime: Pick<AgentRuntimeConfig, "wakeLease">,
): ResolvedWakeLeasePolicy {
  return {
    staleAfterMs: runtime.wakeLease.staleAfterSeconds * 1000,
    heartbeatMs: runtime.wakeLease.heartbeatSeconds * 1000,
  }
}

export function agentHasSkill(config: AgentConfig, skillName: string): boolean {
  if (config.skills?.enabled === false) {
    return false
  }
  const include = config.skills?.include
  if (!include || include.length === 0) {
    return false
  }
  return include.includes(skillName)
}
