import { runChatTurn } from "./runtime/chat.js"
import { ensureCodexPiAgentConfig } from "./runtime/setup.js"
import { runTuiChat } from "./runtime/tui.js"

export const OPENBOA_VERSION = "0.1.0"

export { runChatTurn } from "./runtime/chat.js"
export { createMinimalPiRuntime } from "./runtime/factory.js"
export type {
  ParticipantRef,
  TurnChunkEvent,
  TurnEnvelope,
  TurnEvent,
  TurnFinalEvent,
} from "./runtime/protocol.js"
export { ensureCodexPiAgentConfig } from "./runtime/setup.js"
export { runTuiChat } from "./runtime/tui.js"

async function runCli(): Promise<void> {
  const args = process.argv.slice(2)
  if (args[0] === "setup-codex-pi-agent") {
    const agentId = args[1] ?? "pi-agent"
    const result = await ensureCodexPiAgentConfig(process.cwd(), agentId)
    process.stdout.write(`${result.created ? "created" : "exists"}: ${result.configPath}\n`)
    return
  }

  if (args[0] === "tui") {
    const agentId = args[1] ?? "pi-agent"
    await runTuiChat(process.cwd(), agentId)
    return
  }

  const message = args.join(" ").trim()
  if (!message) {
    console.log('usage: pnpm dev -- "hello pi runtime"')
    console.log("setup: pnpm dev -- setup-codex-pi-agent [agentId]")
    console.log("tui: pnpm dev -- tui [agentId]")
    return
  }

  const result = await runChatTurn({
    workspaceDir: process.cwd(),
    agentId: "pi-agent",
    chatId: "local-chat",
    sessionId: "local-session",
    senderId: "operator",
    message,
  })

  process.stdout.write(`${result.chunks.join("")}\n`)
  process.stdout.write(`checkpoint=${result.final.response ? "stored" : "none"}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runCli()
}
