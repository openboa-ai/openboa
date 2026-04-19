import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentResilienceConfig } from "../agent-config.js"
import {
  buildContextBudgetMarkdown,
  type ContextBudgetSnapshot,
  summarizeContextPressure,
} from "../context/context-budget.js"
import type { RuntimeMemorySnapshot } from "../memory/runtime-memory-store.js"
import type {
  SessionOutcomeEvaluation,
  SessionOutcomeEvaluationRecord,
} from "../outcomes/outcome-evaluate.js"
import type { SessionOutcomeGrade } from "../outcomes/outcome-grade.js"
import { buildReadOnlyBashAlternative } from "../sandbox/sandbox.js"
import type {
  Environment,
  ResourceAttachment,
  Session,
  SessionEvent,
  SessionOutcomeDefinition,
  ToolDefinition,
} from "../schema/runtime.js"
import type { SessionSnapshot } from "../sessions/session-store.js"
import { summarizeSessionTraces } from "../sessions/session-traces.js"
import type { SkillEntry } from "../skills/agent-skills.js"
import {
  resolveAgentWorkspaceDir,
  type WorkspaceBootstrapEntry,
} from "../workspace/bootstrap-files.js"

function slugifyVaultName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function resourceScope(resource: ResourceAttachment): string | null {
  return typeof resource.metadata?.scope === "string" ? resource.metadata.scope : null
}

function resourcePrompt(resource: ResourceAttachment): string | null {
  return typeof resource.metadata?.prompt === "string" ? resource.metadata.prompt : null
}

function computeFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function buildOutcomeGradeMarkdown(input: {
  sessionId: string
  activeOutcome: SessionOutcomeDefinition | null
  outcomeGrade: SessionOutcomeGrade
}): string {
  const nextSuggestedTool = input.outcomeGrade.nextSuggestedTool
  return [
    "# Outcome Grade",
    "",
    `- Session: \`${input.sessionId}\``,
    `- Status: \`${input.outcomeGrade.status}\``,
    `- Confidence: \`${input.outcomeGrade.confidence}\``,
    `- Matched criteria: ${String(input.outcomeGrade.matchedCriteria)}/${String(input.outcomeGrade.totalCriteria)}`,
    `- Summary: ${input.outcomeGrade.summary}`,
    ...(input.activeOutcome
      ? [
          "",
          "## Active Outcome",
          "",
          `- Title: ${input.activeOutcome.title}`,
          `- Detail: ${input.activeOutcome.detail || "none"}`,
          ...(input.activeOutcome.successCriteria.length > 0
            ? input.activeOutcome.successCriteria.map(
                (criterion) => `- Success criterion: ${criterion}`,
              )
            : ["- Success criterion: none"]),
        ]
      : []),
    ...(input.outcomeGrade.evidence.length > 0
      ? ["", "## Evidence", "", ...input.outcomeGrade.evidence.map((evidence) => `- ${evidence}`)]
      : []),
    ...(nextSuggestedTool
      ? [
          "",
          "## Next Suggested Tool",
          "",
          `- Tool: \`${nextSuggestedTool.tool}\``,
          `- Args: \`${JSON.stringify(nextSuggestedTool.args)}\``,
          `- Why: ${nextSuggestedTool.rationale}`,
        ]
      : []),
  ].join("\n")
}

function buildOutcomeRepairMarkdown(input: {
  sessionId: string
  activeOutcome: SessionOutcomeDefinition | null
  outcomeGrade: SessionOutcomeGrade
}): string {
  const nextSuggestedTool = input.outcomeGrade.nextSuggestedTool
  return [
    "# Outcome Repair",
    "",
    `- Session: \`${input.sessionId}\``,
    `- Current grade: \`${input.outcomeGrade.status}\``,
    `- Summary: ${input.outcomeGrade.summary}`,
    `- Active outcome: ${input.activeOutcome?.title ?? "none"}`,
    ...(nextSuggestedTool
      ? [
          `- Recommended next tool: \`${nextSuggestedTool.tool}\``,
          `- Recommended args: \`${JSON.stringify(nextSuggestedTool.args)}\``,
          `- Rationale: ${nextSuggestedTool.rationale}`,
        ]
      : ["- Recommended next tool: none"]),
    ...(input.outcomeGrade.evidence.length > 0
      ? [
          "",
          "## Blocking or supporting evidence",
          "",
          ...input.outcomeGrade.evidence.map((evidence) => `- ${evidence}`),
        ]
      : []),
    "",
    "Treat this file as a repair hint, not as truth.",
    "Verify the current session state through the recommended tool before making the next bounded move.",
  ].join("\n")
}

function buildOutcomeEvaluationMarkdown(input: {
  sessionId: string
  activeOutcome: SessionOutcomeDefinition | null
  outcomeEvaluation: SessionOutcomeEvaluation
  evaluationHistoryCount: number
  latestIteration: number | null
}): string {
  const nextSuggestedTool = input.outcomeEvaluation.nextSuggestedTool
  return [
    "# Outcome Evaluation",
    "",
    `- Session: \`${input.sessionId}\``,
    `- Status: \`${input.outcomeEvaluation.status}\``,
    `- Confidence: \`${input.outcomeEvaluation.confidence}\``,
    `- Promotion ready: \`${String(input.outcomeEvaluation.promotionReady)}\``,
    `- Evaluation history count: \`${String(input.evaluationHistoryCount)}\``,
    `- Latest iteration: \`${input.latestIteration ?? "none"}\``,
    `- Summary: ${input.outcomeEvaluation.summary}`,
    `- Active outcome: ${input.activeOutcome?.title ?? "none"}`,
    ...(input.outcomeEvaluation.evidence.length > 0
      ? [
          "",
          "## Evidence",
          "",
          ...input.outcomeEvaluation.evidence.map((evidence) => `- ${evidence}`),
        ]
      : []),
    ...(nextSuggestedTool
      ? [
          "",
          "## Next Suggested Tool",
          "",
          `- Tool: \`${nextSuggestedTool.tool}\``,
          `- Args: \`${JSON.stringify(nextSuggestedTool.args)}\``,
          `- Why: ${nextSuggestedTool.rationale}`,
        ]
      : []),
  ].join("\n")
}

