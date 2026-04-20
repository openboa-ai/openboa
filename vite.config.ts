import type { IncomingMessage, ServerResponse } from "node:http"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { invokeDesktopChatRuntimeGatewayMethod } from "./src/shell/desktop/chat-runtime-gateway-registry.js"

const CHAT_GATEWAY_PATH = "/__openboa/chat/gateway"

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim()
  return raw.length > 0 ? JSON.parse(raw) : {}
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown): void {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(value))
}

export async function invokeChatGatewayMethod(
  companyDir: string,
  method: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return invokeDesktopChatRuntimeGatewayMethod(companyDir, method, input)
}

function openboaChatGatewayPlugin(command: "serve" | "build", companyDir: string) {
  return {
    name: "openboa-chat-gateway",
    configureServer(server: {
      middlewares: {
        use: (
          path: string,
          handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
        ) => void
      }
    }) {
      if (command !== "serve") {
        return
      }

      server.middlewares.use(CHAT_GATEWAY_PATH, (req, res, next) => {
        if (req.method !== "POST") {
          next()
          return
        }

        void (async () => {
          try {
            const body = (await readJsonBody(req)) as {
              method?: string
              input?: Record<string, unknown>
            }
            if (!body.method) {
              writeJson(res, 400, { error: "Missing chat gateway method" })
              return
            }

            const result = await invokeChatGatewayMethod(companyDir, body.method, body.input ?? {})
            writeJson(res, 200, { result })
          } catch (error) {
            writeJson(res, 500, {
              error: error instanceof Error ? error.message : "Chat gateway request failed",
            })
          }
        })()
      })
    },
  }
}

export function buildShellViteConfig(
  command: "serve" | "build",
  options?: {
    companyDir?: string
  },
) {
  const companyDir = options?.companyDir ?? process.cwd()
  return {
    root: resolve(__dirname, "src/shell/web"),
    base: command === "build" ? "./" : "/",
    plugins: [react(), tailwindcss(), openboaChatGatewayPlugin(command, companyDir)],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    build: {
      outDir: resolve(__dirname, "dist/web"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: resolve(__dirname, "src/shell/web/index.html"),
          chat: resolve(__dirname, "src/shell/web/chat/index.html"),
        },
      },
    },
  }
}

export default defineConfig(({ command }) =>
  buildShellViteConfig(command === "build" ? "build" : "serve"),
)
