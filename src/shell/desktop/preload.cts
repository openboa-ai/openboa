import { contextBridge, ipcRenderer } from "electron"
import {
  CHAT_RUNTIME_GATEWAY_IPC_CHANNELS,
  createChatRuntimeGatewayClient,
} from "../chat/runtime-gateway.js"

const chatRuntimeGateway = createChatRuntimeGatewayClient((method, input) =>
  ipcRenderer.invoke(CHAT_RUNTIME_GATEWAY_IPC_CHANNELS[method], input),
)

contextBridge.exposeInMainWorld("openboaChatGateway", chatRuntimeGateway)
