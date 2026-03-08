import { BoaRuntime } from "./boa-runtime.js"
import { BoaGateway } from "./gateway/boa-gateway.js"

export interface MinimalRuntime {
  runtime: BoaRuntime
  gateway: BoaGateway
}

export function createMinimalPiRuntime(workspaceDir: string): MinimalRuntime {
  const runtime = new BoaRuntime({ workspaceDir })
  const gateway = new BoaGateway(runtime)
  return { runtime, gateway }
}
