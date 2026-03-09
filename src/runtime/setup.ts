import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const DEFAULT_AGENT_CONFIG = {
  runtime: "pi",
  auth: {
    provider: "codex",
    required: true,
    method: "oauth-browser",
  },
  ui: {
    mode: "tui",
  },
} as const

const DEFAULT_BOOTSTRAP = {
  tokenBudget: 800,
}

const DEFAULT_BASE_PROMPT = "You are a concise and reliable operations agent."

export interface SetupResult {
  created: boolean
  configPath: string
}

export interface OpenboaSetupResult {
  workspaceDir: string
  created: boolean
  bootstrapConfigPath: string
  basePromptPath: string
}

function isEexist(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "EEXIST"
}

export async function ensureCodexPiAgentConfig(
  workspaceDir: string,
  agentId = "pi-agent",
): Promise<SetupResult> {
  const configPath = join(workspaceDir, ".openboa", "agents", agentId, "agent.json")
  const agentDir = join(workspaceDir, ".openboa", "agents", agentId)

  await mkdir(agentDir, { recursive: true })

  try {
    await writeFile(configPath, `${JSON.stringify(DEFAULT_AGENT_CONFIG, null, 2)}\n`, {
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

export async function ensureOpenboaSetup(workspaceDir: string): Promise<OpenboaSetupResult> {
  const root = join(workspaceDir, ".openboa")
  const bootstrapDir = join(root, "bootstrap")
  const systemDir = join(root, "system")
  const agentPromptDir = join(systemDir, "agents")
  const authDir = join(root, "auth")
  const agentsDir = join(root, "agents")

  const bootstrapConfigPath = join(bootstrapDir, "runtime.json")
  const basePromptPath = join(systemDir, "base.prompt")

  let created = false

  await mkdir(root, { recursive: true })
  await mkdir(bootstrapDir, { recursive: true })
  await mkdir(systemDir, { recursive: true })
  await mkdir(agentPromptDir, { recursive: true })
  await mkdir(authDir, { recursive: true })
  await mkdir(agentsDir, { recursive: true })

  // Keep bootstrap/system files idempotent and optional overwrite-free for safety.
  try {
    await writeFile(bootstrapConfigPath, `${JSON.stringify(DEFAULT_BOOTSTRAP, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    })
    created = true
  } catch (error) {
    if (!isEexist(error)) {
      throw error
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
    workspaceDir,
    created,
    bootstrapConfigPath,
    basePromptPath,
  }
}
