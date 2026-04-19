import type { SandboxConfig } from "../sandbox/sandbox-policy.js"
import { formatSandboxSummary } from "../sandbox/sandbox-policy.js"
import type { ResourceAttachment } from "../schema/runtime.js"
import type { AgentSkillsConfig } from "../skills/agent-skills.js"
import { resolveSkillsPromptForRun } from "../skills/agent-skills.js"
import type { ToolPolicyLike } from "../tools/tool-policy.js"
import { formatToolPolicySummary } from "../tools/tool-policy.js"

export interface RuntimeEnvironmentPromptInput {
  companyDir: string
  provider: string
  model: string
  environmentId?: string
  environmentName?: string
  tools?: ToolPolicyLike
  sandbox?: SandboxConfig
  skills?: AgentSkillsConfig
  resources?: ResourceAttachment[]
}

export async function buildRuntimeEnvironmentPrompt(
  input: RuntimeEnvironmentPromptInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const sections: string[] = []

  sections.push(
    [
      "<runtime-environment-summary>",
      `provider=${input.provider}`,
      `model=${input.model}`,
      `environment=${input.environmentId ?? "unknown"}${input.environmentName ? ` (${input.environmentName})` : ""}`,
      `sandbox=${formatSandboxSummary(input.sandbox)}`,
      `tools=${formatToolPolicySummary(input.tools) ?? "allow-all-by-default"}`,
      "</runtime-environment-summary>",
    ].join("\n"),
  )

  if (input.resources && input.resources.length > 0) {
    sections.push(
      [
        "<mounted-resources>",
        ...input.resources.map((resource) => {
          const scope =
            typeof resource.metadata?.scope === "string" ? ` scope=${resource.metadata.scope}` : ""
          const prompt =
            typeof resource.metadata?.prompt === "string"
              ? ` prompt=${resource.metadata.prompt}`
              : ""
          return `- ${resource.mountPath} kind=${resource.kind} access=${resource.access}${scope}${prompt}`
        }),
        "</mounted-resources>",
      ].join("\n"),
    )
  }

  const skillsPrompt = await resolveSkillsPromptForRun(input.companyDir, input.skills, env)
  if (skillsPrompt) {
    sections.push(`<skill-runtime-catalog>\n${skillsPrompt}\n</skill-runtime-catalog>`)
  }

  return `<runtime-environment>\n${sections.join("\n\n")}\n</runtime-environment>`
}
