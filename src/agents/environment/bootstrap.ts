import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { type AgentProviderId, normalizeProviderId } from "../providers/provider-capabilities.js"
import { loadAgentWorkspaceBootstrapSections } from "../workspace/bootstrap-files.js"

export interface BootstrapConfig {
  tokenBudget: number
  defaultProvider: AgentProviderId
  authProviders?: Array<"codex" | "claude-cli">
}

const DEFAULT_BOOTSTRAP: BootstrapConfig = {
  tokenBudget: 800,
  defaultProvider: "openai-codex",
  authProviders: ["codex"],
}

async function maybeReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

export async function loadBootstrapConfig(companyDir: string): Promise<BootstrapConfig> {
  const path = join(companyDir, ".openboa", "bootstrap", "runtime.json")
  const raw = await maybeReadText(path)
  if (!raw) {
    return DEFAULT_BOOTSTRAP
  }

  const parsed = JSON.parse(raw) as Partial<BootstrapConfig>
  const authProviders = Array.isArray(parsed.authProviders)
    ? Array.from(
        new Set(
          parsed.authProviders.filter(
            (provider): provider is "codex" | "claude-cli" =>
              provider === "codex" || provider === "claude-cli",
          ),
        ),
      )
    : DEFAULT_BOOTSTRAP.authProviders
  return {
    tokenBudget:
      typeof parsed.tokenBudget === "number" && parsed.tokenBudget > 0
        ? parsed.tokenBudget
        : DEFAULT_BOOTSTRAP.tokenBudget,
    defaultProvider:
      typeof parsed.defaultProvider === "string" && parsed.defaultProvider.trim().length > 0
        ? normalizeProviderId(parsed.defaultProvider)
        : DEFAULT_BOOTSTRAP.defaultProvider,
    authProviders,
  }
}

export async function buildSystemPrompt(companyDir: string, agentId: string): Promise<string> {
  const basePromptPath = join(companyDir, ".openboa", "system", "base.prompt")
  const agentPromptPath = join(companyDir, ".openboa", "system", "agents", `${agentId}.prompt`)

  const [basePrompt, agentPrompt, workspaceBootstrap] = await Promise.all([
    maybeReadText(basePromptPath),
    maybeReadText(agentPromptPath),
    loadAgentWorkspaceBootstrapSections(companyDir, agentId),
  ])

  const sections = [
    basePrompt?.trim() ? `<base-prompt>\n${basePrompt.trim()}\n</base-prompt>` : null,
    agentPrompt?.trim() ? `<agent-prompt>\n${agentPrompt.trim()}\n</agent-prompt>` : null,
    ...workspaceBootstrap.map((section, index) =>
      section.trim().length > 0
        ? `<workspace-bootstrap-section index="${String(index + 1)}">\n${section.trim()}\n</workspace-bootstrap-section>`
        : null,
    ),
  ].filter((part): part is string => Boolean(part && part.trim().length > 0))

  if (sections.length === 0) {
    return ""
  }

  return `<openboa-bootstrap-system>\n${sections.join("\n\n")}\n</openboa-bootstrap-system>`
}
