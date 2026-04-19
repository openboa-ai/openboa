import { loadAgentConfig } from "./agent-config.js"
import type { AgentDefinition } from "./schema/runtime.js"

export async function loadAgentDefinition(
  companyDir: string,
  agentId: string,
): Promise<AgentDefinition> {
  const config = await loadAgentConfig(companyDir, agentId)
  return {
    agentId,
    provider: config.runtime.provider,
    model: config.model.id,
    runner: config.runtime.kind,
  }
}
