import type { BuiltContext } from "../context/model.js"
import type { AgentRuntimeToolDefinition } from "../tools/runtime-tool.js"
import type { ProviderModelCallInput, ProviderModelClient } from "./model-client.js"
import type { ProviderErrorFactory } from "./provider-runtime-contract.js"
import {
  executeProviderToolCall,
  throwNormalizedProviderError,
} from "./provider-runtime-contract.js"

interface ResponseContentPart {
  type?: unknown
  text?: unknown
}

interface ResponseOutputItem {
  type?: unknown
  content?: unknown
  name?: unknown
  call_id?: unknown
  arguments?: unknown
}

interface OpenAIResponsesApiResponse {
  id?: unknown
  output_text?: unknown
  output?: unknown
  error?: {
    message?: unknown
  }
}

interface ToolCallItem {
  name: string
  callId: string
  arguments: string
}

export interface CodexModelClientOptions {
  apiBaseUrl?: string
  oauthApiBaseUrl?: string
  model?: string
  oauthModel?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface CodexModelCallInput extends ProviderModelCallInput {}

export class CodexModelCallError extends Error {
  constructor(
    readonly code: "model_http_error" | "model_timeout" | "model_invalid_response",
    message: string,
    readonly statusCode?: number,
  ) {
    super(message)
    this.name = "CodexModelCallError"
  }
}

const codexProviderErrorFactory: ProviderErrorFactory<CodexModelCallError> = {
  isProviderError(error): error is CodexModelCallError {
    return error instanceof CodexModelCallError
  },
  timeoutError() {
    return new CodexModelCallError("model_timeout", "model call timed out")
  },
  invalidResponseError(message: string) {
    return new CodexModelCallError("model_invalid_response", message)
  },
}

export class CodexModelClient implements ProviderModelClient {
  private readonly apiBaseUrl: string
  private readonly oauthApiBaseUrl: string
  private readonly model: string
  private readonly oauthModel: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly maxToolRounds = 8

