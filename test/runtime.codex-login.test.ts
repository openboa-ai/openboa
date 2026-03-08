import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  resolveCodexCliAuthPath,
  syncCodexOauthFromCodexCli,
} from "../src/runtime/auth/codex-oauth-login.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-login-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("codex oauth login sync", () => {
  it("writes workspace oauth file from codex cli auth.json", async () => {
    const workspaceDir = await createWorkspace()
    const sourceDir = join(workspaceDir, "source")
    await mkdir(sourceDir, { recursive: true })
    const sourceAuthPath = join(sourceDir, "auth.json")

    await writeFile(
      sourceAuthPath,
      JSON.stringify({ tokens: { access_token: "oauth-from-codex-cli" } }),
      "utf8",
    )

    const result = await syncCodexOauthFromCodexCli(workspaceDir, sourceAuthPath)
    const oauthRaw = await readFile(result.oauthPath, "utf8")
    const oauthParsed = JSON.parse(oauthRaw) as { accessToken: string; syncedAt: string }

    expect(oauthParsed.accessToken).toBe("oauth-from-codex-cli")
    expect(typeof oauthParsed.syncedAt).toBe("string")
    expect(oauthParsed.syncedAt.length).toBeGreaterThan(0)
  })

  it("fails when codex cli auth file has no access token", async () => {
    const workspaceDir = await createWorkspace()
    const sourceDir = join(workspaceDir, "source")
    await mkdir(sourceDir, { recursive: true })
    const sourceAuthPath = join(sourceDir, "auth.json")

    await writeFile(sourceAuthPath, JSON.stringify({ tokens: {} }), "utf8")

    await expect(syncCodexOauthFromCodexCli(workspaceDir, sourceAuthPath)).rejects.toThrow(
      "codex oauth token not found in codex cli auth file",
    )
  })

  it("uses OPENBOA_CODEX_AUTH_FILE when provided", () => {
    const resolved = resolveCodexCliAuthPath({
      OPENBOA_CODEX_AUTH_FILE: "/tmp/custom-codex-auth.json",
    })

    expect(resolved).toBe("/tmp/custom-codex-auth.json")
  })
})
