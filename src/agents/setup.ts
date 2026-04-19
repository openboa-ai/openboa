import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { type BootstrapConfig, loadBootstrapConfig } from "./environment/bootstrap.js"
import { EnvironmentStore } from "./environment/environment-store.js"
import type { AgentProviderId } from "./providers/provider-capabilities.js"
import { seedAgentWorkspaceBootstrapFiles } from "./workspace/bootstrap-files.js"

const DEFAULT_CODEX_AGENT_CONFIG = {
  runtime: {
    kind: "embedded",
    provider: "openai-codex",
    wakeLease: {
      staleAfterSeconds: 600,
      heartbeatSeconds: 60,
    },
  },
  model: {
    provider: "openai-codex",
    id: "gpt-5.4",
  },
  auth: {
    provider: "codex",
    required: true,
    method: "oauth-browser",
  },
  ui: {
    mode: "tui",
  },
  resilience: {
    profile: "resilient",
    retry: {
      recoverableWakeRetryDelayMs: 5000,
      wakeFailureReplayDelayMs: 2000,
      pendingEventBackoffBaseMs: 2000,
      pendingEventBackoffMaxMs: 30000,
    },
  },
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
  heartbeat: {
    enabled: true,
    intervalSeconds: 300,
    maxConsecutiveFollowUps: 3,
  },
} as const

const DEFAULT_CLAUDE_AGENT_CONFIG = {
  runtime: {
    kind: "cli",
    provider: "claude-cli",
    wakeLease: {
      staleAfterSeconds: 600,
      heartbeatSeconds: 60,
    },
  },
  model: {
    provider: "claude-cli",
    id: "opus",
  },
  auth: {
    provider: "codex",
    required: false,
    method: "oauth-browser",
  },
  ui: {
    mode: "tui",
  },
  resilience: {
    profile: "resilient",
    retry: {
      recoverableWakeRetryDelayMs: 5000,
      wakeFailureReplayDelayMs: 2000,
      pendingEventBackoffBaseMs: 2000,
      pendingEventBackoffMaxMs: 30000,
    },
  },
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
  heartbeat: {
    enabled: true,
    intervalSeconds: 300,
    maxConsecutiveFollowUps: 3,
  },
} as const

const DEFAULT_BOOTSTRAP = {
  tokenBudget: 800,
  defaultProvider: "openai-codex",
  authProviders: ["codex"],
}

const DEFAULT_BASE_PROMPT = "You are a concise and reliable operations agent."
export interface SetupResult {
  created: boolean
  configPath: string
}

export interface OpenboaSetupResult {
  companyDir: string
  created: boolean
  updated: boolean
  bootstrapConfigPath: string
  basePromptPath: string
  bootstrapConfig: BootstrapConfig
}

function isEexist(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "EEXIST"
}

export async function ensureCodexPiAgentConfig(
  companyDir: string,
  agentId = "pi-agent",
): Promise<SetupResult> {
  return ensureAgentConfig(companyDir, {
    agentId,
    provider: "openai-codex",
  })
}

