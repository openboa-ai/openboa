import { readdir } from "node:fs/promises"
import { join } from "node:path"
import {
  type CliOptions,
  type ParsedCommand,
  parseOpenBoaCommand,
  usageLines,
} from "./cli/parser.js"
import { startChatApiServer } from "./runtime/api-server.js"
import { runCodexOauthLoginAndSync } from "./runtime/auth/codex-oauth-login.js"
import { runChatTurn } from "./runtime/chat.js"
import { ensureCodexPiAgentConfig, ensureOpenboaSetup } from "./runtime/setup.js"
import { runTuiChat } from "./runtime/tui.js"

export const OPENBOA_VERSION = "0.1.0"

export { startChatApiServer } from "./runtime/api-server.js"
export { runChatTurn } from "./runtime/chat.js"
export { createMinimalPiRuntime } from "./runtime/factory.js"
export type {
  ParticipantRef,
  TurnChunkEvent,
  TurnEnvelope,
  TurnEvent,
  TurnFinalEvent,
} from "./runtime/protocol.js"
export { ensureCodexPiAgentConfig, ensureOpenboaSetup } from "./runtime/setup.js"
export { runTuiChat } from "./runtime/tui.js"

function usage(): void {
  process.stdout.write(`${usageLines().join("\n")}\n`)
}

async function runSetup(): Promise<void> {
  const result = await ensureOpenboaSetup(process.cwd())

  const message = [
    "openboa setup complete",
    `- workspace: ${result.workspaceDir}`,
    `- bootstrap config: ${result.bootstrapConfigPath}`,
    `- base prompt: ${result.basePromptPath}`,
    result.created
      ? "- created default scaffold files (runtime.json / base.prompt)"
      : "- scaffold already exists (idempotent)",
    "- next: openboa agent spawn --name <agent-id>",
  ].join("\n")

  process.stdout.write(`${message}\n`)
}

async function runAgentSpawn(options: CliOptions): Promise<void> {
  const name = options.name ?? options.n
  if (!name || name.trim().length === 0) {
    throw new Error("agent spawn requires --name <agent-id>")
  }

  const result = await ensureCodexPiAgentConfig(process.cwd(), name)
  process.stdout.write(`${result.created ? "created" : "exists"}: ${result.configPath}\n`)
}

async function runAgentList(): Promise<void> {
  const agentsDir = join(process.cwd(), ".openboa", "agents")
  const entries = await readdir(agentsDir, { withFileTypes: true }).catch(() => [])
  const agentIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  if (agentIds.length === 0) {
    process.stdout.write("agent list: (empty)\n")
    return
  }

  process.stdout.write("agent list:\n")
  for (const agentId of agentIds) {
    process.stdout.write(`- ${agentId}\n`)
  }
}

async function runAgentCommand(command: ParsedCommand): Promise<void> {
  if (!command.agentId && command.kind === "agent-spawn") {
    throw new Error("agent spawn requires --name <agent-id>")
  }

  if (command.kind === "agent-spawn") {
    await runAgentSpawn(command.options ?? {})
    return
  }

  if (command.kind === "agent-list") {
    await runAgentList()
    return
  }

  if (command.kind === "agent-chat") {
    if (!command.agentId) {
      throw new Error("agent chat requires --name <agent-id>")
    }

    await runTuiChat(process.cwd(), command.agentId, {
      chatId: command.options?.["chat-id"],
      sessionId: command.options?.["session-id"],
      senderId: command.options?.["sender-id"],
    })
    return
  }

  throw new Error(`unknown agent command: ${command.kind}`)
}

async function runOneShotChat(args: string[]): Promise<void> {
  const message = args.join(" ").trim()
  if (!message) {
    usage()
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

export async function runCli(args: string[]): Promise<void> {
  const command = parseOpenBoaCommand(args)

  if (command.kind === "help") {
    usage()
    return
  }

  if (command.kind === "setup") {
    await runSetup()
    return
  }

  if (
    command.kind === "agent-spawn" ||
    command.kind === "agent-list" ||
    command.kind === "agent-chat"
  ) {
    await runAgentCommand(command)
    return
  }

  if (command.kind === "unknown") {
    throw new Error(command.error ?? "invalid command")
  }

  if (command.kind === "serve") {
    const host = process.env.OPENBOA_API_HOST ?? "0.0.0.0"
    const port = Number(process.env.OPENBOA_API_PORT ?? "8787")
    const server = await startChatApiServer({
      workspaceDir: process.cwd(),
      host,
      port,
    })
    process.stdout.write(`openboa api listening on http://${server.host}:${server.port}\n`)
    return
  }

  if (command.kind === "codex-login") {
    const result = await runCodexOauthLoginAndSync(process.cwd())
    process.stdout.write(`oauth synced: ${result.oauthPath}\n`)
    return
  }

  if (command.kind === "tui") {
    const agentId = command.agentId ?? "pi-agent"
    await runTuiChat(process.cwd(), agentId)
    return
  }

  if (command.kind === "setup-codex-pi-agent") {
    const agentId = command.agentId ?? "pi-agent"
    const result = await ensureCodexPiAgentConfig(process.cwd(), agentId)
    process.stdout.write(`${result.created ? "created" : "exists"}: ${result.configPath}\n`)
    return
  }

  if (command.kind === "oneshot-chat") {
    if (!command.text) {
      usage()
      return
    }

    await runOneShotChat([command.text])
    return
  }

  throw new Error(`Unhandled command: ${String(command.kind)}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${String((error as Error).message)}\n`)
    process.exitCode = 1
  })
}
