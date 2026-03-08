import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type AuthMode = "none" | "codex-env" | "codex-file"

export interface CodexAuth {
  mode: AuthMode
  token: string | null
}

export class CodexAuthProvider {
  constructor(
    private readonly workspaceDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async resolve(): Promise<CodexAuth> {
    if (this.env.CODEX_API_KEY && this.env.CODEX_API_KEY.trim().length > 0) {
      return {
        mode: "codex-env",
        token: this.env.CODEX_API_KEY.trim(),
      }
    }

    const tokenFilePath = join(this.workspaceDir, ".openboa", "auth", "codex.token")
    try {
      const token = (await readFile(tokenFilePath, "utf8")).trim()
      if (token.length > 0) {
        return {
          mode: "codex-file",
          token,
        }
      }
    } catch {
      // No local token file.
    }

    return {
      mode: "none",
      token: null,
    }
  }
}