export async function ensureAgentConfig(
  companyDir: string,
  options: {
    agentId?: string
    provider?: AgentProviderId
  } = {},
): Promise<SetupResult> {
  const agentId = options.agentId ?? "pi-agent"
  const bootstrap = await loadBootstrapConfig(companyDir)
  const provider = options.provider ?? bootstrap.defaultProvider
  const configPath = join(companyDir, ".openboa", "agents", agentId, "agent.json")
  const agentDir = join(companyDir, ".openboa", "agents", agentId)
  const agentWorkspaceDir = join(agentDir, "workspace")
  const agentSessionsDir = join(agentDir, "sessions")
  const agentRuntimeDir = join(agentDir, "runtime")
  const agentLearnDir = join(agentDir, "learn")

  await mkdir(agentDir, { recursive: true })
  await mkdir(agentWorkspaceDir, { recursive: true })
  await mkdir(agentSessionsDir, { recursive: true })
  await mkdir(agentRuntimeDir, { recursive: true })
  await mkdir(agentLearnDir, { recursive: true })
  await seedAgentWorkspaceBootstrapFiles(companyDir, agentId)

  try {
    const scaffold =
      provider === "claude-cli" ? DEFAULT_CLAUDE_AGENT_CONFIG : DEFAULT_CODEX_AGENT_CONFIG
    await writeFile(configPath, `${JSON.stringify(scaffold, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    })
    return { created: true, configPath }
  } catch (error) {
    if (isEexist(error)) {
      return { created: false, configPath }
    }

    throw error
  }
}

export async function ensureOpenboaSetup(companyDir: string): Promise<OpenboaSetupResult> {
  return ensureOpenboaSetupWithOptions(companyDir, {})
}

export async function ensureOpenboaSetupWithOptions(
  companyDir: string,
  options: {
    defaultProvider?: AgentProviderId
    authProviders?: Array<"codex" | "claude-cli">
  } = {},
): Promise<OpenboaSetupResult> {
  const root = join(companyDir, ".openboa")
  const bootstrapDir = join(root, "bootstrap")
  const systemDir = join(root, "system")
  const agentPromptDir = join(systemDir, "agents")
  const authDir = join(root, "auth")
  const agentsDir = join(root, "agents")
  const vaultsDir = join(root, "vaults")

  const bootstrapConfigPath = join(bootstrapDir, "runtime.json")
  const basePromptPath = join(systemDir, "base.prompt")

  let created = false
  let updated = false

  await mkdir(root, { recursive: true })
  await mkdir(bootstrapDir, { recursive: true })
  await mkdir(systemDir, { recursive: true })
  await mkdir(agentPromptDir, { recursive: true })
  await mkdir(authDir, { recursive: true })
  await mkdir(agentsDir, { recursive: true })
  await mkdir(vaultsDir, { recursive: true })
  await new EnvironmentStore(companyDir).ensureDefaultLocalEnvironment()

  let existingBootstrap: BootstrapConfig | null = null
  try {
    const raw = await readFile(bootstrapConfigPath, "utf8")
    existingBootstrap = JSON.parse(raw) as BootstrapConfig
  } catch {
    existingBootstrap = null
  }

  const defaultProvider =
    options.defaultProvider ?? existingBootstrap?.defaultProvider ?? "openai-codex"
  const authProviders = options.authProviders ?? existingBootstrap?.authProviders ?? ["codex"]
  const normalizedBootstrap: BootstrapConfig = {
    tokenBudget:
      typeof existingBootstrap?.tokenBudget === "number" && existingBootstrap.tokenBudget > 0
        ? existingBootstrap.tokenBudget
        : DEFAULT_BOOTSTRAP.tokenBudget,
    defaultProvider,
    authProviders,
  }

  const nextBootstrapRaw = `${JSON.stringify(normalizedBootstrap, null, 2)}\n`
  if (!existingBootstrap) {
    await writeFile(bootstrapConfigPath, nextBootstrapRaw, {
      encoding: "utf8",
    })
    created = true
  } else {
    const previousBootstrapRaw = `${JSON.stringify(existingBootstrap, null, 2)}\n`
    if (previousBootstrapRaw !== nextBootstrapRaw) {
      await writeFile(bootstrapConfigPath, nextBootstrapRaw, {
        encoding: "utf8",
      })
      updated = true
    }
  }

  try {
    await writeFile(basePromptPath, `${DEFAULT_BASE_PROMPT}\n`, {
      encoding: "utf8",
      flag: "wx",
    })
    created = true
  } catch (error) {
    if (!isEexist(error)) {
      throw error
    }
  }

  return {
    companyDir,
    created,
    updated,
    bootstrapConfigPath,
    basePromptPath,
    bootstrapConfig: normalizedBootstrap,
  }
}
