import type { ToolPolicyLike } from "../tools/tool-policy.js"
import { formatToolPolicySummary } from "../tools/tool-policy.js"

export type SandboxWorkspaceAccess = "none" | "ro" | "rw"

export interface SandboxConfig {
  mode?: "off" | "workspace"
  workspaceAccess?: SandboxWorkspaceAccess
  tools?: ToolPolicyLike
}

export interface ResolvedSandboxConfig {
  mode: "off" | "workspace"
  workspaceAccess: SandboxWorkspaceAccess
  tools?: ToolPolicyLike
}

export function resolveSandboxConfig(config?: SandboxConfig): ResolvedSandboxConfig {
  const mode = config?.mode === "workspace" ? "workspace" : "off"
  const workspaceAccess = config?.workspaceAccess ?? "rw"
  return {
    mode,
    workspaceAccess,
    ...(config?.tools ? { tools: config.tools } : {}),
  }
}

export function formatSandboxSummary(config?: SandboxConfig): string {
  const resolved = resolveSandboxConfig(config)
  const parts = [`mode=${resolved.mode}`, `workspace=${resolved.workspaceAccess}`]
  const toolSummary = formatToolPolicySummary(resolved.tools)
  if (toolSummary) {
    parts.push(`tools=${toolSummary}`)
  }
  return parts.join(" | ")
}
