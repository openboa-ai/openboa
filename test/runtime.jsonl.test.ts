import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { readJsonl } from "../src/runtime/storage/jsonl.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-jsonl-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("readJsonl", () => {
  it("returns empty array when file does not exist", async () => {
    const workspaceDir = await createWorkspace()
    const filePath = join(workspaceDir, "missing.jsonl")

    await expect(readJsonl(filePath)).resolves.toEqual([])
  })

  it("returns empty array for empty files", async () => {
    const workspaceDir = await createWorkspace()
    const filePath = join(workspaceDir, "empty.jsonl")
    await writeFile(filePath, "\n", "utf8")

    await expect(readJsonl(filePath)).resolves.toEqual([])
  })

  it("parses valid jsonl records", async () => {
    const workspaceDir = await createWorkspace()
    const filePath = join(workspaceDir, "valid.jsonl")
    await writeFile(filePath, '{"id":1}\n{"id":2}\n', "utf8")

    await expect(readJsonl<{ id: number }>(filePath)).resolves.toEqual([{ id: 1 }, { id: 2 }])
  })

  it("tolerates malformed trailing line and keeps previous valid rows", async () => {
    const workspaceDir = await createWorkspace()
    const filePath = join(workspaceDir, "trailing-corrupt.jsonl")
    await writeFile(filePath, '{"id":1}\n{"id":2}\n{"id":', "utf8")

    await expect(readJsonl<{ id: number }>(filePath)).resolves.toEqual([{ id: 1 }, { id: 2 }])
  })

  it("throws when malformed line is not trailing", async () => {
    const workspaceDir = await createWorkspace()
    const filePath = join(workspaceDir, "mid-corrupt.jsonl")
    await writeFile(filePath, '{"id":1}\n{"id":\n{"id":3}\n', "utf8")

    await expect(readJsonl(filePath)).rejects.toThrow()
  })
})
