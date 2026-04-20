import { describe, expect, it } from "vitest"
import {
  CHAT_RUNTIME_GATEWAY_IPC_CHANNELS,
  CHAT_RUNTIME_GATEWAY_METHODS,
} from "../src/shell/chat/runtime-gateway.js"
import { desktopChatRuntimeGatewayRegistry } from "../src/shell/desktop/chat-runtime-gateway-registry.js"

describe("chat runtime gateway contract", () => {
  it("keeps IPC channels and desktop registry coverage aligned with the shared method map", () => {
    expect(Object.keys(CHAT_RUNTIME_GATEWAY_IPC_CHANNELS).sort()).toEqual(
      [...CHAT_RUNTIME_GATEWAY_METHODS].sort(),
    )
    expect(Object.keys(desktopChatRuntimeGatewayRegistry).sort()).toEqual(
      [...CHAT_RUNTIME_GATEWAY_METHODS].sort(),
    )
  })
})
