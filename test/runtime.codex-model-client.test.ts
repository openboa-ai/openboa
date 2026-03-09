import { describe, expect, it, vi } from "vitest"

import {
  type CodexModelCallError,
  CodexModelClient,
} from "../src/runtime/adapter/codex-model-client.js"

describe("codex model client", () => {
  it("calls responses api and returns output_text", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "model reply" }),
    }))

    const client = new CodexModelClient({
      apiBaseUrl: "https://example.com/v1",
      model: "codex-mini-latest",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5000,
    })

    const text = await client.complete({
      apiKey: "key",
      systemPrompt: "sys",
      context: {
        tokenBudget: 1000,
        estimatedTokens: 0,
        selectedHistory: [],
        transcript: "",
      },
      message: "hello",
    })

    expect(text).toBe("model reply")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("throws normalized errors for non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: { message: "invalid key" },
      }),
    }))

    const client = new CodexModelClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(
      client.complete({
        apiKey: "bad",
        systemPrompt: "sys",
        context: {
          tokenBudget: 1000,
          estimatedTokens: 0,
          selectedHistory: [],
          transcript: "",
        },
        message: "hello",
      }),
    ).rejects.toMatchObject<CodexModelCallError>({
      code: "model_http_error",
      statusCode: 401,
    })
  })
})