  constructor(options: CodexModelClientOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.openai.com/v1"
    this.oauthApiBaseUrl = options.oauthApiBaseUrl ?? "https://chatgpt.com/backend-api"
    this.model = options.model ?? process.env.OPENBOA_CODEX_MODEL ?? "codex-mini-latest"
    this.oauthModel =
      options.oauthModel ??
      options.model ??
      process.env.OPENBOA_CODEX_OAUTH_MODEL ??
      process.env.OPENBOA_CODEX_MODEL ??
      "gpt-5.4"
    this.timeoutMs = options.timeoutMs ?? Number(process.env.OPENBOA_MODEL_TIMEOUT_MS ?? "20000")
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async complete(input: CodexModelCallInput): Promise<string> {
    if (input.authMode === "codex-oauth") {
      return await this.completeWithCodexOauth(input)
    }

    return await this.completeWithOpenAiResponses(input)
  }

  private async sendOpenAiResponsesRequest(input: {
    apiKey: string
    instructions: string
    input: Array<Record<string, unknown>>
    previousResponseId: string | null
    tools: AgentRuntimeToolDefinition[]
    signal: AbortSignal
  }): Promise<OpenAIResponsesApiResponse> {
    return await sendResponseRequest({
      fetchImpl: this.fetchImpl,
      url: `${this.apiBaseUrl}/responses`,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: {
        model: this.model,
        instructions: input.instructions,
        input: input.input,
        ...(input.previousResponseId ? { previous_response_id: input.previousResponseId } : {}),
        ...(input.tools.length > 0
          ? {
              tools: toResponseTools(input.tools),
              tool_choice: "auto",
              parallel_tool_calls: true,
            }
          : {}),
      },
      signal: input.signal,
    })
  }

  private async sendCodexOauthRequest(input: {
    token: string
    instructions: string
    input: Array<Record<string, unknown>>
    tools: AgentRuntimeToolDefinition[]
    signal: AbortSignal
  }): Promise<OpenAIResponsesApiResponse> {
    const accountId = extractCodexAccountId(input.token)
    const response = await this.fetchImpl(resolveCodexOauthUrl(this.oauthApiBaseUrl), {
      method: "POST",
      headers: buildCodexOauthHeaders({
        accountId,
        token: input.token,
      }),
      body: JSON.stringify({
        model: this.oauthModel,
        store: false,
        stream: true,
        instructions: input.instructions,
        input: input.input,
        text: { verbosity: "medium" },
        include: ["reasoning.encrypted_content"],
        ...(input.tools.length > 0
          ? {
              tools: toResponseTools(input.tools),
              tool_choice: "auto",
              parallel_tool_calls: true,
            }
          : {}),
      }),
      signal: input.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      const message = normalizeCodexOauthErrorMessage(errorText)
      throw new CodexModelCallError(
        "model_http_error",
        message ?? `model call failed with status ${response.status}`,
        response.status,
      )
    }

    const collected = await collectCodexOauthResponse(response)
    return collected.payload
  }

  private async completeWithOpenAiResponses(input: CodexModelCallInput): Promise<string> {
    if (input.tools && input.tools.length > 0) {
      return await this.completeWithOpenAiResponsesTools(input)
    }
    const abortController = new AbortController()
    const cleanupAbort = linkAbortSignal(input.signal, abortController)
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: input.systemPrompt }],
            },
            ...toModelHistory(input.context.selectedHistory),
            {
              role: "user",
              content: [{ type: "input_text", text: input.message }],
            },
          ],
        }),
        signal: abortController.signal,
      })

      const payload = (await response.json()) as OpenAIResponsesApiResponse
      if (!response.ok) {
        const message = normalizeErrorMessage(payload.error?.message)
        throw new CodexModelCallError(
          "model_http_error",
          message ?? `model call failed with status ${response.status}`,
          response.status,
        )
      }

      const text = extractOutputText(payload)
      if (!text) {
        throw new CodexModelCallError(
          "model_invalid_response",
          "model response did not include text",
        )
      }

      return text
    } catch (error) {
      throwNormalizedProviderError({
        error,
        factory: codexProviderErrorFactory,
        invalidResponseMessage: "failed to parse model response",
      })
    } finally {
      clearTimeout(timeout)
      cleanupAbort()
    }
  }

  private async completeWithOpenAiResponsesTools(input: CodexModelCallInput): Promise<string> {
    const abortController = new AbortController()
    const cleanupAbort = linkAbortSignal(input.signal, abortController)
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs)
    const toolMap = new Map(input.tools?.map((tool) => [tool.name, tool]) ?? [])

    try {
      let previousResponseId: string | null = null
      let nextInput: Array<Record<string, unknown>> = [
        ...toModelHistory(input.context.selectedHistory),
        {
          role: "user",
          content: [{ type: "input_text", text: input.message }],
        },
      ]

      for (let round = 0; round < this.maxToolRounds; round += 1) {
        const payload = (await this.sendOpenAiResponsesRequest({
          apiKey: input.apiKey,
          instructions: input.systemPrompt,
          input: nextInput,
          previousResponseId,
          tools: input.tools ?? [],
          signal: abortController.signal,
        })) as OpenAIResponsesApiResponse

        const toolCalls = extractFunctionCalls(payload)
        if (toolCalls.length === 0) {
          const text = extractOutputText(payload)
          if (!text) {
            throw new CodexModelCallError(
              "model_invalid_response",
              "model response did not include text",
            )
          }
          return text
        }

        const responseId =
          typeof payload.id === "string" && payload.id.trim().length > 0 ? payload.id : null
        if (!responseId) {
          throw new CodexModelCallError(
            "model_invalid_response",
            "tool response did not include an id",
          )
        }

        previousResponseId = responseId
        nextInput = []

        for (const toolCall of toolCalls) {
          const args = safeJsonParse(toolCall.arguments) ?? {}
          const output = await executeProviderToolCall({
            tool: toolMap.get(toolCall.name),
            toolName: toolCall.name,
            args,
          })
          nextInput.push({
            type: "function_call_output",
            call_id: toolCall.callId,
            output,
          })
        }
      }

      throw new CodexModelCallError("model_invalid_response", "tool loop exceeded max rounds")
    } catch (error) {
      throwNormalizedProviderError({
        error,
        factory: codexProviderErrorFactory,
        invalidResponseMessage: "failed to parse model response",
      })
    } finally {
      clearTimeout(timeout)
      cleanupAbort()
    }
  }

  private async completeWithCodexOauth(input: CodexModelCallInput): Promise<string> {
    if (input.tools && input.tools.length > 0) {
      return await this.completeWithCodexOauthTools(input)
    }
    const abortController = new AbortController()
    const cleanupAbort = linkAbortSignal(input.signal, abortController)
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs)

    try {
      const payload = await this.sendCodexOauthRequest({
        token: input.apiKey,
        instructions: input.systemPrompt,
        input: toCodexOauthHistory(input.context.selectedHistory, input.message),
        tools: [],
        signal: abortController.signal,
      })
      const text = extractOutputText(payload)
      if (!text) {
        throw new CodexModelCallError(
          "model_invalid_response",
          "model response did not include text",
        )
      }

      return text
    } catch (error) {
      throwNormalizedProviderError({
        error,
        factory: codexProviderErrorFactory,
        invalidResponseMessage: "failed to parse model response",
      })
    } finally {
      clearTimeout(timeout)
      cleanupAbort()
    }
  }

  private async completeWithCodexOauthTools(input: CodexModelCallInput): Promise<string> {
    const abortController = new AbortController()
    const cleanupAbort = linkAbortSignal(input.signal, abortController)
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs)
    const toolMap = new Map(input.tools?.map((tool) => [tool.name, tool]) ?? [])

    try {
      let nextInput: Array<Record<string, unknown>> = toCodexOauthHistory(
        input.context.selectedHistory,
        input.message,
      )

      for (let round = 0; round < this.maxToolRounds; round += 1) {
        const responsePayload = await this.sendCodexOauthRequest({
          token: input.apiKey,
          instructions: input.systemPrompt,
          input: nextInput,
          tools: input.tools ?? [],
          signal: abortController.signal,
        })

        const toolCalls = extractFunctionCalls(responsePayload)
        if (toolCalls.length === 0) {
          const text = extractOutputText(responsePayload)
          if (!text) {
            throw new CodexModelCallError(
              "model_invalid_response",
              "model response did not include text",
            )
          }
          return text
        }

        const replayableToolCalls = extractReplayableFunctionCalls(responsePayload)
        nextInput = [...nextInput, ...replayableToolCalls]

        for (const toolCall of toolCalls) {
          const args = safeJsonParse(toolCall.arguments) ?? {}
          const output = await executeProviderToolCall({
            tool: toolMap.get(toolCall.name),
            toolName: toolCall.name,
            args,
          })
          nextInput.push({
            type: "function_call_output",
            call_id: toolCall.callId,
            output,
          })
        }
      }

      throw new CodexModelCallError("model_invalid_response", "tool loop exceeded max rounds")
    } catch (error) {
      throwNormalizedProviderError({
        error,
        factory: codexProviderErrorFactory,
        invalidResponseMessage: "failed to parse model response",
      })
    } finally {
      clearTimeout(timeout)
      cleanupAbort()
    }
  }
}

