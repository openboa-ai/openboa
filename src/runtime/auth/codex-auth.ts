import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type AuthMode = "none" | "codex-env" | "codex-oauth"

export interface CodexAuth {
  mode: AuthMode
  token: string | null
}

interface OauthTokenFile {
  accessToken?: unknown
  expiresAt?: unknown
}

function isExpiredAt(expiresAt: unknown): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt <= nowSeconds
  }

  if (typeof expiresAt === "string") {
    const trimmed = expiresAt.trim()
    if (!trimmed) {
      return false
    }

    const asNumber = Number(trimmed)
    if (Number.isFinite(asNumber) && trimmed === String(asNumber)) {
      return asNumber <= nowSeconds
    }

    const parsedDate = Date.parse(trimmed)
    return Number.isFinite(parsedDate) && parsedDate / 1000 <= nowSeconds
  }

  return false
}

function toValidOauthToken(parsed: OauthTokenFile): string | null {
  const token = typeof parsed.accessToken === "string" ? parsed.accessToken.trim() : ""
  if (!token) {
    return null
  }

  if (isExpiredAt(parsed.expiresAt)) {
    return null
  }

  return token
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

    const oauthPath = join(this.workspaceDir, ".openboa", "auth", "codex.oauth.json")
    try {
      const raw = await readFile(oauthPath, "utf8")
      const parsed = JSON.parse(raw) as OauthTokenFile
      const token = toValidOauthToken(parsed)
      if (token) {
        return {
          mode: "codex-oauth",
          token,
        }
      }
    } catch {
      // No oauth token file.
    }

    return {
      mode: "none",
      token: null,
    }
  }
}
