import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { CodexAuthProvider } from "../src/runtime/auth/codex-auth.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-auth-"))
  temporaryRoots.push(root)
  await mkdir(join(root, ".openboa", "auth"), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("codex auth provider", () => {
  it("accepts ISO8601 oauth expiry in future", async () => {
    const workspaceDir = await createWorkspace()
    const oauthPath = join(workspaceDir, ".openboa", "auth", "codex.oauth.json")

    const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await writeFile(
      oauthPath,
      JSON.stringify({ accessToken: "oauth-token", expiresAt: futureIso }),
      "utf8",
    )

    const auth = await new CodexAuthProvider(workspaceDir).resolve()
    expect(auth).toEqual({ mode: "codex-oauth", token: "oauth-token" })
  })

  it("rejects oauth tokens with expired ISO8601 expiry", async () => {
    const workspaceDir = await createWorkspace()
    const oauthPath = join(workspaceDir, ".openboa", "auth", "codex.oauth.json")

    const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await writeFile(
      oauthPath,
      JSON.stringify({ accessToken: "oauth-token", expiresAt: pastIso }),
      "utf8",
    )

    const auth = await new CodexAuthProvider(workspaceDir).resolve()
    expect(auth).toEqual({ mode: "none", token: null })
  })

  it("treats numeric oauth expiry seconds and env key as override order", async () => {
    const workspaceDir = await createWorkspace()
    const oauthPath = join(workspaceDir, ".openboa", "auth", "codex.oauth.json")
    const future = Math.floor(Date.now() / 1000) + 60

    await writeFile(
      oauthPath,
      JSON.stringify({ accessToken: "oauth-token", expiresAt: future }),
      "utf8",
    )

    const auth = await new CodexAuthProvider(workspaceDir, {
      CODEX_API_KEY: "  env-key  ",
    }).resolve()
    expect(auth).toEqual({ mode: "codex-env", token: "env-key" })
  })

  it("ignores invalid expiry formats and still returns token", async () => {
    const workspaceDir = await createWorkspace()
    const oauthPath = join(workspaceDir, ".openboa", "auth", "codex.oauth.json")

    await writeFile(
      oauthPath,
      JSON.stringify({ accessToken: "oauth-token", expiresAt: "not-a-date" }),
      "utf8",
    )

    const auth = await new CodexAuthProvider(workspaceDir).resolve()
    expect(auth).toEqual({ mode: "codex-oauth", token: "oauth-token" })
  })
})