function buildOutcomeEvaluationHistoryMarkdown(input: {
  sessionId: string
  activeOutcome: SessionOutcomeDefinition | null
  evaluations: SessionOutcomeEvaluationRecord[]
}): string {
  return [
    "# Outcome Evaluations",
    "",
    `- Session: \`${input.sessionId}\``,
    `- Active outcome: ${input.activeOutcome?.title ?? "none"}`,
    `- Evaluation count: \`${String(input.evaluations.length)}\``,
    "",
    ...(input.evaluations.length > 0
      ? input.evaluations.flatMap((record, index) => [
          `## ${String(index + 1)}. Iteration \`${String(record.iteration)}\``,
          "",
          `- Evaluated At: \`${record.evaluatedAt}\``,
          `- Wake ID: \`${record.wakeId ?? "none"}\``,
          `- Outcome: ${record.outcomeTitle ?? "none"}`,
          `- Grade Status: \`${record.gradeStatus}\``,
          `- Status: \`${record.evaluation.status}\``,
          `- Confidence: \`${record.evaluation.confidence}\``,
          `- Promotion ready: \`${String(record.evaluation.promotionReady)}\``,
          `- Summary: ${record.evaluation.summary}`,
          ...(record.evaluation.evidence.length > 0
            ? [
                "",
                "### Evidence",
                "",
                ...record.evaluation.evidence.map((evidence) => `- ${evidence}`),
              ]
            : []),
          ...(record.evaluation.nextSuggestedTool
            ? [
                "",
                "### Next Suggested Tool",
                "",
                `- Tool: \`${record.evaluation.nextSuggestedTool.tool}\``,
                `- Args: \`${JSON.stringify(record.evaluation.nextSuggestedTool.args)}\``,
                `- Why: ${record.evaluation.nextSuggestedTool.rationale}`,
              ]
            : []),
          "",
        ])
      : ["No durable outcome evaluations recorded yet."]),
  ].join("\n")
}

function buildPermissionPostureMarkdown(input: {
  sessionId: string
  pendingToolConfirmationRequest: Session["pendingToolConfirmationRequest"]
  activeOutcome: SessionOutcomeDefinition | null
  outcomeEvaluation: SessionOutcomeEvaluation
  nextOutcomeStep: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
  nextShellStep: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
  readOnlyAlternative: {
    tool: string
    args: Record<string, unknown>
    rationale: string
  } | null
  shellReadFirstAlternatives: Array<{
    tool: string
    args: Record<string, unknown>
    rationale: string
  }>
  shellState: RuntimeMemorySnapshot["shellState"]
  shellMutationPosture: {
    persistentShell: RuntimeMemorySnapshot["shellState"] extends infer _T
      ? Record<string, unknown> | null
      : never
    lastCommandPreview: {
      command: string
      args: string[]
      cwd: string
      updatedAt: string
      outputPreview: string | null
      stdoutPreview: string | null
      stderrPreview: string | null
    } | null
    recoveryPlan: {
      tool: string
      args: Record<string, unknown>
      rationale: string
    } | null
  }
  contextPressure: {
    level: "low" | "moderate" | "high"
    reasons: string[]
    recommendedTools: string[]
  } | null
}): string {
  return [
    "# Permission Posture",
    "",
    `- Session: \`${input.sessionId}\``,
    `- Pending confirmation: \`${input.pendingToolConfirmationRequest?.toolName ?? "none"}\``,
    `- Active outcome: ${input.activeOutcome?.title ?? "none"}`,
    `- Outcome status: \`${input.outcomeEvaluation.status}\``,
    `- Promotion ready: \`${String(input.outcomeEvaluation.promotionReady)}\``,
    `- Outcome trend: \`${input.outcomeEvaluation.trend}\``,
    ...(input.nextOutcomeStep
      ? [
          `- Next outcome step: \`${input.nextOutcomeStep.tool}\``,
          `- Next outcome args: \`${JSON.stringify(input.nextOutcomeStep.args)}\``,
          `- Next outcome why: ${input.nextOutcomeStep.rationale}`,
        ]
      : ["- Next outcome step: none"]),
    ...(input.readOnlyAlternative
      ? [
          `- Read-only shell alternative: \`${input.readOnlyAlternative.tool}\``,
          `- Read-only alternative args: \`${JSON.stringify(input.readOnlyAlternative.args)}\``,
          `- Read-only alternative why: ${input.readOnlyAlternative.rationale}`,
        ]
      : ["- Read-only shell alternative: none"]),
    ...(input.nextShellStep
      ? [
          `- Next shell step: \`${input.nextShellStep.tool}\``,
          `- Next shell args: \`${JSON.stringify(input.nextShellStep.args)}\``,
          `- Next shell why: ${input.nextShellStep.rationale}`,
        ]
      : ["- Next shell step: none"]),
    ...(input.shellReadFirstAlternatives.length > 0
      ? [
          "",
          "## Shell Read-First Alternatives",
          "",
          ...input.shellReadFirstAlternatives.flatMap((alternative) => [
            `- Tool: \`${alternative.tool}\``,
            `  args: \`${JSON.stringify(alternative.args)}\``,
            `  why: ${alternative.rationale}`,
          ]),
        ]
      : ["- Shell read-first alternatives: none"]),
    `- Context pressure: \`${input.contextPressure?.level ?? "none"}\``,
    ...(input.contextPressure
      ? [
          `- Context pressure reasons: ${input.contextPressure.reasons.join(", ") || "none"}`,
          `- Context pressure tools: ${input.contextPressure.recommendedTools.join(", ") || "none"}`,
        ]
      : []),
    `- Shell cwd: \`${input.shellState?.cwd ?? "/workspace"}\``,
    `- Persistent shell status: \`${typeof input.shellMutationPosture.persistentShell?.status === "string" ? input.shellMutationPosture.persistentShell.status : "none"}\``,
    ...(input.shellMutationPosture.recoveryPlan
      ? [
          `- Shell recovery step: \`${input.shellMutationPosture.recoveryPlan.tool}\``,
          `- Shell recovery args: \`${JSON.stringify(input.shellMutationPosture.recoveryPlan.args)}\``,
          `- Shell recovery why: ${input.shellMutationPosture.recoveryPlan.rationale}`,
        ]
      : ["- Shell recovery step: none"]),
    ...(input.shellMutationPosture.lastCommandPreview
      ? [
          "",
          "## Last Shell Command",
          "",
          `- Command: \`${input.shellMutationPosture.lastCommandPreview.command}\``,
          `- Args: \`${JSON.stringify(input.shellMutationPosture.lastCommandPreview.args)}\``,
          `- CWD: \`${input.shellMutationPosture.lastCommandPreview.cwd}\``,
          `- Updated At: \`${input.shellMutationPosture.lastCommandPreview.updatedAt}\``,
          `- Output Preview: ${input.shellMutationPosture.lastCommandPreview.outputPreview ?? "none"}`,
        ]
      : []),
  ].join("\n")
}

