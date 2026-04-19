import type { AgentConfig } from "../agent-config.js"
import type { CodexAuth } from "../auth/codex-auth.js"
import { runClaudeCliAgent } from "../backends/claude-cli-runner.js"
import type { CliSessionBinding } from "../backends/cli-session.js"
import type { BuiltContext } from "../context/model.js"
import type { AgentProviderId, AgentRunnerKind } from "../providers/provider-capabilities.js"
import type { SessionToolConfirmationRequest } from "../schema/runtime.js"
import {
  type AgentRuntimeToolDefinition,
  ToolConfirmationRequiredError,
} from "../tools/runtime-tool.js"
import { PiRuntimeAdapter } from "./pi-adapter.js"

export interface AgentRunnerInput {
  companyDir: string
  agentId: string
  message: string
  systemPrompt: string
  context: BuiltContext
  auth: CodexAuth
  agentConfig: AgentConfig
  tools?: AgentRuntimeToolDefinition[]
  cliSessionBinding?: CliSessionBinding
  signal?: AbortSignal
}

export interface AgentRunnerResult {
  response: string | null
  authMode: CodexAuth["mode"]
  provider: AgentProviderId
  model: string
  runner: AgentRunnerKind
  cliSessionBinding?: CliSessionBinding
  interruption?: {
    kind: "tool_confirmation_required"
    request: SessionToolConfirmationRequest
  } | null
}

export class AgentAuthRequiredError extends Error {
  constructor(readonly provider: AgentProviderId) {
    super(
      `Authentication is required for provider ${provider}. Run "openboa auth login --provider ${provider}" before waking this session.`,
    )
    this.name = "AgentAuthRequiredError"
  }
}

export class AgentTurnRunner {
  constructor(private readonly embeddedAdapter: PiRuntimeAdapter = new PiRuntimeAdapter()) {}

  async run(input: AgentRunnerInput): Promise<AgentRunnerResult> {
    if (input.agentConfig.auth.required && input.auth.mode === "none") {
      throw new AgentAuthRequiredError(input.agentConfig.runtime.provider)
    }

    if (
      input.agentConfig.runtime.kind === "cli" &&
      input.agentConfig.runtime.provider === "claude-cli"
    ) {
      throwIfAborted(input.signal)
      const result = await runClaudeCliAgent({
        companyDir: input.companyDir,
        prompt: input.message,
        systemPrompt: input.systemPrompt,
        model: input.agentConfig.model.id,
        cliSessionBinding: input.cliSessionBinding,
      })

      return {
        response: result.text,
        authMode: "none",
        provider: "claude-cli",
        model: input.agentConfig.model.id,
        runner: "cli",
        interruption: null,
        ...(result.sessionId
          ? {
              cliSessionBinding: {
                sessionId: result.sessionId,
              },
            }
          : {}),
      }
    }

    try {
      const response = await this.embeddedAdapter.generateResponse({
        agentId: input.agentId,
        message: input.message,
        systemPrompt: input.systemPrompt,
        context: input.context,
        auth: input.auth,
        tools: input.tools,
        signal: input.signal,
      })

      return {
        response,
        authMode: input.auth.mode,
        provider: "openai-codex",
        model: input.agentConfig.model.id,
        runner: "embedded",
        interruption: null,
      }
    } catch (error) {
      if (error instanceof ToolConfirmationRequiredError) {
        return {
          response: null,
          authMode: input.auth.mode,
          provider: "openai-codex",
          model: input.agentConfig.model.id,
          runner: "embedded",
          interruption: {
            kind: "tool_confirmation_required",
            request: error.request,
          },
        }
      }
      throw error
    }
  }

  async *streamResponse(result: AgentRunnerResult): AsyncGenerator<string> {
    if (!result.response) {
      return
    }
    if (result.runner === "embedded") {
      for await (const delta of this.embeddedAdapter.streamResponse(result.response)) {
        yield delta
      }
      return
    }

    const parts = result.response.split(" ")
    for (const [index, part] of parts.entries()) {
      const suffix = index === parts.length - 1 ? "" : " "
      yield `${part}${suffix}`
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError")
  }
}