function extractReplayableFunctionCalls(
  payload: OpenAIResponsesApiResponse,
): Array<Record<string, unknown>> {
  if (!Array.isArray(payload.output)) {
    return []
  }

  return payload.output.flatMap((item) => {
    if (!isResponseOutputItem(item) || item.type !== "function_call") {
      return []
    }
    return [{ ...item }]
  })
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) {
    return () => {}
  }
  if (signal.aborted) {
    controller.abort()
    return () => {}
  }
  const onAbort = () => controller.abort()
  signal.addEventListener("abort", onAbort, { once: true })
  return () => signal.removeEventListener("abort", onAbort)
}

function toModelHistory(records: BuiltContext["selectedHistory"]): Array<{
  role: "user" | "assistant"
  content: Array<{ type: "input_text"; text: string }>
}> {
  return records.map((record) => ({
    role: record.role,
    content: [{ type: "input_text", text: record.message }],
  }))
}

function toResponseTools(tools: AgentRuntimeToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

function extractOutputText(payload: OpenAIResponsesApiResponse): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text
  }

  if (!Array.isArray(payload.output)) {
    return null
  }

  const chunks: string[] = []
  for (const item of payload.output) {
    if (!isResponseOutputItem(item) || !Array.isArray(item.content)) {
      continue
    }

    for (const contentPart of item.content) {
      if (!isResponseContentPart(contentPart)) {
        continue
      }

      const isTextType = contentPart.type === "output_text" || contentPart.type === "text"
      if (
        isTextType &&
        typeof contentPart.text === "string" &&
        contentPart.text.trim().length > 0
      ) {
        chunks.push(contentPart.text)
      }
    }
  }

  if (chunks.length === 0) {
    return null
  }

  return chunks.join("")
}

