import { type IncomingMessage, type ServerResponse, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { URL } from "node:url"

import type { ChatTurnInput, ChatTurnResult } from "./chat.js"
import { runChatTurn } from "./chat.js"

const DEFAULT_HOST = process.env.OPENBOA_API_HOST ?? "0.0.0.0"
const DEFAULT_PORT = Number(process.env.OPENBOA_API_PORT ?? "8787")
const DEFAULT_MAX_BODY_BYTES = Number(process.env.OPENBOA_API_MAX_BODY_BYTES ?? "16384")
const DEFAULT_CHAT_TIMEOUT_MS = Number(process.env.OPENBOA_CHAT_TIMEOUT_MS ?? "30000")

type ExecuteChatTurn = (input: ChatTurnInput) => Promise<ChatTurnResult>

interface ChatRequestBody {
  message?: unknown
  agentId?: unknown
  chatId?: unknown
  sessionId?: unknown
  senderId?: unknown
}

export interface ChatApiServerOptions {
  workspaceDir: string
  host?: string
  port?: number
  maxBodyBytes?: number
  chatTimeoutMs?: number
  executeChatTurn?: ExecuteChatTurn
}

export interface ChatApiServer {
  host: string
  port: number
  close: () => Promise<void>
}

interface HttpApiError {
  statusCode: number
  code: string
  message: string
}

export async function startChatApiServer(options: ChatApiServerOptions): Promise<ChatApiServer> {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const chatTimeoutMs = options.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS
  const executeChatTurn = options.executeChatTurn ?? runChatTurn

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://local")

      if (url.pathname === "/health") {
        return handleHealth(request, response)
      }

      if (url.pathname === "/chat") {
        return await handleChat(
          request,
          response,
          options.workspaceDir,
          executeChatTurn,
          maxBodyBytes,
          chatTimeoutMs,
        )
      }

      throw apiError(404, "not_found", "route not found")
    } catch (error) {
      return writeError(response, normalizeError(error))
    }
  })

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve())
  })

  const address = server.address()
  const effectivePort =
    typeof address === "object" && address !== null ? (address as AddressInfo).port : port

  return {
    host,
    port: effectivePort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

function handleHealth(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET") {
    throw apiError(405, "method_not_allowed", "method not allowed")
  }

  writeJson(response, 200, {
    ok: true,
    service: "openboa-pi-chat",
    uptimeSeconds: Math.floor(process.uptime()),
  })
}

async function handleChat(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceDir: string,
  executeChatTurn: ExecuteChatTurn,
  maxBodyBytes: number,
  chatTimeoutMs: number,
): Promise<void> {
  if (request.method !== "POST") {
    throw apiError(405, "method_not_allowed", "method not allowed")
  }

  if (!hasEnvApiKey()) {
    throw apiError(503, "missing_api_key", "CODEX_API_KEY is required")
  }

  const raw = await readRequestBody(request, maxBodyBytes)
  const payload = parseJsonBody(raw)
  const message = readTextField(payload.message, "message")

  const input: ChatTurnInput = {
    workspaceDir,
    agentId: readOptionalTextField(payload.agentId) ?? "pi-agent",
    chatId: readOptionalTextField(payload.chatId) ?? "api-chat",
    sessionId: readOptionalTextField(payload.sessionId) ?? "api-session",
    senderId: readOptionalTextField(payload.senderId) ?? "api-user",
    message,
  }

  const result = await runWithTimeout(executeChatTurn(input), chatTimeoutMs)

  writeJson(response, 200, {
    ok: true,
    data: {
      response: result.final.response,
      chunks: result.chunks,
      chatId: result.final.chatId,
      sessionId: result.final.sessionId,
      agentId: result.final.agentId,
      checkpointId: result.final.checkpointId,
      authMode: result.final.authMode,
      recoveredFromCheckpoint: result.final.recoveredFromCheckpoint,
    },
  })
}

function hasEnvApiKey(): boolean {
  return (
    typeof process.env.CODEX_API_KEY === "string" && process.env.CODEX_API_KEY.trim().length > 0
  )
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(apiError(504, "chat_timeout", "chat request timed out"))
    }, timeoutMs)

    void promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer))
  })
}

function parseJsonBody(raw: string): ChatRequestBody {
  try {
    return JSON.parse(raw) as ChatRequestBody
  } catch {
    throw apiError(400, "invalid_json", "request body must be valid JSON")
  }
}

function readTextField(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw apiError(400, "invalid_request", `${fieldName} is required`)
  }
  return value.trim()
}

function readOptionalTextField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    let tooLarge = false

    request.on("data", (chunk: Buffer) => {
      if (tooLarge) {
        return
      }

      totalSize += chunk.byteLength
      if (totalSize > maxBytes) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })

    request.on("end", () => {
      if (tooLarge) {
        reject(apiError(413, "payload_too_large", "request body too large"))
        return
      }

      resolve(Buffer.concat(chunks).toString("utf8"))
    })
    request.on("error", () =>
      reject(apiError(400, "invalid_request", "failed to read request body")),
    )
  })
}

function apiError(statusCode: number, code: string, message: string): HttpApiError {
  return { statusCode, code, message }
}

function normalizeError(error: unknown): HttpApiError {
  if (isHttpApiError(error)) {
    return error
  }

  return {
    statusCode: 500,
    code: "internal_error",
    message: "internal server error",
  }
}

function isHttpApiError(value: unknown): value is HttpApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "statusCode" in value &&
    typeof value.statusCode === "number" &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string"
  )
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.end(JSON.stringify(body))
}

function writeError(response: ServerResponse, error: HttpApiError): void {
  writeJson(response, error.statusCode, {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
  })
}
