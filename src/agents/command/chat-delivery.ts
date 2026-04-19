import { loadAgentConfig } from "../agent-config.js"
import { CodexAuthProvider } from "../auth/codex-auth.js"
import type { BuiltContext } from "../context/model.js"
import { AgentTurnRunner } from "../runners/agent-runner.js"

export interface DeliverChatBoundAgentTurnInput {
  companyDir: string
  agentId: string
  message: string
  systemPrompt: string
  context: BuiltContext
}

export interface DeliverChatBoundAgentTurnResult {
  response: string
}

export interface AgentChatDeliveryPort {
  deliver(input: DeliverChatBoundAgentTurnInput): Promise<DeliverChatBoundAgentTurnResult>
}

export class AgentChatDelivery implements AgentChatDeliveryPort {
  constructor(
    private readonly companyDir: string,
    private readonly runner: Pick<AgentTurnRunner, "run"> = new AgentTurnRunner(),
    private readonly authProvider: Pick<CodexAuthProvider, "resolve"> = new CodexAuthProvider(
      companyDir,
    ),
  ) {}

  async deliver(input: DeliverChatBoundAgentTurnInput): Promise<DeliverChatBoundAgentTurnResult> {
    const [auth, agentConfig] = await Promise.all([
      this.authProvider.resolve(),
      loadAgentConfig(input.companyDir, input.agentId),
    ])
    const result = await this.runner.run({
      companyDir: input.companyDir,
      agentId: input.agentId,
      message: input.message,
      systemPrompt: input.systemPrompt,
      context: input.context,
      auth,
      agentConfig,
    })

    return {
      response: result.response ?? "",
    }
  }
}
