import { spawn } from "node:child_process"

export interface ClaudeCliAuthResult {
  command: string
}

export function resolveClaudeCliCommand(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.OPENBOA_CLAUDE_COMMAND?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : "claude"
}

function runCommand(command: string, args: string[], stdio: "inherit" | "pipe"): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio })
    child.on("error", (error) => reject(error))
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${String(code)}`))
    })
  })
}

export async function ensureClaudeCliAvailable(command = resolveClaudeCliCommand()): Promise<void> {
  await runCommand(command, ["--version"], "pipe")
}

export async function runClaudeCliLoginCommand(
  command = resolveClaudeCliCommand(),
): Promise<ClaudeCliAuthResult> {
  await ensureClaudeCliAvailable(command)
  await runCommand(command, [], "inherit")
  return { command }
}
