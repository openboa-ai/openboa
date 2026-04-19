import { describe, expect, it, vi } from "vitest"
import { CodexModelClient } from "../src/agents/providers/codex-model-client.js"
import { ToolConfirmationRequiredError } from "../src/agents/tools/runtime-tool.js"
import { describeProviderModelClientConformanceSuite } from "./helpers/provider-model-client-conformance.js"

describeProviderModelClientConformanceSuite({
  suiteName: "CodexModelClient responses api conformance",
  createClient(fetchImpl) {
    return new CodexModelClient({ fetchImpl })
  },
  buildInput({ message, tools }) {
    return {
      apiKey: "test-api-key",
      authMode: "api-key",
      systemPrompt: "You are a helpful agent.",
      context: {
        tokenBudget: 2048,
        estimatedTokens: 0,
        selectedHistory: [],
        conversationHistory: [],
        runtimeNotes: [],
        transcript: "",
      },
      message,
      tools,
    }
  },
  buildCanonicalNameResponses(toolName) {
    return [
      new Response(
        JSON.stringify({
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: toolName,
              call_id: "call_1",
              arguments: JSON.stringify({ sessionId: "sess_123" }),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(
        JSON.stringify({
          id: "resp_2",
          output_text: "Snapshot loaded.",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]
  },
  buildToolLoopResponses({ toolName, toolArgs, finalText }) {
    return [
      new Response(
        JSON.stringify({
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: toolName,
              call_id: "call_1",
              arguments: JSON.stringify(toolArgs),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(
        JSON.stringify({
          id: "resp_2",
          output_text: finalText,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]
  },
  buildInterruptResponses({ toolName, toolArgs }) {
    return [
      new Response(
        JSON.stringify({
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: toolName,
              call_id: "call_1",
              arguments: JSON.stringify(toolArgs),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]
  },
  parseRequestBody(fetchImpl, callIndex) {
    return JSON.parse(String(fetchImpl.mock.calls[callIndex]?.[1]?.body))
  },
  assertContinuationRequest(body) {
    const parsed = body as {
      previous_response_id?: string
      input?: Array<Record<string, unknown>>
    }
    expect(parsed.previous_response_id).toBe("resp_1")
    expect(parsed.input?.[0]).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
    })
  },
})

describe("CodexModelClient oauth streaming", () => {
  it("uses streamed output_text deltas when the completed payload omits output items", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","output":[]}}\n\n',
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
          'data: {"type":"response.output_text.delta","delta":" there."}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
    )

    const client = new CodexModelClient({
      fetchImpl,
    })

    const response = await client.complete({
      apiKey: createOauthTokenWithAccountId("acct_test"),
      authMode: "codex-oauth",
      systemPrompt: "You are a helpful agent.",
      context: {
        tokenBudget: 2048,
        estimatedTokens: 0,
        selectedHistory: [],
        conversationHistory: [],
        runtimeNotes: [],
        transcript: "",
      },
      message: "Say hello.",
    })

    expect(response).toBe("Hello there.")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("reconstructs streamed function calls when the completed payload omits output items", async () => {
    const execute = vi.fn(async () => JSON.stringify({ ok: true, sessionId: "sess_123" }))
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"type":"response.created","response":{"id":"resp_1","output":[]}}\n\n',
            'data: {"type":"response.output_item.added","item_id":"fc_001","output_index":0,"item":{"type":"function_call","name":"session_get_snapshot","call_id":"call_1","arguments":""}}\n\n',
            'data: {"type":"response.function_call_arguments.delta","item_id":"fc_001","output_index":0,"call_id":"call_1","delta":"{\\"sessionId\\":\\"sess_123\\""}\n\n',
            'data: {"type":"response.function_call_arguments.done","item_id":"fc_001","output_index":0,"call_id":"call_1","name":"session_get_snapshot","arguments":"{\\"sessionId\\":\\"sess_123\\"}"}\n\n',
            'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
            "data: [DONE]\n\n",
          ].join(""),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"type":"response.created","response":{"id":"resp_2","output":[]}}\n\n',
            'data: {"type":"response.output_text.delta","delta":"Snapshot loaded."}\n\n',
            'data: {"type":"response.completed","response":{"id":"resp_2","output":[]}}\n\n',
            "data: [DONE]\n\n",
          ].join(""),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      )

    const client = new CodexModelClient({
      fetchImpl,
    })

    const response = await client.complete({
      apiKey: createOauthTokenWithAccountId("acct_test"),
      authMode: "codex-oauth",
      systemPrompt: "You are a helpful agent.",
      context: {
        tokenBudget: 2048,
        estimatedTokens: 0,
        selectedHistory: [],
        conversationHistory: [],
        runtimeNotes: [],
        transcript: "",
      },
      message: "Load the latest snapshot.",
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
    })

    expect(response).toBe("Snapshot loaded.")
    expect(execute).toHaveBeenCalledWith({ sessionId: "sess_123" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      previous_response_id?: string
      input?: Array<Record<string, unknown>>
    }
    expect(secondBody.previous_response_id).toBeUndefined()
    expect(secondBody.input?.some((item) => item.type === "function_call")).toBe(true)
    expect(secondBody.input?.some((item) => item.type === "function_call_output")).toBe(true)
  })

  it("rethrows tool confirmation interrupts in the codex oauth tool loop", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","output":[]}}\n\n',
          'data: {"type":"response.output_item.added","item_id":"fc_001","output_index":0,"item":{"type":"function_call","name":"shell_run","call_id":"call_1","arguments":""}}\n\n',
          'data: {"type":"response.function_call_arguments.done","item_id":"fc_001","output_index":0,"call_id":"call_1","name":"shell_run","arguments":"{\\"command\\":\\"printf hi >> /workspace/out.txt\\"}"}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
    )

    const client = new CodexModelClient({
      fetchImpl,
    })

    await expect(
      client.complete({
        apiKey: createOauthTokenWithAccountId("acct_test"),
        authMode: "codex-oauth",
        systemPrompt: "You are a careful agent.",
        context: {
          tokenBudget: 2048,
          estimatedTokens: 0,
          selectedHistory: [],
          conversationHistory: [],
          runtimeNotes: [],
          transcript: "",
        },
        message: "Append text to the file.",
        tools: [
          {
            name: "shell_run",
            description: "Run a writable shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
              additionalProperties: false,
            },
            execute: async () => {
              throw new ToolConfirmationRequiredError({
                id: "confirm_shell_1",
                toolName: "shell_run",
                ownership: "managed",
                permissionPolicy: "always_ask",
                input: { command: "printf hi >> /workspace/out.txt" },
                requestedAt: "2026-04-12T00:00:00.000Z",
              })
            },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ToolConfirmationRequiredError)
  })
})

describeProviderModelClientConformanceSuite({
  suiteName: "CodexModelClient oauth streaming conformance",
  createClient(fetchImpl) {
    return new CodexModelClient({ fetchImpl })
  },
  buildInput({ message, tools }) {
    return {
      apiKey: createOauthTokenWithAccountId("acct_test"),
      authMode: "codex-oauth",
      systemPrompt: "You are a helpful agent.",
      context: {
        tokenBudget: 2048,
        estimatedTokens: 0,
        selectedHistory: [],
        conversationHistory: [],
        runtimeNotes: [],
        transcript: "",
      },
      message,
      tools,
    }
  },
  buildCanonicalNameResponses(toolName) {
    return [
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","output":[]}}\n\n',
          `data: {"type":"response.output_item.added","item_id":"fc_001","output_index":0,"item":{"type":"function_call","name":"${toolName}","call_id":"call_1","arguments":""}}\n\n`,
          'data: {"type":"response.function_call_arguments.done","item_id":"fc_001","output_index":0,"call_id":"call_1","name":"session_get_snapshot","arguments":"{\\"sessionId\\":\\"sess_123\\"}"}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_2","output":[]}}\n\n',
          'data: {"type":"response.output_text.delta","delta":"Snapshot loaded."}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_2","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ]
  },
  buildToolLoopResponses({ toolName, toolArgs, finalText }) {
    return [
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","output":[]}}\n\n',
          `data: {"type":"response.output_item.added","item_id":"fc_001","output_index":0,"item":{"type":"function_call","name":"${toolName}","call_id":"call_1","arguments":""}}\n\n`,
          `data: {"type":"response.function_call_arguments.done","item_id":"fc_001","output_index":0,"call_id":"call_1","name":"${toolName}","arguments":"${escapeJsonForSse(JSON.stringify(toolArgs))}"}\n\n`,
          'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_2","output":[]}}\n\n',
          `data: {"type":"response.output_text.delta","delta":"${escapeJsonForSse(finalText)}"}\n\n`,
          'data: {"type":"response.completed","response":{"id":"resp_2","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ]
  },
  buildInterruptResponses({ toolName, toolArgs }) {
    return [
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","output":[]}}\n\n',
          `data: {"type":"response.output_item.added","item_id":"fc_001","output_index":0,"item":{"type":"function_call","name":"${toolName}","call_id":"call_1","arguments":""}}\n\n`,
          `data: {"type":"response.function_call_arguments.done","item_id":"fc_001","output_index":0,"call_id":"call_1","name":"${toolName}","arguments":"${escapeJsonForSse(JSON.stringify(toolArgs))}"}\n\n`,
          'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ]
  },
  parseRequestBody(fetchImpl, callIndex) {
    return JSON.parse(
      String(
        fetchImpl.mock.calls[callIndex]?.[0] ? fetchImpl.mock.calls[callIndex]?.[1]?.body : "{}",
      ),
    )
  },
  assertContinuationRequest(body) {
    const parsed = body as {
      previous_response_id?: string
      input?: Array<Record<string, unknown>>
    }
    expect(parsed.previous_response_id).toBeUndefined()
    expect(parsed.input?.some((item) => item.type === "function_call")).toBe(true)
    expect(parsed.input?.some((item) => item.type === "function_call_output")).toBe(true)
  },
})

function createOauthTokenWithAccountId(accountId: string): string {
  const header = encodeJwtPart({ alg: "none", typ: "JWT" })
  const payload = encodeJwtPart({
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
    },
  })
  return `${header}.${payload}.signature`
}

function escapeJsonForSse(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function encodeJwtPart(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}
