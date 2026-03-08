import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

interface CodexCliAuthShape {
  tokens?: {
    access_token?: unknown
  }
}

export interface CodexOauthSyncResult {
  oauthPath: string
}

export function resolveCodexCliAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.OPENBOA_CODEX_AUTH_FILE?.trim()
  if (fromEnv) {
    return fromEnv
  }

  return join(homedir(), ".codex", "auth.json")
}

export async function runCodexLoginCommand(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("codex", ["login"], { stdio: "inherit" })

    child.on("error", (error) => reject(error))
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`codex login failed with exit code ${String(code)}`))
    })
  })
}

export async function syncCodexOauthFromCodexCli(
  workspaceDir: string,
  sourceAuthPath = resolveCodexCliAuthPath(),
): Promise<CodexOauthSyncResult> {
  const raw = await readFile(sourceAuthPath, "utf8")
  const parsed = JSON.parse(raw) as CodexCliAuthShape
  const accessToken =
    typeof parsed.tokens?.access_token === "string" ? parsed.tokens.access_token.trim() : ""

  if (!accessToken) {
    throw new Error("codex oauth token not found in codex cli auth file")
  }

  const authDir = join(workspaceDir, ".openboa", "auth")
  await mkdir(authDir, { recursive: true })

  const oauthPath = join(authDir, "codex.oauth.json")
  await writeFile(
    oauthPath,
    `${JSON.stringify({ accessToken, syncedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  )

  return { oauthPath }
}

export async function runCodexOauthLoginAndSync(
  workspaceDir: string,
): Promise<CodexOauthSyncResult> {
  await runCodexLoginCommand()
  return syncCodexOauthFromCodexCli(workspaceDir, resolveCodexCliAuthPath())
}
