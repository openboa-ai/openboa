import { spawn } from "node:child_process"

import type { CliBackendConfig } from "./cli-backend.js"
import { normalizeCliBackendModel, resolveCliBackendConfig } from "./cli-backend.js"
import { type CliOutput, parseCliOutput } from "./cli-output.js"
import type { CliSessionBinding } from "./cli-session.js"

export interface ClaudeCliRunInput {
  companyDir: string
  prompt: string
  systemPrompt: string
  model?: string
  timeoutMs?: number
  cliSessionBinding?: CliSessionBinding
  backend?: CliBackendConfig
}

export interface ClaudeCliRunResult extends CliOutput {
  systemPromptHash?: string
}

const cliRunQueues = new Map<string, Promise<void>>()

async function enqueueCliRun<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = cliRunQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  cliRunQueues.set(
    key,
    previous.finally(() => next),
  )
  await previous
  try {
    return await task()
  } finally {
    release()
    if (cliRunQueues.get(key) === next) {
      cliRunQueues.delete(key)
    }
  }
}

function buildCliArgs(params: {
  backend: CliBackendConfig
  model: string
  systemPrompt: string
  prompt: string
  cliSessionId?: string
}): string[] {
  const { backend } = params
  const useResume = Boolean(
    params.cliSessionId && backend.resumeArgs && backend.resumeArgs.length > 0,
  )
  const baseArgs = useResume
    ? (backend.resumeArgs ?? []).map((entry) =>
        entry.replaceAll("{sessionId}", params.cliSessionId ?? ""),
      )
    : [...(backend.args ?? [])]

  if (backend.modelArg && params.model.trim()) {
    baseArgs.push(backend.modelArg, params.model.trim())
  }

  if (!useResume && backend.sessionArg && backend.sessionMode === "always" && params.cliSessionId) {
    baseArgs.push(backend.sessionArg, params.cliSessionId)
  }

  const shouldAttachSystemPrompt =
    Boolean(backend.systemPromptArg) &&
    params.systemPrompt.trim().length > 0 &&
    (backend.systemPromptWhen !== "first" || !params.cliSessionId)

  if (shouldAttachSystemPrompt && backend.systemPromptArg) {
    baseArgs.push(backend.systemPromptArg, params.systemPrompt.trim())
  }

  baseArgs.push(params.prompt)
  return baseArgs
}

function waitForChild(params: {
  command: string
  argv: string[]
  cwd: string
  timeoutMs: number
  clearEnv: string[]
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    for (const key of params.clearEnv) {
      delete env[key]
    }

    const child = spawn(params.command, params.argv, {
      cwd: params.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`claude cli timed out after ${Math.round(params.timeoutMs / 1000)}s`))
    }, params.timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("exit", (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode })
    })
  })
}

export async function runClaudeCliAgent(input: ClaudeCliRunInput): Promise<ClaudeCliRunResult> {
  const backend = input.backend ?? resolveCliBackendConfig("claude-cli")
  if (!backend) {
    throw new Error("claude-cli backend is not configured")
  }

  const normalizedModel = normalizeCliBackendModel(input.model?.trim() || "opus", backend)
  const cliSessionId = input.cliSessionBinding?.sessionId?.trim() || undefined
  const args = buildCliArgs({
    backend,
    model: normalizedModel,
    systemPrompt: input.systemPrompt,
    prompt: input.prompt,
    cliSessionId,
  })

  const output = await enqueueCliRun("claude-cli", async () => {
    const result = await waitForChild({
      command: backend.command,
      argv: args,
      cwd: input.companyDir,
      timeoutMs: input.timeoutMs ?? 120_000,
      clearEnv: backend.clearEnv ?? [],
    })
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || "Claude CLI failed."
      throw new Error(detail)
    }

    return parseCliOutput({
      raw: result.stdout,
      backend,
      providerId: "claude-cli",
      outputMode: backend.output,
      fallbackSessionId: cliSessionId,
    })
  })

  return {
    ...output,
  }
}
