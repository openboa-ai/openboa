import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ensureCodexPiAgentConfig } from "../src/runtime/setup.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-setup-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("runtime setup", () => {
  it("creates default codex+pi agent config when missing", async () => {
    const workspaceDir = await createWorkspace()

    const result = await ensureCodexPiAgentConfig(workspaceDir, "pi-agent")
    expect(result.created).toBe(true)

    const raw = await readFile(result.configPath, "utf8")
    const parsed = JSON.parse(raw) as {
      runtime: string
      auth: { provider: string; required: boolean }
    }

    expect(parsed.runtime).toBe("pi")
    expect(parsed.auth.provider).toBe("codex")
    expect(parsed.auth.required).toBe(true)
  })

  it("does not overwrite existing agent config", async () => {
    const workspaceDir = await createWorkspace()
    const first = await ensureCodexPiAgentConfig(workspaceDir, "pi-agent")
    await writeFile(
      first.configPath,
      '{"runtime":"pi","auth":{"provider":"codex","required":false}}\n',
      "utf8",
    )

    const second = await ensureCodexPiAgentConfig(workspaceDir, "pi-agent")
    expect(second.created).toBe(false)

    const raw = await readFile(first.configPath, "utf8")
    expect(raw).toContain('"required":false')
  })
})
