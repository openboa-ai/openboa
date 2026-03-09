import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface BootstrapConfig {
  tokenBudget: number
}

const DEFAULT_BOOTSTRAP: BootstrapConfig = {
  tokenBudget: 800,
}

async function maybeReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

export async function loadBootstrapConfig(workspaceDir: string): Promise<BootstrapConfig> {
  const path = join(workspaceDir, ".openboa", "bootstrap", "runtime.json")
  const raw = await maybeReadText(path)
  if (!raw) {
    return DEFAULT_BOOTSTRAP
  }

  const parsed = JSON.parse(raw) as Partial<BootstrapConfig>
  return {
    tokenBudget:
      typeof parsed.tokenBudget === "number" && parsed.tokenBudget > 0
        ? parsed.tokenBudget
        : DEFAULT_BOOTSTRAP.tokenBudget,
  }
}

export async function buildSystemPrompt(workspaceDir: string, agentId: string): Promise<string> {
  const basePromptPath = join(workspaceDir, ".openboa", "system", "base.prompt")
  const agentPromptPath = join(workspaceDir, ".openboa", "system", "agents", `${agentId}.prompt`)

  const basePrompt = (await maybeReadText(basePromptPath))?.trim() ?? ""
  const agentPrompt = (await maybeReadText(agentPromptPath))?.trim() ?? ""

  return [basePrompt, agentPrompt].filter((part) => part.length > 0).join("\n\n")
}