function extractFunctionCalls(payload: OpenAIResponsesApiResponse): ToolCallItem[] {
  if (!Array.isArray(payload.output)) {
    return []
  }
  return payload.output.flatMap((item) => {
    if (!isResponseOutputItem(item)) {
      return []
    }
    if (item.type !== "function_call") {
      return []
    }
    const name = typeof item.name === "string" ? item.name : null
    const callId = typeof item.call_id === "string" ? item.call_id : null
    const args = typeof item.arguments === "string" ? item.arguments : "{}"
    if (!name || !callId) {
      return []
    }
    return [
      {
        name,
        callId,
        arguments: args,
      },
    ]
  })
}

function normalizeErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const message = value.trim()
  return message.length > 0 ? message : null
}

function isResponseOutputItem(value: unknown): value is ResponseOutputItem {
  return typeof value === "object" && value !== null
}

function isResponseContentPart(value: unknown): value is ResponseContentPart {
  return typeof value === "object" && value !== null
}

async function sendResponseRequest(input: {
  fetchImpl: typeof fetch
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  signal: AbortSignal
}): Promise<OpenAIResponsesApiResponse> {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: input.headers,
    body: JSON.stringify(input.body),
    signal: input.signal,
  })
  const payload = (await response.json()) as OpenAIResponsesApiResponse
  if (!response.ok) {
    const message = normalizeErrorMessage(payload.error?.message)
    throw new CodexModelCallError(
      "model_http_error",
      message ?? `model call failed with status ${response.status}`,
      response.status,
    )
  }
  return payload
}

interface CodexOauthCollectedResponse {
  payload: OpenAIResponsesApiResponse
}

interface StreamedFunctionCallState {
  itemId: string
  outputIndex: number
  name: string | null
  callId: string | null
  arguments: string
}

