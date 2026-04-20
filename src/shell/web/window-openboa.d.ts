import type { ChatRuntimeGateway } from "../chat/runtime-gateway.js"

declare global {
  interface Window {
    openboaChatGateway?: ChatRuntimeGateway
  }
}
