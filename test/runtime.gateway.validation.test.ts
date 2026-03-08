import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createMinimalPiRuntime } from "../src/runtime/factory.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("gateway turn envelope validation", () => {
  it("returns deterministic invalid envelope error for malformed JSON", async () => {
    const workspaceDir = await createWorkspace()
    const { gateway } = createMinimalPiRuntime(workspaceDir)

    await expect(
      (async () => {
        for await (const _ of gateway.handleWebSocketMessage("{invalid json")) {
          // no-op
        }
      })(),
    ).rejects.toThrow("invalid turn envelope")
  })

  it("returns invalid turn envelope when required sender/recipient fields are missing", async () => {
    const workspaceDir = await createWorkspace()
    const { gateway } = createMinimalPiRuntime(workspaceDir)

    const invalidEnvelope = {
      protocol: "boa.turn.v1",
      chatId: "chat-1",
      sessionId: "session-1",
      agentId: "pi-agent",
      sender: { kind: "human", id: "" },
      recipient: { kind: "agent", id: "pi-agent" },
      message: "hello",
    }

    await expect(
      (async () => {
        for await (const _ of gateway.handleWebSocketMessage(JSON.stringify(invalidEnvelope))) {
          // no-op
        }
      })(),
    ).rejects.toThrow("invalid turn envelope")
  })
})
