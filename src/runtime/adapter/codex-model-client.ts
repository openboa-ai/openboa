import type { BuiltContext } from "../context-builder.js"
import type { ChatRecord } from "../storage/chat-store.js"

interface ResponseContentPart {
  type?: unknown
  text?: unknown
}

interface ResponseOutputItem {
  content?: unknown
}

interface OpenAIResponsesApiResponse {
  output_text?: unknown
  output?: unknown
  error?: {
    message?: unknown
  }
}

export interface CodexModelClientOptions {
  apiBaseUrl?: string
  model?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface CodexModelCallInput {
  apiKey: string
  systemPrompt: string
  context: BuiltContext
  message: string
}

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

export class CodexModelClient {
  private readonly apiBaseUrl: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: CodexModelClientOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.openai.com/v1"
    this.model = options.model ?? process.env.OPENBOA_CODEX_MODEL ?? "codex-mini-latest"
    this.timeoutMs = options.timeoutMs ?? Number(process.env.OPENBOA_MODEL_TIMEOUT_MS ?? "20000")
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async complete(input: CodexModelCallInput): Promise<string> {
    const abortController = new AbortController()
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
      if (error instanceof CodexModelCallError) {
        throw error
      }

      if (isAbortError(error)) {
        throw new CodexModelCallError("model_timeout", "model call timed out")
      }

      throw new CodexModelCallError("model_invalid_response", "failed to parse model response")
    } finally {
      clearTimeout(timeout)
    }
  }
}

function toModelHistory(records: ChatRecord[]): Array<{
  role: "user" | "assistant"
  content: Array<{ type: "input_text"; text: string }>
}> {
  return records.map((record) => ({
    role: record.sender.kind === "agent" ? "assistant" : "user",
    content: [{ type: "input_text", text: record.message }],
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

function normalizeErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const message = value.trim()
  return message.length > 0 ? message : null
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError"
}

function isResponseOutputItem(value: unknown): value is ResponseOutputItem {
  return typeof value === "object" && value !== null
}

function isResponseContentPart(value: unknown): value is ResponseContentPart {
  return typeof value === "object" && value !== null
}
