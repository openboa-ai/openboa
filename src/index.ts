import { createMinimalPiRuntime } from "./runtime/factory.js"
import { ensureCodexPiAgentConfig } from "./runtime/setup.js"

export const OPENBOA_VERSION = "0.1.0"

export { createMinimalPiRuntime } from "./runtime/factory.js"
export type {
  ParticipantRef,
  TurnChunkEvent,
  TurnEnvelope,
  TurnEvent,
  TurnFinalEvent,
} from "./runtime/protocol.js"
export { ensureCodexPiAgentConfig } from "./runtime/setup.js"

async function runCli(): Promise<void> {
  const args = process.argv.slice(2)
  if (args[0] === "setup-codex-pi-agent") {
    const agentId = args[1] ?? "pi-agent"
    const result = await ensureCodexPiAgentConfig(process.cwd(), agentId)
    process.stdout.write(`${result.created ? "created" : "exists"}: ${result.configPath}\n`)
    return
  }

  const message = args.join(" ").trim()
  if (!message) {
    console.log('usage: pnpm dev -- "hello pi runtime"')
    console.log("setup: pnpm dev -- setup-codex-pi-agent [agentId]")
    return
  }

  const { gateway } = createMinimalPiRuntime(process.cwd())

  const envelope = {
    protocol: "boa.turn.v1" as const,
    chatId: "local-chat",
    sessionId: "local-session",
    agentId: "pi-agent",
    sender: { kind: "human" as const, id: "operator" },
    recipient: { kind: "agent" as const, id: "pi-agent" },
    message,
  }

  for await (const frame of gateway.handleWebSocketMessage(JSON.stringify(envelope))) {
    const event = JSON.parse(frame) as { kind: string; delta?: string; response?: string }
    if (event.kind === "turn.chunk") {
      process.stdout.write(event.delta ?? "")
      continue
    }

    if (event.kind === "turn.final") {
      process.stdout.write("\n")
      process.stdout.write(`checkpoint=${event.response ? "stored" : "none"}\n`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runCli()
}