async function collectCodexOauthResponse(response: Response): Promise<CodexOauthCollectedResponse> {
  if (!response.body) {
    throw new CodexModelCallError("model_invalid_response", "Codex oauth response body was empty")
  }

  let accumulated = ""
  let completedPayload: OpenAIResponsesApiResponse | null = null
  const streamedFunctionCalls = new Map<string, StreamedFunctionCallState>()

  for await (const event of parseServerSentEvents(response)) {
    const type = typeof event.type === "string" ? event.type : ""
    if (!type) {
      continue
    }

    if (type === "error") {
      throw new CodexModelCallError(
        "model_http_error",
        normalizeCodexOauthErrorMessage(event.message) ?? "Codex oauth request failed",
      )
    }

    if (type === "response.failed") {
      const failedResponse =
        event.response && typeof event.response === "object"
          ? (event.response as { error?: { message?: unknown } })
          : undefined
      const message =
        normalizeCodexOauthErrorMessage(failedResponse?.error?.message) ??
        "Codex oauth request failed"
      throw new CodexModelCallError("model_http_error", message)
    }

    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      accumulated += event.delta
      continue
    }

    if (
      (type === "response.output_text.done" || type === "response.text.done") &&
      typeof event.text === "string" &&
      event.text.trim().length > 0
    ) {
      accumulated = event.text
      continue
    }

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item =
        event.item && typeof event.item === "object" && !Array.isArray(event.item)
          ? (event.item as ResponseOutputItem)
          : null
      if (item && item.type === "function_call") {
        const itemId =
          typeof (event as { item_id?: unknown }).item_id === "string"
            ? ((event as { item_id?: string }).item_id ?? null)
            : null
        const outputIndex =
          typeof (event as { output_index?: unknown }).output_index === "number"
            ? ((event as { output_index?: number }).output_index ?? 0)
            : 0
        const stateKey = itemId ?? `output:${outputIndex}`
        const current = streamedFunctionCalls.get(stateKey)
        streamedFunctionCalls.set(stateKey, {
          itemId: itemId ?? current?.itemId ?? stateKey,
          outputIndex,
          name: typeof item.name === "string" ? item.name : (current?.name ?? null),
          callId: typeof item.call_id === "string" ? item.call_id : (current?.callId ?? null),
          arguments:
            typeof item.arguments === "string" ? item.arguments : (current?.arguments ?? ""),
        })
      }
      continue
    }

    if (
      type === "response.function_call_arguments.delta" ||
      type === "response.function_call_arguments.done"
    ) {
      const itemId =
        typeof (event as { item_id?: unknown }).item_id === "string"
          ? ((event as { item_id?: string }).item_id ?? null)
          : null
      const outputIndex =
        typeof (event as { output_index?: unknown }).output_index === "number"
          ? ((event as { output_index?: number }).output_index ?? 0)
          : 0
      const stateKey = itemId ?? `output:${outputIndex}`
      const current = streamedFunctionCalls.get(stateKey)
      streamedFunctionCalls.set(stateKey, {
        itemId: itemId ?? current?.itemId ?? stateKey,
        outputIndex,
        name:
          typeof (event as { name?: unknown }).name === "string"
            ? ((event as { name?: string }).name ?? null)
            : (current?.name ?? null),
        callId:
          typeof (event as { call_id?: unknown }).call_id === "string"
            ? ((event as { call_id?: string }).call_id ?? null)
            : (current?.callId ?? null),
        arguments:
          type === "response.function_call_arguments.done" &&
          typeof (event as { arguments?: unknown }).arguments === "string"
            ? ((event as { arguments?: string }).arguments ?? current?.arguments ?? "")
            : `${current?.arguments ?? ""}${typeof event.delta === "string" ? event.delta : ""}`,
      })
      continue
    }

    if (
      type === "response.completed" ||
      type === "response.done" ||
      type === "response.incomplete"
    ) {
      const payload =
        event.response && typeof event.response === "object"
          ? (event.response as OpenAIResponsesApiResponse)
          : null
      completedPayload = payload ?? {
        output_text: accumulated,
      }
      break
    }
  }

  const streamedOutput = Array.from(streamedFunctionCalls.values())
    .filter((item) => item.name && item.callId)
    .sort((left, right) => left.outputIndex - right.outputIndex)
    .map(
      (item) =>
        ({
          type: "function_call",
          name: item.name,
          call_id: item.callId,
          arguments: item.arguments,
        }) satisfies ResponseOutputItem,
    )

  if (completedPayload) {
    const mergedPayload = mergeCollectedCodexOauthPayload({
      payload: completedPayload,
      accumulatedText: accumulated,
      streamedOutput,
    })
    const completedText = extractOutputText(mergedPayload)
    if (!completedText && streamedOutput.length === 0 && accumulated.trim().length > 0) {
      return {
        payload: {
          ...mergedPayload,
          output_text: accumulated,
        },
      }
    }

    return { payload: mergedPayload }
  }

  if (accumulated.trim().length > 0 || streamedOutput.length > 0) {
    return {
      payload: mergeCollectedCodexOauthPayload({
        payload: {},
        accumulatedText: accumulated,
        streamedOutput,
      }),
    }
  }

  throw new CodexModelCallError("model_invalid_response", "model response did not include text")
}