function resolveOutcomeGateNextStepArtifact(input: {
  sessionId: string
  activeOutcome: SessionOutcomeDefinition | null
  outcomeEvaluation: SessionOutcomeEvaluation
}): {
  tool: string
  args: Record<string, unknown>
  rationale: string
} | null {
  if (!input.activeOutcome || input.outcomeEvaluation.promotionReady) {
    return null
  }
  if (
    input.outcomeEvaluation.trend === "stable" ||
    input.outcomeEvaluation.trend === "regressing"
  ) {
    return {
      tool: "outcome_history",
      args: { sessionId: input.sessionId },
      rationale:
        "Evaluator posture is no longer improving. Inspect recent outcome history before another shared mutation.",
    }
  }
  if (input.outcomeEvaluation.nextSuggestedTool) {
    return input.outcomeEvaluation.nextSuggestedTool
  }
  return {
    tool: "outcome_evaluate",
    args: { sessionId: input.sessionId },
    rationale:
      "Promotion is still unsafe. Re-check the evaluator verdict before attempting another shared mutation.",
  }
}

function buildDurableShellMutationPosture(input: {
  sessionId: string
  shellState: RuntimeMemorySnapshot["shellState"]
}) {
  const persistentShell = input.shellState?.persistentShell
    ? {
        ...input.shellState.persistentShell,
      }
    : null
  const recoveryPlan =
    persistentShell && persistentShell.status === "closed"
      ? {
          tool: "shell_restart",
          args: {
            cwd: input.shellState?.cwd ?? "/workspace",
          },
          rationale:
            "The durable shell state shows a closed persistent shell. Restart it before relying on shell-local continuity.",
        }
      : persistentShell === null
        ? {
            tool: "shell_open",
            args: {
              cwd: input.shellState?.cwd ?? "/workspace",
            },
            rationale:
              "No persistent shell is currently recorded for this session. Open one before multi-step shell work that should preserve cwd or exports.",
          }
        : null
  const lastCommandPreview = input.shellState?.lastCommand
    ? {
        command: input.shellState.lastCommand.command,
        args: input.shellState.lastCommand.args,
        cwd: input.shellState.lastCommand.cwd,
        updatedAt: input.shellState.lastCommand.updatedAt,
        outputPreview: input.shellState.lastCommand.outputPreview,
        stdoutPreview: input.shellState.lastCommand.stdoutPreview ?? null,
        stderrPreview: input.shellState.lastCommand.stderrPreview ?? null,
      }
    : null
  return {
    persistentShell,
    lastCommandPreview,
    recoveryPlan,
  }
}

function buildDurableShellReadFirstAlternatives(input: {
  shellState: RuntimeMemorySnapshot["shellState"]
  contextPressure: {
    level: "low" | "moderate" | "high"
    reasons: string[]
    recommendedTools: string[]
  } | null
}) {
  const cwd = input.shellState?.cwd ?? "/workspace"
  const alternatives: Array<{
    tool: string
    args: Record<string, unknown>
    rationale: string
  }> = [
    {
      tool: "shell_describe",
      args: {},
      rationale:
        "Inspect the durable session shell posture before widening into a writable shell mutation.",
    },
    {
      tool: "bash",
      args: {
        command: "pwd",
        cwd,
      },
      rationale:
        "Use the bounded read-only shell hand to confirm the current session working directory first.",
    },
  ]
  if (input.shellState?.lastCommand) {
    alternatives.push({
      tool: "shell_read_last_output",
      args: {},
      rationale:
        "Inspect the latest durable shell output before deciding whether another shell mutation is necessary.",
    })
  }
  if (input.contextPressure && input.contextPressure.level !== "low") {
    alternatives.push({
      tool: "session_describe_context",
      args: {},
      rationale:
        "Current context pressure is elevated. Inspect the context budget before widening the execution surface.",
    })
  }
  return alternatives
}

