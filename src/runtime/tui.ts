import { stdin as input, stdout as output } from "node:process"
import readline from "node:readline/promises"

import { runChatTurn } from "./chat.js"

export async function runTuiChat(workspaceDir: string, agentId = "pi-agent"): Promise<void> {
  const rl = readline.createInterface({ input, output })

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
        chatId: "tui-chat",
        sessionId: "tui-session",
        senderId: "operator",
        message,
      })

      output.write(`agent> ${result.final.response}\n`)
    }
  } finally {
    rl.close()
  }
}
