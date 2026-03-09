import { randomUUID } from "node:crypto"

import { PiRuntimeAdapter } from "./adapter/pi-adapter.js"
import { loadAgentConfig } from "./agent-config.js"
import { CodexAuthProvider } from "./auth/codex-auth.js"
import { buildSystemPrompt, loadBootstrapConfig } from "./bootstrap.js"
import { buildContext } from "./context-builder.js"
import type { TurnEnvelope, TurnEvent } from "./protocol.js"
import { nowIsoString } from "./protocol.js"
import { ChatStore } from "./storage/chat-store.js"
import { SessionStore } from "./storage/session-store.js"

export interface BoaRuntimeOptions {
  workspaceDir: string
  chatStore?: ChatStore
  sessionStore?: SessionStore
  adapter?: PiRuntimeAdapter
  authProvider?: CodexAuthProvider
}

export class BoaRuntime {
  private readonly chatStore: ChatStore
  private readonly sessionStore: SessionStore
  private readonly adapter: PiRuntimeAdapter
  private readonly authProvider: CodexAuthProvider

  constructor(private readonly options: BoaRuntimeOptions) {
    this.chatStore = options.chatStore ?? new ChatStore(options.workspaceDir)
    this.sessionStore = options.sessionStore ?? new SessionStore(options.workspaceDir)
    this.adapter = options.adapter ?? new PiRuntimeAdapter()
    this.authProvider = options.authProvider ?? new CodexAuthProvider(options.workspaceDir)
  }

  async *runTurn(turn: TurnEnvelope): AsyncGenerator<TurnEvent> {
    const agentConfig = await loadAgentConfig(this.options.workspaceDir, turn.agentId)
    if (agentConfig.runtime !== "pi") {
      throw new Error(`unsupported agent runtime: ${agentConfig.runtime}`)
    }

    const auth = await this.authProvider.resolve()
    if (
      agentConfig.auth.provider === "codex" &&
      agentConfig.auth.required &&
      auth.mode === "none"
    ) {
      if (agentConfig.auth.method === "oauth-browser") {
        throw new Error(
          `codex auth required for agent: ${turn.agentId}. run 'codex login' to open browser oauth first`,
        )
      }
      throw new Error(`codex auth required for agent: ${turn.agentId}`)
    }

    const timestamp = turn.timestamp ?? nowIsoString()
    const previousCheckpoint = await this.sessionStore.latestCheckpoint(
      turn.agentId,
      turn.sessionId,
    )

    await this.chatStore.append({
      type: "inbound",
      chatId: turn.chatId,
      sessionId: turn.sessionId,
      agentId: turn.agentId,
      sender: turn.sender,
      recipient: turn.recipient,
      message: turn.message,
      timestamp,
    })

    const bootstrap = await loadBootstrapConfig(this.options.workspaceDir)
    const systemPrompt = await buildSystemPrompt(this.options.workspaceDir, turn.agentId)
    const history = await this.chatStore.list(turn.chatId)
    const context = buildContext(history, systemPrompt, turn.message, bootstrap.tokenBudget)

    const response = await this.adapter.generateResponse({
      agentId: turn.agentId,
      message: turn.message,
      systemPrompt,
      context,
      auth,
    })

    for await (const delta of this.adapter.streamResponse(response)) {
      yield {
        kind: "turn.chunk",
        chatId: turn.chatId,
        sessionId: turn.sessionId,
        agentId: turn.agentId,
        delta,
      }
    }

    await this.chatStore.append({
      type: "outbound",
      chatId: turn.chatId,
      sessionId: turn.sessionId,
      agentId: turn.agentId,
      sender: {
        kind: "agent",
        id: turn.agentId,
      },
      recipient: turn.sender,
      message: response,
      timestamp: nowIsoString(),
    })

    const checkpointId = `${turn.sessionId}:${randomUUID()}`
    await this.sessionStore.append({
      kind: "turn.completed",
      chatId: turn.chatId,
      sessionId: turn.sessionId,
      agentId: turn.agentId,
      requestMessage: turn.message,
      responseMessage: response,
      authMode: auth.mode,
      checkpoint: {
        checkpointId,
        previousCheckpointId: previousCheckpoint?.checkpointId ?? null,
        createdAt: nowIsoString(),
      },
    })

    yield {
      kind: "turn.final",
      chatId: turn.chatId,
      sessionId: turn.sessionId,
      agentId: turn.agentId,
      response,
      checkpointId,
      recoveredFromCheckpoint: previousCheckpoint !== null,
      recoveredCheckpointId: previousCheckpoint?.checkpointId ?? null,
      authMode: auth.mode,
    }
  }
}
