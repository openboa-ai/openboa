import { stdin as input, stdout as output } from "node:process"
import readline from "node:readline/promises"

import { runChatTurn } from "./chat.js"

export interface TuiChatOptions {
  chatId?: string
  sessionId?: string
  senderId?: string
}

export async function runTuiChat(
  workspaceDir: string,
  agentId = "pi-agent",
  options: TuiChatOptions = {},
): Promise<void> {
  const rl = readline.createInterface({ input, output })

  const chatId = options.chatId ?? `${agentId}-chat`
  const sessionId = options.sessionId ?? `${agentId}-session`
  const senderId = options.senderId ?? "operator"

  output.write(`tui ready for agent=${agentId} (type 'exit' to quit)\n`)
  try {
    for (;;) {
      const message = (await rl.question("you> ")).trim()
      if (!message) {
        continue
      }
      if (message === "exit") {
        break
      }

      const result = await runChatTurn({
        workspaceDir,
        agentId,
        chatId,
        sessionId,
        senderId,
        message,
      })

      output.write(`agent> ${result.final.response}\n`)
    }
  } finally {
    rl.close()
  }
}