export function resolveSessionWorkspaceDir(
  companyDir: string,
  agentId: string,
  sessionId: string,
): string {
  return join(companyDir, ".openboa", "agents", agentId, "sessions", sessionId, "workspace")
}

export async function ensureSessionExecutionWorkspace(
  companyDir: string,
  agentId: string,
  sessionId: string,
  input?: {
    environmentId?: string
    resources?: ResourceAttachment[]
  },
): Promise<void> {
  const workspaceDir = resolveSessionWorkspaceDir(companyDir, agentId, sessionId)
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(join(workspaceDir, ".openboa-runtime"), { recursive: true })
  const readmePath = join(workspaceDir, "README.md")
  await writeFile(
    readmePath,
    [
      "# Session Workspace",
      "",
      `This is the writable execution hand for session \`${sessionId}\`.`,
      "",
      "- Use this workspace for mutable task files and intermediate artifacts.",
      "- Shared agent substrate is mounted separately at `/workspace/agent`.",
      "- Session runtime continuity is mounted at `/runtime`.",
      "- Agent-level learnings are mounted at `/memory/learnings`.",
    ].join("\n"),
    {
      encoding: "utf8",
      flag: "wx",
    },
  ).catch((error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error
    }
  })

  const resources = input?.resources ?? []
  const runtimeGuide = [
    "# OpenBOA Session Runtime",
    "",
    `- Session: \`${sessionId}\``,
    `- Agent: \`${agentId}\``,
    `- Environment: \`${input?.environmentId ?? "unknown"}\``,
    "",
    "## Mounted Resources",
    "",
    ...(resources.length > 0
      ? resources.map((resource) => {
          const scope = resourceScope(resource)
          const prompt = resourcePrompt(resource)
          return [
            `- ${resource.mountPath} kind=${resource.kind} access=${resource.access}${scope ? ` scope=${scope}` : ""}`,
            prompt ? `  prompt=${prompt}` : null,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n")
        })
      : ["- No mounted resources recorded."]),
    "",
    "## Execution Guidance",
    "",
    "- Treat `/workspace` as the writable session execution hand.",
    "- Treat `/workspace/agent` as shared read-only substrate.",
    "- Treat `/runtime` as session continuity state, not ordinary scratch space.",
    "- Treat `/workspace/.openboa-runtime` as a mirrored reread catalog inside the writable hand, not as the primary runtime mount.",
    "- Treat `/memory/learnings` and `/vaults/*` as protected read-only memory surfaces.",
    "- Stage shared substrate files into `/workspace` before editing them.",
  ].join("\n")
  await writeFile(
    join(workspaceDir, ".openboa-runtime", "session-runtime.md"),
    `${runtimeGuide}\n`,
    "utf8",
  )
  await writeFile(
    join(workspaceDir, ".openboa-runtime", "session-runtime.json"),
    `${JSON.stringify(
      {
        sessionId,
        agentId,
        environmentId: input?.environmentId ?? "unknown",
        resources: resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          mountPath: resource.mountPath,
          access: resource.access,
          scope: resourceScope(resource),
          prompt: resourcePrompt(resource),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

export async function writeSessionRuntimeCatalog(params: {
  companyDir: string
  agentId: string
  sessionId: string
  provider: string
  model: string
  resilience: AgentResilienceConfig
  environment: Environment
  resources: ResourceAttachment[]
  bootstrapEntries: WorkspaceBootstrapEntry[]
  bootstrapPrompt: string
  runtimeEnvironmentPrompt: string
  harnessAppendix: string
  skills: SkillEntry[]
  tools: ToolDefinition[]
}): Promise<{
  agentSetupFingerprint: string
}> {
  const runtimeDir = join(
    resolveSessionWorkspaceDir(params.companyDir, params.agentId, params.sessionId),
    ".openboa-runtime",
  )
  await mkdir(runtimeDir, { recursive: true })

  const alwaysAskTools = params.tools
    .filter((tool) => tool.permissionPolicy === "always_ask")
    .map((tool) => ({
      name: tool.name,
      effects: tool.effects,
      readOnly: tool.readOnly,
      destructive: tool.destructive,
    }))
  const toolCatalog = params.tools.map((tool) => ({
    name: tool.name,
    ownership: tool.ownership,
    permissionPolicy: tool.permissionPolicy,
    effects: tool.effects,
    readOnly: tool.readOnly,
    destructive: tool.destructive,
    interruptBehavior: tool.interruptBehavior,
  }))
  const vaultCatalog = params.resources
    .filter((resource) => resource.kind === "vault")
    .map((resource) => ({
      mountPath: resource.mountPath,
      access: resource.access,
      vaultName:
        typeof resource.metadata?.vaultName === "string" ? resource.metadata.vaultName : null,
      scope: resourceScope(resource),
      prompt: resourcePrompt(resource),
    }))
  const skillCatalog = params.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    preview: skill.preview,
    source: skill.source,
    filePath: skill.filePath,
  }))
  const setupPromptSections = [
    {
      name: "bootstrap",
      chars: params.bootstrapPrompt.length,
      fingerprint: computeFingerprint(params.bootstrapPrompt),
    },
    {
      name: "runtime_environment",
      chars: params.runtimeEnvironmentPrompt.length,
      fingerprint: computeFingerprint(params.runtimeEnvironmentPrompt),
    },
    {
      name: "harness_appendix",
      chars: params.harnessAppendix.length,
      fingerprint: computeFingerprint(params.harnessAppendix),
    },
  ]
  const bootstrapCatalog = params.bootstrapEntries.map((entry) => ({
    name: entry.name,
    filePath: join(resolveAgentWorkspaceDir(params.companyDir, params.agentId), entry.name),
    chars: entry.content.length,
    fingerprint: computeFingerprint(entry.content),
  }))
  const environmentCatalog = {
    id: params.environment.id,
    name: params.environment.name,
    kind: params.environment.kind,
    sandbox: params.environment.sandbox,
    workspaceMountDefaults: params.environment.workspaceMountDefaults,
  }
  const mountedResourceCatalog = params.resources.map((resource) => ({
    id: resource.id,
    kind: resource.kind,
    mountPath: resource.mountPath,
    access: resource.access,
    scope: resourceScope(resource),
    prompt: resourcePrompt(resource),
  }))
  const agentSetup = {
    fingerprint: "",
    sessionId: params.sessionId,
    agentId: params.agentId,
    provider: params.provider,
    model: params.model,
    resilience: {
      profile: params.resilience.profile,
      retry: params.resilience.retry,
      guarantees: [
        "resumable_pauses",
        "replay_safe_delayed_wakes",
        "resume_staged_drafts",
        "lease_backed_activation_recovery",
      ],
    },
    systemPrompt: {
      fingerprint: "",
      sections: setupPromptSections,
    },
    bootstrapFiles: {
      count: bootstrapCatalog.length,
      fingerprint: computeFingerprint(bootstrapCatalog),
      files: bootstrapCatalog,
    },
    tools: {
      count: toolCatalog.length,
      fingerprint: computeFingerprint(toolCatalog),
      tools: toolCatalog,
    },
    skills: {
      count: skillCatalog.length,
      fingerprint: computeFingerprint(skillCatalog),
      skills: skillCatalog,
    },
    environment: {
      fingerprint: computeFingerprint(environmentCatalog),
      ...environmentCatalog,
    },
    resourceContract: {
      fingerprint: computeFingerprint(mountedResourceCatalog),
      mountedResources: mountedResourceCatalog,
    },
    permissions: {
      alwaysAskTools,
      alwaysAllowTools: params.tools
        .filter((tool) => tool.permissionPolicy === "always_allow")
        .map((tool) => tool.name),
    },
    vaults: {
      count: vaultCatalog.length,
      fingerprint: computeFingerprint(vaultCatalog),
      vaults: vaultCatalog,
    },
  }
  agentSetup.systemPrompt.fingerprint = computeFingerprint(agentSetup.systemPrompt.sections)
  agentSetup.fingerprint = computeFingerprint({
    agentId: agentSetup.agentId,
    provider: agentSetup.provider,
    model: agentSetup.model,
    resilience: agentSetup.resilience,
    systemPromptFingerprint: agentSetup.systemPrompt.fingerprint,
    bootstrapFingerprint: agentSetup.bootstrapFiles.fingerprint,
    toolsFingerprint: agentSetup.tools.fingerprint,
    skillsFingerprint: agentSetup.skills.fingerprint,
    environmentFingerprint: agentSetup.environment.fingerprint,
    resourceContractFingerprint: agentSetup.resourceContract.fingerprint,
    vaultFingerprint: agentSetup.vaults.fingerprint,
    permissions: agentSetup.permissions,
  })
  const agentSetupMarkdown = [
    "# Agent Setup Contract",
    "",
    `- Agent: \`${params.agentId}\``,
    `- Session: \`${params.sessionId}\``,
    `- Provider: \`${params.provider}\``,
    `- Model: \`${params.model}\``,
    `- Resilience profile: \`${agentSetup.resilience.profile}\``,
    `- Fingerprint: \`${agentSetup.fingerprint}\``,
    `- System prompt fingerprint: \`${agentSetup.systemPrompt.fingerprint}\``,
    `- Environment fingerprint: \`${agentSetup.environment.fingerprint}\``,
    `- Resource contract fingerprint: \`${agentSetup.resourceContract.fingerprint}\``,
    "",
    "## Resilience",
    "",
    `- Recoverable wake retry delay: ${String(agentSetup.resilience.retry.recoverableWakeRetryDelayMs)}ms`,
    `- Wake failure replay delay: ${String(agentSetup.resilience.retry.wakeFailureReplayDelayMs)}ms`,
    `- Pending event backoff base: ${String(agentSetup.resilience.retry.pendingEventBackoffBaseMs)}ms`,
    `- Pending event backoff max: ${String(agentSetup.resilience.retry.pendingEventBackoffMaxMs)}ms`,
    ...agentSetup.resilience.guarantees.map((guarantee) => `- ${guarantee}`),
    "",
    "## Prompt Sections",
    "",
    ...agentSetup.systemPrompt.sections.map(
      (section) =>
        `- ${section.name}: chars=${String(section.chars)} fingerprint=\`${section.fingerprint}\``,
    ),
    "",
    "## Bootstrap Files",
    "",
    ...bootstrapCatalog.map(
      (entry) =>
        `- ${entry.name}: chars=${String(entry.chars)} fingerprint=\`${entry.fingerprint}\` path=\`${entry.filePath}\``,
    ),
    "",
    "## Tools",
    "",
    `- Count: ${String(toolCatalog.length)}`,
    `- Fingerprint: \`${agentSetup.tools.fingerprint}\``,
    ...toolCatalog
      .slice(0, 12)
      .map(
        (tool) =>
          `- ${tool.name}: ownership=${tool.ownership} permission=${tool.permissionPolicy} effects=${tool.effects.join(",") || "none"}`,
      ),
    "",
    "## Skills",
    "",
    `- Count: ${String(skillCatalog.length)}`,
    `- Fingerprint: \`${agentSetup.skills.fingerprint}\``,
    ...skillCatalog
      .slice(0, 12)
      .map((skill) => `- ${skill.name}: source=${skill.source} path=\`${skill.filePath}\``),
  ].join("\n")
  const permissionsMarkdown = [
    "# Permission Catalog",
    "",
    `- Agent: \`${params.agentId}\``,
    `- Session: \`${params.sessionId}\``,
    "",
    "## Always Ask",
    "",
    ...(alwaysAskTools.length > 0
      ? alwaysAskTools.map(
          (tool) =>
            `- ${tool.name}: effects=${tool.effects.join(",") || "none"} readOnly=${String(tool.readOnly)} destructive=${String(tool.destructive)}`,
        )
      : ["- none"]),
    "",
    "## Always Allow",
    "",
    ...(params.tools
      .filter((tool) => tool.permissionPolicy === "always_allow")
      .map((tool) => `- ${tool.name}`) || ["- none"]),
  ].join("\n")

  await Promise.all([
    writeFile(
      join(runtimeDir, "managed-tools.json"),
      `${JSON.stringify({ count: toolCatalog.length, tools: toolCatalog }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "permissions.json"),
      `${JSON.stringify(
        {
          alwaysAskTools,
          alwaysAllowTools: params.tools
            .filter((tool) => tool.permissionPolicy === "always_allow")
            .map((tool) => tool.name),
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(join(runtimeDir, "permissions.md"), `${permissionsMarkdown}\n`, "utf8"),
    writeFile(
      join(runtimeDir, "environment.json"),
      `${JSON.stringify(
        {
          id: params.environment.id,
          name: params.environment.name,
          kind: params.environment.kind,
          sandbox: params.environment.sandbox,
          workspaceMountDefaults: params.environment.workspaceMountDefaults,
          mountedResources: params.resources.map((resource) => ({
            id: resource.id,
            kind: resource.kind,
            mountPath: resource.mountPath,
            access: resource.access,
            scope: resourceScope(resource),
            prompt: resourcePrompt(resource),
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "skills.json"),
      `${JSON.stringify({ count: skillCatalog.length, skills: skillCatalog }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "vaults.json"),
      `${JSON.stringify({ count: vaultCatalog.length, vaults: vaultCatalog }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "agent-setup.json"),
      `${JSON.stringify(agentSetup, null, 2)}\n`,
      "utf8",
    ),
    writeFile(join(runtimeDir, "agent-setup.md"), `${agentSetupMarkdown}\n`, "utf8"),
  ])

  return {
    agentSetupFingerprint: agentSetup.fingerprint,
  }
}

export async function writeSessionContextBudgetArtifacts(params: {
  companyDir: string
  agentId: string
  sessionId: string
  contextBudget: ContextBudgetSnapshot
}): Promise<void> {
  const runtimeDir = join(
    resolveSessionWorkspaceDir(params.companyDir, params.agentId, params.sessionId),
    ".openboa-runtime",
  )
  await mkdir(runtimeDir, { recursive: true })
  await Promise.all([
    writeFile(
      join(runtimeDir, "context-budget.json"),
      `${JSON.stringify(
        {
          sessionId: params.sessionId,
          contextBudget: params.contextBudget,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "context-budget.md"),
      `${buildContextBudgetMarkdown({
        sessionId: params.sessionId,
        contextBudget: params.contextBudget,
      })}\n`,
      "utf8",
    ),
  ])
}

export async function writeSessionRuntimeStateArtifacts(params: {
  companyDir: string
  snapshot: SessionSnapshot
  runtimeMemory: RuntimeMemorySnapshot
  activeOutcome: SessionOutcomeDefinition | null
  outcomeGrade: SessionOutcomeGrade
  outcomeEvaluation: SessionOutcomeEvaluation
  outcomeEvaluationHistory: SessionOutcomeEvaluationRecord[]
  sessionRelations?: {
    parentSession: {
      sessionId: string
      status: string
      stopReason: string
      lastActivityAt: string | null
      latestSummary: string | null
      activeOutcomeTitle: string | null
      outcomeGradeStatus: string
    } | null
    children: Array<{
      sessionId: string
      status: string
      stopReason: string
      lastActivityAt: string | null
      latestSummary: string | null
      activeOutcomeTitle: string | null
      outcomeGradeStatus: string
    }>
  }
}): Promise<void> {
  const session = params.snapshot.session
  const runtimeDir = join(
    resolveSessionWorkspaceDir(params.companyDir, session.agentId, session.id),
    ".openboa-runtime",
  )
  await mkdir(runtimeDir, { recursive: true })
  const eventFeed = buildSessionEventFeed(params.snapshot.events)
  const traceFeed = summarizeSessionTraces(params.snapshot.events, 24)
  const nextOutcomeStep = resolveOutcomeGateNextStepArtifact({
    sessionId: session.id,
    activeOutcome: params.activeOutcome,
    outcomeEvaluation: params.outcomeEvaluation,
  })
  const shellMutationPosture = buildDurableShellMutationPosture({
    sessionId: session.id,
    shellState: params.runtimeMemory.shellState,
  })
  const readOnlyAlternative =
    session.pendingToolConfirmationRequest &&
    (session.pendingToolConfirmationRequest.toolName === "shell_run" ||
      session.pendingToolConfirmationRequest.toolName === "shell_exec") &&
    session.pendingToolConfirmationRequest.input &&
    typeof session.pendingToolConfirmationRequest.input === "object" &&
    !Array.isArray(session.pendingToolConfirmationRequest.input)
      ? buildReadOnlyBashAlternative({
          command:
            typeof session.pendingToolConfirmationRequest.input.command === "string"
              ? session.pendingToolConfirmationRequest.input.command
              : null,
          cwd:
            typeof session.pendingToolConfirmationRequest.input.cwd === "string"
              ? session.pendingToolConfirmationRequest.input.cwd
              : null,
          fallbackCwd: params.runtimeMemory.shellState?.cwd ?? "/workspace",
          timeoutMs: session.pendingToolConfirmationRequest.input.timeoutMs,
          maxOutputChars: session.pendingToolConfirmationRequest.input.maxOutputChars,
          rationale:
            "The pending shell confirmation is a bounded read-only command. Prefer the low-risk bash hand before re-entering a writable shell loop.",
        })
      : null
  const nextShellStep = readOnlyAlternative ?? shellMutationPosture.recoveryPlan
  let contextPressure: ReturnType<typeof summarizeContextPressure> = null
  try {
    const contextBudgetArtifact = JSON.parse(
      await readFile(join(runtimeDir, "context-budget.json"), "utf8"),
    ) as {
      sessionId: string
      contextBudget: ContextBudgetSnapshot | null
    }
    contextPressure = summarizeContextPressure(contextBudgetArtifact.contextBudget ?? null)
  } catch {
    contextPressure = null
  }
  const shellReadFirstAlternatives = buildDurableShellReadFirstAlternatives({
    shellState: params.runtimeMemory.shellState,
    contextPressure,
  })

  await Promise.all([
    writeFile(
      join(runtimeDir, "session-status.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          agentId: session.agentId,
          environmentId: session.environmentId,
          status: session.status,
          stopReason: session.stopReason,
          turns: session.usage.turns,
          pendingCustomToolRequest: session.pendingCustomToolRequest,
          pendingToolConfirmationRequest: session.pendingToolConfirmationRequest,
          parentSessionId: session.metadata?.parentSessionId ?? null,
          updatedAt: session.updatedAt,
          checkpoint: params.runtimeMemory.checkpoint
            ? {
                updatedAt: params.runtimeMemory.checkpoint.updatedAt,
                lastWakeId: params.runtimeMemory.checkpoint.lastWakeId,
                lastSummary: params.runtimeMemory.checkpoint.lastSummary,
                eventCursor: params.runtimeMemory.checkpoint.eventCursor,
                nextWakeAt: params.runtimeMemory.checkpoint.nextWakeAt,
                queuedWakes: params.runtimeMemory.checkpoint.queuedWakes,
              }
            : null,
          shellState: params.runtimeMemory.shellState,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          activeOutcome: params.activeOutcome,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-grade.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          activeOutcome: params.activeOutcome,
          grade: params.outcomeGrade,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-evaluation.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          activeOutcome: params.activeOutcome,
          evaluation: params.outcomeEvaluation,
          evaluationHistoryCount: params.outcomeEvaluationHistory.length,
          latestIteration: params.outcomeEvaluationHistory.at(-1)?.iteration ?? null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-evaluations.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          activeOutcome: params.activeOutcome,
          count: params.outcomeEvaluationHistory.length,
          evaluations: params.outcomeEvaluationHistory,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-grade.md"),
      `${buildOutcomeGradeMarkdown({
        sessionId: session.id,
        activeOutcome: params.activeOutcome,
        outcomeGrade: params.outcomeGrade,
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-evaluation.md"),
      `${buildOutcomeEvaluationMarkdown({
        sessionId: session.id,
        activeOutcome: params.activeOutcome,
        outcomeEvaluation: params.outcomeEvaluation,
        evaluationHistoryCount: params.outcomeEvaluationHistory.length,
        latestIteration: params.outcomeEvaluationHistory.at(-1)?.iteration ?? null,
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-evaluations.md"),
      `${buildOutcomeEvaluationHistoryMarkdown({
        sessionId: session.id,
        activeOutcome: params.activeOutcome,
        evaluations: params.outcomeEvaluationHistory,
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "outcome-repair.md"),
      `${buildOutcomeRepairMarkdown({
        sessionId: session.id,
        activeOutcome: params.activeOutcome,
        outcomeGrade: params.outcomeGrade,
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "permission-posture.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          pendingToolConfirmationRequest: session.pendingToolConfirmationRequest,
          activeOutcome: params.activeOutcome,
          outcomeEvaluation: params.outcomeEvaluation,
          nextOutcomeStep,
          nextShellStep,
          readOnlyAlternative,
          shellReadFirstAlternatives,
          contextPressure,
          shellMutationPosture,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "permission-posture.md"),
      `${buildPermissionPostureMarkdown({
        sessionId: session.id,
        pendingToolConfirmationRequest: session.pendingToolConfirmationRequest,
        activeOutcome: params.activeOutcome,
        outcomeEvaluation: params.outcomeEvaluation,
        nextOutcomeStep,
        nextShellStep,
        readOnlyAlternative,
        shellReadFirstAlternatives,
        contextPressure,
        shellState: params.runtimeMemory.shellState,
        shellMutationPosture,
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "event-feed.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          count: eventFeed.length,
          pendingCount: params.snapshot.events.filter((event) => event.processedAt === null).length,
          latestCreatedAt: eventFeed[0]?.createdAt ?? null,
          events: eventFeed,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "event-feed.md"),
      `${buildEventFeedMarkdown(session.id, eventFeed)}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "wake-traces.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          count: traceFeed.length,
          traces: traceFeed,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(
      join(runtimeDir, "session-relations.json"),
      `${JSON.stringify(
        {
          sessionId: session.id,
          parentSessionId: session.metadata?.parentSessionId ?? null,
          parentSession: params.sessionRelations?.parentSession ?? null,
          childCount: params.sessionRelations?.children.length ?? 0,
          children: params.sessionRelations?.children ?? [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ])
}

function summarizeEventPreview(event: SessionEvent): string | null {
  switch (event.type) {
    case "user.message":
      return event.message
    case "user.define_outcome":
      return event.outcome.title
    case "user.interrupt":
      return event.note ?? "interrupt"
    case "user.tool_confirmation":
      return `${event.toolName} allowed=${String(event.allowed)}`
    case "user.custom_tool_result":
      return `${event.toolName}: ${event.output}`
    case "session.child_created":
      return `${event.childSessionId}: ${event.outcomeTitle ?? event.message}`
    case "session.child_idle":
      return `${event.childSessionId}: ${event.summary}`
    case "session.status_changed":
      return `${event.fromStatus}->${event.toStatus}`
    case "session.status_idle":
      return event.summary
    case "span.started":
      return event.summary ?? `${event.spanKind}:${event.name}:started`
    case "span.completed":
      return event.summary ?? `${event.spanKind}:${event.name}:${event.result}`
    case "agent.message":
      return event.summary || event.message
    case "agent.tool_use":
      return event.output ?? event.toolName
    case "agent.custom_tool_use":
      return event.toolName
    default:
      return null
  }
}

function buildSessionEventFeed(events: SessionEvent[]) {
  return [...events]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 32)
    .map((event) => ({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      processedAt: event.processedAt,
      wakeId: event.wakeId ?? null,
      preview: summarizeEventPreview(event),
    }))
}

function buildEventFeedMarkdown(
  sessionId: string,
  events: Array<{
    id: string
    type: string
    createdAt: string
    processedAt: string | null
    wakeId: string | null
    preview: string | null
  }>,
): string {
  return [
    "# Session Event Feed",
    "",
    `- Session: \`${sessionId}\``,
    `- Events: ${String(events.length)}`,
    "",
    ...events.map((event) => {
      const parts = [
        `- \`${event.type}\` @ ${event.createdAt}`,
        event.wakeId ? `wake=${event.wakeId}` : null,
        event.processedAt ? "processed" : "pending",
        event.preview ? `preview=${event.preview}` : null,
      ].filter((part): part is string => Boolean(part))
      return parts.join(" ")
    }),
  ].join("\n")
}

async function discoverVaultAttachments(
  companyDir: string,
  sessionId: string,
): Promise<ResourceAttachment[]> {
  const vaultsDir = join(companyDir, ".openboa", "vaults")
  const entries = await readdir(vaultsDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => {
      const vaultName = slugifyVaultName(entry.name)
      return {
        id: `resource-vault-${vaultName}-${sessionId}`,
        kind: "vault" as const,
        sourceRef: join(vaultsDir, entry.name),
        mountPath: `/vaults/${vaultName}`,
        access: "read_only" as const,
        metadata: {
          scope: "vault",
          vaultName,
          prompt:
            "Read-only protected vault mount. Inspect only the exact files needed for the current task and avoid copying secret material into ordinary workspace artifacts.",
        },
      }
    })
}

export async function buildDefaultSessionResources(
  companyDir: string,
  agentId: string,
  sessionId: string,
): Promise<ResourceAttachment[]> {
  const agentWorkspaceDir = resolveAgentWorkspaceDir(companyDir, agentId)
  const sessionWorkspaceDir = resolveSessionWorkspaceDir(companyDir, agentId, sessionId)
  const agentRoot = join(companyDir, ".openboa", "agents", agentId)
  const vaultResources = await discoverVaultAttachments(companyDir, sessionId)

  return [
    {
      id: `resource-session-workspace-${sessionId}`,
      kind: "session_workspace",
      sourceRef: sessionWorkspaceDir,
      mountPath: "/workspace",
      access: "read_write",
      metadata: {
        scope: "session_execution_hand",
        prompt:
          "Primary writable execution hand for this session. Use for mutable work, staged edits, and intermediate artifacts.",
      },
    },
    {
      id: `resource-agent-workspace-${sessionId}`,
      kind: "agent_workspace_substrate",
      sourceRef: agentWorkspaceDir,
      mountPath: "/workspace/agent",
      access: "read_only",
      metadata: {
        scope: "agent_shared_substrate",
        prompt:
          "Shared durable agent substrate. Inspect freely, but edit through the explicit stage/compare/promote loop rather than direct sandbox writes.",
      },
    },
    {
      id: `resource-learnings-${sessionId}`,
      kind: "learnings_memory_store",
      sourceRef: join(agentRoot, "learn"),
      mountPath: "/memory/learnings",
      access: "read_only",
      metadata: {
        scope: "agent_shared_memory",
        prompt:
          "Shared durable agent memory. Search and read before starting work; update through managed memory tools and promoted learnings, not direct sandbox writes.",
      },
    },
    {
      id: `resource-runtime-${sessionId}`,
      kind: "session_runtime_memory",
      sourceRef: join(agentRoot, "sessions", sessionId, "runtime"),
      mountPath: "/runtime",
      access: "read_write",
      metadata: {
        scope: "session_runtime_memory",
        prompt:
          "Session continuity state. Inspect to resume bounded work and keep execution context stable across wakes.",
      },
    },
    ...vaultResources,
  ]
}
