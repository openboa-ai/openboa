export interface CliOptions {
  [key: string]: string
}

export interface ParsedCommand {
  kind:
    | "setup"
    | "agent-spawn"
    | "agent-list"
    | "agent-chat"
    | "serve"
    | "codex-login"
    | "tui"
    | "setup-codex-pi-agent"
    | "oneshot-chat"
    | "help"
    | "unknown"
  agentId?: string
  options?: CliOptions
  text?: string
  error?: string
}

export function usageLines(): string[] {
  return [
    "openboa usage:",
    "  openboa setup",
    "    - bootstrap openboa workspace and default agent config scaffold",
    "  openboa codex-login",
    "    - run Codex browser oauth sync",
    "  openboa agent spawn --name <agent-id>",
    "  openboa agent list",
    "  openboa agent chat --name <agent-id> [--chat-id <id>] [--session-id <id>] [--sender-id <id>]",
    "  openboa serve",
    "  openboa [--help]",
    "  openboa <free text>",
  ]
}

export function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith("--")) {
      continue
    }

    const normalized = arg.slice(2)
    const [rawKey, rawValue] = normalized.split("=", 2)
    if (rawValue !== undefined) {
      options[rawKey] = rawValue
      continue
    }

    const next = args[i + 1]
    if (next && !next.startsWith("-")) {
      options[rawKey] = next
      i += 1
    } else {
      options[rawKey] = "true"
    }
  }

  return options
}

export function getValueOption(args: string[], ...keys: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (!keys.includes(args[i])) {
      continue
    }

    const value = args[i + 1]
    if (!value || value.startsWith("-")) {
      return undefined
    }

    return value
  }

  return undefined
}

export function parseOpenBoaCommand(rawArgs: string[]): ParsedCommand {
  const command = rawArgs[0]

  if (!command || command === "--help" || command === "-h") {
    return { kind: "help" }
  }

  if (command === "setup") {
    return { kind: "setup" }
  }

  if (command === "agent") {
    const sub = rawArgs[1]
    const subArgs = rawArgs.slice(2)

    if (!sub) {
      return { kind: "unknown", error: "agent command requires one of: spawn | list | chat" }
    }

    if (sub === "spawn") {
      const name = getValueOption(rawArgs.slice(1), "--name", "-n")
      if (!name) {
        return { kind: "unknown", error: "agent spawn requires --name <agent-id>" }
      }

      return { kind: "agent-spawn", agentId: name, options: parseCliOptions(subArgs) }
    }

    if (sub === "list") {
      return { kind: "agent-list", options: parseCliOptions(subArgs) }
    }

    if (sub === "chat") {
      const name = getValueOption(rawArgs.slice(1), "--name", "-n")
      if (!name) {
        return { kind: "unknown", error: "agent chat requires --name <agent-id>" }
      }

      return { kind: "agent-chat", agentId: name, options: parseCliOptions(subArgs) }
    }

    return { kind: "unknown", error: `unknown agent command: ${sub}` }
  }

  if (command === "serve") {
    return { kind: "serve", options: parseCliOptions(rawArgs.slice(1)) }
  }

  if (command === "codex-login") {
    return { kind: "codex-login", options: parseCliOptions(rawArgs.slice(1)) }
  }

  if (command === "tui") {
    const agentId = rawArgs[1] ?? "pi-agent"
    return { kind: "tui", agentId }
  }

  if (command === "setup-codex-pi-agent") {
    const agentId = rawArgs[1] ?? "pi-agent"
    return { kind: "setup-codex-pi-agent", agentId }
  }

  return {
    kind: "oneshot-chat",
    text: rawArgs.join(" ").trim(),
  }
}
