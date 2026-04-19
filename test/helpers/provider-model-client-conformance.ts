import { describe, expect, it, vi } from "vitest"
import type {
  ProviderModelCallInput,
  ProviderModelClient,
} from "../../src/agents/providers/model-client.js"
import type { AgentRuntimeToolDefinition } from "../../src/agents/tools/runtime-tool.js"
import { ToolConfirmationRequiredError } from "../../src/agents/tools/runtime-tool.js"

interface ProviderModelClientConformanceConfig {
  suiteName: string
  createClient(fetchImpl: typeof fetch): ProviderModelClient
  buildInput(input: {
    message: string
    tools?: AgentRuntimeToolDefinition[]
  }): ProviderModelCallInput
  buildCanonicalNameResponses(toolName: string): Response[]
  buildToolLoopResponses(input: {
    toolName: string
    toolArgs: Record<string, unknown>
    finalText: string
  }): Response[]
  buildInterruptResponses(input: {
    toolName: string
    toolArgs: Record<string, unknown>
  }): Response[]
  parseRequestBody(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, callIndex: number): unknown
  assertContinuationRequest(body: unknown): void
}

export function describeProviderModelClientConformanceSuite(
  config: ProviderModelClientConformanceConfig,
): void {
  describe(config.suiteName, () => {
    it("uses canonical provider-safe tool names directly on the wire", async () => {
      const execute = vi.fn(async () => JSON.stringify({ ok: true, sessionId: "sess_123" }))
      const canonicalResponses = config.buildCanonicalNameResponses("session_get_snapshot")
      const [canonicalFirst, canonicalSecond] = canonicalResponses
      if (!canonicalFirst || !canonicalSecond) {
        throw new Error("Expected two canonical name responses")
      }
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(canonicalFirst)
        .mockResolvedValueOnce(canonicalSecond)

      const client = config.createClient(fetchImpl)
      const response = await client.complete(
        config.buildInput({
          message: "Load the latest session snapshot.",
          tools: [
            {
              name: "session_get_snapshot",
              description: "Get a session snapshot",
              parameters: {
                type: "object",
                properties: {
                  sessionId: { type: "string" },
                },
                required: ["sessionId"],
                additionalProperties: false,
              },
              execute,
            },
          ],
        }),
      )

      expect(response).toBe("Snapshot loaded.")
      const requestBody = config.parseRequestBody(fetchImpl, 0) as {
        tools?: Array<{ name?: unknown }>
      }
      const requestToolName =
        typeof requestBody.tools?.[0]?.name === "string" ? requestBody.tools[0].name : null
      expect(requestToolName).toMatch(/^[a-zA-Z0-9_-]+$/)
      expect(requestToolName).toBe("session_get_snapshot")
      expect(execute).toHaveBeenCalledWith({ sessionId: "sess_123" })
    })

    it("executes function tools, continues the tool loop, and preserves runtime interrupts", async () => {
      const toolArgs = { query: "launch owner" }
      const execute = vi.fn(async () =>
        JSON.stringify([
          {
            messageId: "msg_launch",
            authorId: "founder",
            body: "We should decide the launch owner today.",
          },
        ]),
      )
      const toolLoopResponses = config.buildToolLoopResponses({
        toolName: "conversation_search_messages",
        toolArgs,
        finalText: "The launch owner discussion is in the recent transcript.",
      })
      const [toolLoopFirst, toolLoopSecond] = toolLoopResponses
      if (!toolLoopFirst || !toolLoopSecond) {
        throw new Error("Expected two tool loop responses")
      }
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(toolLoopFirst)
        .mockResolvedValueOnce(toolLoopSecond)

      const client = config.createClient(fetchImpl)
      const response = await client.complete(
        config.buildInput({
          message: "Who owns launch readiness?",
          tools: [
            {
              name: "conversation_search_messages",
              description: "Search room messages",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
                required: ["query"],
                additionalProperties: false,
              },
              execute,
            },
          ],
        }),
      )

      expect(response).toContain("launch owner discussion")
      expect(execute).toHaveBeenCalledWith(toolArgs)
      const secondBody = config.parseRequestBody(fetchImpl, 1)
      config.assertContinuationRequest(secondBody)
    })

    it("rethrows confirmation-required runtime interrupts instead of converting them into provider errors", async () => {
      const interruptResponses = config.buildInterruptResponses({
        toolName: "resources_promote_to_substrate",
        toolArgs: { sourcePath: "drafts/plan.md" },
      })
      const [interruptFirst] = interruptResponses
      if (!interruptFirst) {
        throw new Error("Expected one interrupt response")
      }
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(interruptFirst)

      const client = config.createClient(fetchImpl)

      await expect(
        client.complete(
          config.buildInput({
            message: "Promote the draft into shared substrate.",
            tools: [
              {
                name: "resources_promote_to_substrate",
                description: "Promote a file",
                parameters: {
                  type: "object",
                  properties: {
                    sourcePath: { type: "string" },
                  },
                  required: ["sourcePath"],
                  additionalProperties: false,
                },
                execute: async () => {
                  throw new ToolConfirmationRequiredError({
                    id: "confirm_1",
                    toolName: "resources_promote_to_substrate",
                    ownership: "managed",
                    permissionPolicy: "always_ask",
                    input: { sourcePath: "drafts/plan.md" },
                    requestedAt: "2026-04-10T00:00:00.000Z",
                  })
                },
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(ToolConfirmationRequiredError)
    })
  })
}