function mergeCollectedCodexOauthPayload(input: {
  payload: OpenAIResponsesApiResponse
  accumulatedText: string
  streamedOutput: ResponseOutputItem[]
}): OpenAIResponsesApiResponse {
  const nextPayload: OpenAIResponsesApiResponse = { ...input.payload }
  const existingOutput = Array.isArray(input.payload.output) ? [...input.payload.output] : []
  const existingCallIds = new Set(
    existingOutput
      .filter(isResponseOutputItem)
      .map((item) => (typeof item.call_id === "string" ? item.call_id : null))
      .filter((value): value is string => Boolean(value)),
  )
  const missingStreamedOutput = input.streamedOutput.filter(
    (item) => !(typeof item.call_id === "string" && existingCallIds.has(item.call_id)),
  )

  if (existingOutput.length > 0 || missingStreamedOutput.length > 0) {
    nextPayload.output = [...existingOutput, ...missingStreamedOutput]
  }

  if (!extractOutputText(nextPayload) && input.accumulatedText.trim().length > 0) {
    nextPayload.output_text = input.accumulatedText
  }

  return nextPayload
}

async function* parseServerSentEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      let separatorIndex = buffer.indexOf("\n\n")
      while (separatorIndex !== -1) {
        const chunk = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        const parsed = parseServerSentEventChunk(chunk)
        if (parsed) {
          yield parsed
        }

        separatorIndex = buffer.indexOf("\n\n")
      }
    }

    const trailing = parseServerSentEventChunk(buffer)
    if (trailing) {
      yield trailing
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // no-op
    }

    try {
      reader.releaseLock()
    } catch {
      // no-op
    }
  }
}

function parseServerSentEventChunk(chunk: string): Record<string, unknown> | null {
  const normalizedChunk = chunk.trim()
  if (!normalizedChunk) {
    return null
  }

  const dataLines = normalizedChunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())

  if (dataLines.length === 0) {
    return null
  }

  const data = dataLines.join("\n").trim()
  if (!data || data === "[DONE]") {
    return null
  }

  const parsed = safeJsonParse(data)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  return parsed as Record<string, unknown>
}

function toCodexOauthHistory(
  records: BuiltContext["selectedHistory"],
  message: string,
): Array<Record<string, unknown>> {
  return [
    ...records.map((record) =>
      record.role === "assistant"
        ? {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text" as const, text: record.message, annotations: [] }],
          }
        : {
            role: "user",
            content: [{ type: "input_text" as const, text: record.message }],
          },
    ),
    {
      role: "user",
      content: [{ type: "input_text" as const, text: message }],
    },
  ]
}

function resolveCodexOauthUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "")
  if (normalized.endsWith("/codex/responses")) {
    return normalized
  }

  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`
  }

  return `${normalized}/codex/responses`
}

function buildCodexOauthHeaders(params: {
  accountId: string
  token: string
}): Record<string, string> {
  return {
    authorization: `Bearer ${params.token}`,
    "chatgpt-account-id": params.accountId,
    originator: "pi",
    "user-agent": buildCodexOauthUserAgent(),
    "openai-beta": "responses=experimental",
    accept: "text/event-stream",
    "content-type": "application/json",
  }
}

function buildCodexOauthUserAgent(): string {
  const platform = process.platform || "unknown"
  const arch = process.arch || "unknown"
  return `openboa (${platform} ${arch})`
}

function extractCodexAccountId(token: string): string {
  const payload = decodeJwtPayload(token)
  const authClaim =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)["https://api.openai.com/auth"]
      : undefined

  if (authClaim && typeof authClaim === "object") {
    const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId === "string" && accountId.trim().length > 0) {
      return accountId
    }
  }

  throw new CodexModelCallError(
    "model_invalid_response",
    "failed to extract accountId from oauth token",
  )
}

function decodeJwtPayload(token: string): unknown {
  const parts = token.split(".")
  if (parts.length !== 3) {
    return null
  }

  const payload = parts[1]
  if (!payload) {
    return null
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
    const raw = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8")
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function normalizeCodexOauthErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const parsed = safeJsonParse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const directMessage = normalizeErrorMessage((parsed as { message?: unknown }).message)
      if (directMessage) {
        return directMessage
      }

      const nestedMessage = normalizeErrorMessage(
        (parsed as { error?: { message?: unknown } }).error?.message,
      )
      if (nestedMessage) {
        return nestedMessage
      }
    }

    return trimmed
  }

  return normalizeErrorMessage(value)
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
