import { createHash } from "node:crypto"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { CodexAuth } from "../src/agents/auth/codex-auth.js"
import type { ContextBudgetSnapshot } from "../src/agents/context/context-budget.js"
import { EnvironmentStore } from "../src/agents/environment/environment-store.js"
import { AgentLearningsStore } from "../src/agents/memory/learnings-store.js"
import { RuntimeMemoryStore } from "../src/agents/memory/runtime-memory-store.js"
import { CodexModelClient } from "../src/agents/providers/codex-model-client.js"
import { SubstrateArtifactVersionStore } from "../src/agents/resources/version-store.js"
import { AgentTurnRunner } from "../src/agents/runners/agent-runner.js"
import { PiRuntimeAdapter } from "../src/agents/runners/pi-adapter.js"
import { AgentHarness } from "../src/agents/runtime/harness.js"
import { AgentOrchestration } from "../src/agents/runtime/orchestration.js"
import { SessionWakeQueue } from "../src/agents/runtime/session-wake-queue.js"
import { runSessionLoop } from "../src/agents/runtime/wake-session.js"
import { LocalSandbox } from "../src/agents/sandbox/sandbox.js"
import type { Session, SessionEvent } from "../src/agents/schema/runtime.js"
import {
  SESSION_CONTEXT_CONVERSATION_EVENT_TYPES,
  SESSION_CONTEXT_RUNTIME_EVENT_TYPES,
} from "../src/agents/sessions/context-query-policy.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { buildManagedRuntimeTools } from "../src/agents/tools/managed-runtime-tools.js"
import { writeAgentWorkspaceManagedMemoryNotes } from "../src/agents/workspace/bootstrap-files.js"
import { isUuidV7 } from "../src/foundation/ids.js"
import {
  createAgentSkillFixture,
  createCompanyFixture,
  createOfflineCodexAgent,
} from "./helpers.js"

const NONE_AUTH: CodexAuth = {
  mode: "none",
  token: null,
}

const TEST_SKILL_NAME = "conversation-continuity"

function createContextBudgetFixture(input?: {
  selectionHeadroomTokens?: number
  droppedConversationCount?: number
  droppedRuntimeNoteCount?: number
}): ContextBudgetSnapshot {
  const selectionHeadroomTokens = input?.selectionHeadroomTokens ?? 2_048
  const droppedConversationCount = input?.droppedConversationCount ?? 0
  const droppedRuntimeNoteCount = input?.droppedRuntimeNoteCount ?? 0
  return {
    contextSelectionBudgetTokens: 8_000,
    estimatedSelectedTextTokens: 2_400,
    estimatedToolSchemaTokens: 400,
    estimatedTotalRuntimeTokens: 2_800,
    selectionHeadroomTokens,
    systemPrompt: {
      chars: 1_200,
      estimatedTokens: 300,
      sections: [
        {
          name: "bootstrap",
          chars: 900,
          estimatedTokens: 225,
        },
      ],
    },
    sessionMessage: {
      chars: 120,
      estimatedTokens: 30,
    },
    history: {
      totalCount: 12,
      selectedCount: 8,
      totalConversationCount: 8,
      conversationCount: 6,
      totalRuntimeNoteCount: 4,
      runtimeNoteCount: 2,
      droppedConversationCount,
      droppedRuntimeNoteCount,
      protectedConversationContinuityCount: 2,
      chars: 2_000,
      estimatedTokens: 500,
    },
    bootstrapFiles: {
      count: 1,
      totalChars: 200,
      totalTokens: 50,
      files: [
        {
          name: "AGENTS.md",
          rawChars: 200,
          rawTokens: 50,
          injectedChars: 220,
          injectedTokens: 55,
        },
      ],
    },
    skills: {
      count: 1,
      promptEntryCount: 1,
      promptChars: 80,
      promptTokens: 20,
      topEntries: [
        {
          name: "runtime-catalog-check",
          chars: 80,
          estimatedTokens: 20,
        },
      ],
    },
    tools: {
      count: 4,
      schemaChars: 400,
      schemaTokens: 100,
      topSchemas: [
        {
          name: "shell_describe",
          chars: 120,
          estimatedTokens: 30,
          permissionPolicy: "allow",
          readOnly: true,
        },
      ],
    },
  }
}

describe("session-first agent runtime", () => {
  it("creates an idle session with a valid environment reference and default resources", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)

    const session = await store.createSession({
      agentId: "alpha",
    })

    expect(isUuidV7(session.id)).toBe(true)
    expect(session.environmentId).toBe("local-default")
    expect(session.status).toBe("idle")
    expect(session.resources.map((resource) => resource.kind)).toEqual([
      "session_workspace",
      "agent_workspace_substrate",
      "learnings_memory_store",
      "session_runtime_memory",
    ])
    expect(session.resources.map((resource) => resource.mountPath)).toEqual([
      "/workspace",
      "/workspace/agent",
      "/memory/learnings",
      "/runtime",
    ])
  })

  it("materializes managed runtime catalogs into the session execution hand after one wake", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await createAgentSkillFixture({
      companyDir,
      name: "runtime-catalog-check",
      description: "Inspect runtime contract files before acting.",
      body: "Always inspect .openboa-runtime files before mutating the workspace.",
    })
    const vaultRoot = join(companyDir, ".openboa", "vaults", "prod")
    await mkdir(vaultRoot, { recursive: true })
    await writeFile(join(vaultRoot, "token.txt"), "sealed", "utf8")

    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    await store.emitEvent(session.id, {
      id: "event-runtime-catalog",
      type: "user.message",
      createdAt: "2026-04-10T09:00:00.000Z",
      processedAt: null,
      message: "Inspect the managed runtime contract.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Catalogs written.\n<openboa-session-loop>{"outcome":"sleep","summary":"Materialized runtime catalogs.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    await orchestration.wake(session.id)

    const runtimeDir = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      ".openboa-runtime",
    )
    const managedTools = JSON.parse(
      await readFile(join(runtimeDir, "managed-tools.json"), "utf8"),
    ) as { count: number; tools: Array<{ name: string; permissionPolicy: string }> }
    const permissions = JSON.parse(
      await readFile(join(runtimeDir, "permissions.json"), "utf8"),
    ) as {
      alwaysAskTools: Array<{ name: string }>
      alwaysAllowTools: string[]
    }
    const permissionPosture = JSON.parse(
      await readFile(join(runtimeDir, "permission-posture.json"), "utf8"),
    ) as {
      sessionId: string
      outcomeEvaluation: { status: string; trend: string; promotionReady: boolean }
      nextOutcomeStep: unknown
      nextShellStep: unknown
      readOnlyAlternative: unknown
      shellReadFirstAlternatives: Array<{ tool: string }>
      contextPressure: {
        level: string
        reasons: string[]
        recommendedTools: string[]
      } | null
      shellMutationPosture: { recoveryPlan: unknown }
    }
    const permissionPostureMarkdown = await readFile(
      join(runtimeDir, "permission-posture.md"),
      "utf8",
    )
    const environment = JSON.parse(
      await readFile(join(runtimeDir, "environment.json"), "utf8"),
    ) as {
      id: string
      mountedResources: Array<{ mountPath: string; kind: string; prompt: string | null }>
    }
    const agentSetup = JSON.parse(await readFile(join(runtimeDir, "agent-setup.json"), "utf8")) as {
      fingerprint: string
      provider: string
      model: string
      systemPrompt: {
        fingerprint: string
        sections: Array<{ name: string; fingerprint: string }>
      }
      bootstrapFiles: {
        count: number
        files: Array<{ name: string; filePath: string; fingerprint: string }>
      }
      tools: {
        count: number
        fingerprint: string
        tools: Array<{ name: string }>
      }
      skills: {
        count: number
        fingerprint: string
        skills: Array<{ name: string }>
      }
      environment: {
        fingerprint: string
        id: string
      }
      resourceContract: {
        fingerprint: string
        mountedResources: Array<{ mountPath: string }>
      }
    }
    const agentSetupMarkdown = await readFile(join(runtimeDir, "agent-setup.md"), "utf8")
    const skills = JSON.parse(await readFile(join(runtimeDir, "skills.json"), "utf8")) as {
      count: number
      skills: Array<{ name: string }>
    }
    const vaults = JSON.parse(await readFile(join(runtimeDir, "vaults.json"), "utf8")) as {
      count: number
      vaults: Array<{ mountPath: string; vaultName: string | null }>
    }
    const sessionStatus = JSON.parse(
      await readFile(join(runtimeDir, "session-status.json"), "utf8"),
    ) as {
      sessionId: string
      status: string
      stopReason: string
      checkpoint: { lastSummary: string | null } | null
    }
    const outcome = JSON.parse(await readFile(join(runtimeDir, "outcome.json"), "utf8")) as {
      sessionId: string
      activeOutcome: null
    }
    const outcomeGrade = JSON.parse(
      await readFile(join(runtimeDir, "outcome-grade.json"), "utf8"),
    ) as {
      sessionId: string
      activeOutcome: null
      grade: {
        status: string
        nextSuggestedTool: { tool: string } | null
      }
    }
    const outcomeEvaluation = JSON.parse(
      await readFile(join(runtimeDir, "outcome-evaluation.json"), "utf8"),
    ) as {
      sessionId: string
      activeOutcome: null
      evaluationHistoryCount: number
      latestIteration: number | null
      evaluation: {
        status: string
        promotionReady: boolean
      }
    }
    const outcomeEvaluations = JSON.parse(
      await readFile(join(runtimeDir, "outcome-evaluations.json"), "utf8"),
    ) as {
      sessionId: string
      count: number
      evaluations: Array<{ iteration: number }>
    }
    const outcomeGradeMarkdown = await readFile(join(runtimeDir, "outcome-grade.md"), "utf8")
    const outcomeEvaluationMarkdown = await readFile(
      join(runtimeDir, "outcome-evaluation.md"),
      "utf8",
    )
    const outcomeEvaluationsMarkdown = await readFile(
      join(runtimeDir, "outcome-evaluations.md"),
      "utf8",
    )
    const outcomeRepairMarkdown = await readFile(join(runtimeDir, "outcome-repair.md"), "utf8")
    const contextBudget = JSON.parse(
      await readFile(join(runtimeDir, "context-budget.json"), "utf8"),
    ) as {
      sessionId: string
      contextBudget: {
        contextSelectionBudgetTokens: number
        history: {
          totalCount: number
          droppedConversationCount: number
          droppedRuntimeNoteCount: number
        }
        systemPrompt: { sections: Array<{ name: string }> }
        tools: { count: number; topSchemas: Array<{ name: string }> }
        skills: { promptEntryCount: number }
      }
    }
    const contextBudgetMarkdown = await readFile(join(runtimeDir, "context-budget.md"), "utf8")
    const eventFeed = JSON.parse(await readFile(join(runtimeDir, "event-feed.json"), "utf8")) as {
      sessionId: string
      count: number
      pendingCount: number
      events: Array<{ type: string; preview: string | null }>
    }
    const eventFeedMarkdown = await readFile(join(runtimeDir, "event-feed.md"), "utf8")
    const wakeTraces = JSON.parse(await readFile(join(runtimeDir, "wake-traces.json"), "utf8")) as {
      sessionId: string
      count: number
      traces: Array<{ wakeId: string; latestSummary: string | null }>
    }
    const environmentStore = new EnvironmentStore(companyDir)
    const defaultEnvironment = await environmentStore.getEnvironment(session.environmentId)
    if (!defaultEnvironment) {
      throw new Error("missing default environment for session_describe_context")
    }
    const describeContextTools = await buildManagedRuntimeTools({
      companyDir,
      environment: defaultEnvironment,
      session,
      wakeId: "manual-context-artifact-read",
      pendingEvents: [],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const describeContextTool = describeContextTools.find(
      (tool) => tool.name === "session_describe_context",
    )
    if (!describeContextTool) {
      throw new Error("session_describe_context tool missing")
    }
    const describeContextFromArtifact = JSON.parse(
      await describeContextTool.execute({ sessionId: session.id }),
    ) as {
      sessionId: string
      available: boolean
      contextBudget: {
        contextSelectionBudgetTokens: number
      } | null
      pressure: {
        level: string
        reasons: string[]
        recommendedTools: string[]
      } | null
    }

    expect(managedTools.count).toBeGreaterThan(0)
    expect(managedTools.tools.some((tool) => tool.name === "environment_describe")).toBe(true)
    expect(managedTools.tools.some((tool) => tool.name === "shell_run")).toBe(true)
    expect(managedTools.tools.some((tool) => tool.name === "resources_promote_to_substrate")).toBe(
      true,
    )
    expect(permissions.alwaysAskTools.some((tool) => tool.name === "shell_run")).toBe(true)
    expect(
      permissions.alwaysAskTools.some((tool) => tool.name === "resources_promote_to_substrate"),
    ).toBe(true)
    expect(permissions.alwaysAllowTools).toContain("environment_describe")
    expect(permissionPosture.sessionId).toBe(session.id)
    expect(permissionPosture.contextPressure).not.toBeNull()
    expect(permissionPosture.outcomeEvaluation.status).toBe("missing_outcome")
    expect(permissionPosture.outcomeEvaluation.promotionReady).toBe(false)
    expect(permissionPosture.nextOutcomeStep).toBeNull()
    expect(permissionPosture.nextShellStep).toBeTruthy()
    expect(permissionPosture.readOnlyAlternative).toBeNull()
    expect(
      permissionPosture.shellReadFirstAlternatives.some((entry) => entry.tool === "shell_describe"),
    ).toBe(true)
    expect(
      permissionPosture.shellReadFirstAlternatives.some((entry) => entry.tool === "bash"),
    ).toBe(true)
    expect(permissionPosture.shellMutationPosture.recoveryPlan).toBeTruthy()
    expect(permissionPostureMarkdown).toContain("# Permission Posture")
    expect(permissionPostureMarkdown).toContain("Context pressure")
    expect(permissionPostureMarkdown).toContain("Next shell step")
    expect(permissionPostureMarkdown).toContain("Shell Read-First Alternatives")
    expect(permissionPostureMarkdown).toContain("Shell recovery step")
    expect(environment.id).toBe("local-default")
    expect(agentSetup.provider).toBe("openai-codex")
    expect(agentSetup.model).toBe("gpt-5.4")
    expect(agentSetup.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(agentSetup.systemPrompt.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(agentSetup.systemPrompt.sections.some((section) => section.name === "bootstrap")).toBe(
      true,
    )
    expect(agentSetup.bootstrapFiles.count).toBeGreaterThan(0)
    expect(
      agentSetup.bootstrapFiles.files.some(
        (entry) => entry.name === "AGENTS.md" && entry.filePath.endsWith("/AGENTS.md"),
      ),
    ).toBe(true)
    expect(agentSetup.tools.count).toBeGreaterThan(0)
    expect(agentSetup.tools.tools.some((tool) => tool.name === "environment_describe")).toBe(true)
    expect(agentSetup.skills.count).toBeGreaterThan(0)
    expect(agentSetup.skills.skills.some((skill) => skill.name === "runtime-catalog-check")).toBe(
      true,
    )
    expect(agentSetup.environment.id).toBe("local-default")
    expect(agentSetup.environment.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(agentSetup.resourceContract.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(
      agentSetup.resourceContract.mountedResources.some(
        (resource) => resource.mountPath === "/workspace",
      ),
    ).toBe(true)
    expect(
      environment.mountedResources.some((resource) => resource.mountPath === "/workspace"),
    ).toBe(true)
    expect(
      environment.mountedResources.find((resource) => resource.mountPath === "/workspace")?.prompt,
    ).toContain("Primary writable execution hand")
    expect(
      environment.mountedResources.some((resource) => resource.mountPath === "/vaults/prod"),
    ).toBe(true)
    expect(
      environment.mountedResources.find((resource) => resource.mountPath === "/vaults/prod")
        ?.prompt,
    ).toContain("Read-only protected vault mount")
    expect(skills.count).toBeGreaterThan(0)
    expect(skills.skills.some((skill) => skill.name === "runtime-catalog-check")).toBe(true)
    expect(vaults.count).toBe(1)
    expect(vaults.vaults[0]).toMatchObject({
      mountPath: "/vaults/prod",
      vaultName: "prod",
    })
    expect(sessionStatus).toMatchObject({
      sessionId: session.id,
      status: "idle",
      stopReason: "idle",
      checkpoint: {
        lastSummary: "Materialized runtime catalogs.",
      },
    })
    expect(outcome).toEqual({
      sessionId: session.id,
      activeOutcome: null,
    })
    expect(outcomeGrade.sessionId).toBe(session.id)
    expect(outcomeGrade.activeOutcome).toBeNull()
    expect(outcomeGrade.grade.status).toBe("missing_outcome")
    expect(outcomeGrade.grade.nextSuggestedTool?.tool).toBe("outcome_define")
    expect(outcomeEvaluation.sessionId).toBe(session.id)
    expect(outcomeEvaluation.activeOutcome).toBeNull()
    expect(outcomeEvaluation.evaluation.status).toBe("missing_outcome")
    expect(outcomeEvaluation.evaluation.promotionReady).toBe(false)
    expect(outcomeEvaluation.evaluation.trend).toBe("first_iteration")
    expect(outcomeEvaluation.evaluationHistoryCount).toBe(0)
    expect(outcomeEvaluation.latestIteration).toBeNull()
    expect(outcomeEvaluations.sessionId).toBe(session.id)
    expect(outcomeEvaluations.count).toBe(0)
    expect(outcomeEvaluations.evaluations).toEqual([])
    expect(outcomeGradeMarkdown).toContain("# Outcome Grade")
    expect(outcomeGradeMarkdown).toContain("Status: `missing_outcome`")
    expect(outcomeEvaluationMarkdown).toContain("# Outcome Evaluation")
    expect(outcomeEvaluationMarkdown).toContain("Promotion ready: `false`")
    expect(outcomeEvaluationsMarkdown).toContain("# Outcome Evaluations")
    expect(outcomeEvaluationsMarkdown).toContain("No durable outcome evaluations recorded yet.")
    expect(outcomeRepairMarkdown).toContain("# Outcome Repair")
    expect(outcomeRepairMarkdown).toContain("Recommended next tool: `outcome_define`")
    expect(contextBudget.sessionId).toBe(session.id)
    expect(contextBudget.contextBudget.contextSelectionBudgetTokens).toBeGreaterThan(0)
    expect(contextBudget.contextBudget.history.totalCount).toBeGreaterThan(0)
    expect(contextBudget.contextBudget.history.droppedConversationCount).toBeGreaterThanOrEqual(0)
    expect(contextBudget.contextBudget.history.droppedRuntimeNoteCount).toBeGreaterThanOrEqual(0)
    expect(
      contextBudget.contextBudget.systemPrompt.sections.some(
        (section) => section.name === "bootstrap",
      ),
    ).toBe(true)
    expect(contextBudget.contextBudget.tools.count).toBeGreaterThan(0)
    expect(contextBudget.contextBudget.tools.topSchemas.length).toBeGreaterThan(0)
    expect(contextBudget.contextBudget.skills.promptEntryCount).toBeGreaterThan(0)
    expect(contextBudgetMarkdown).toContain("# Context Budget")
    expect(contextBudgetMarkdown).toContain("## Tool Schemas")
    expect(contextBudgetMarkdown).toContain("Dropped runtime notes")
    expect(agentSetupMarkdown).toContain("# Agent Setup Contract")
    expect(agentSetupMarkdown).toContain("Provider: `openai-codex`")
    expect(agentSetupMarkdown).toContain("Model: `gpt-5.4`")
    expect(agentSetupMarkdown).toContain("## Prompt Sections")
    expect(agentSetupMarkdown).toContain("## Bootstrap Files")
    expect(describeContextFromArtifact.sessionId).toBe(session.id)
    expect(describeContextFromArtifact.available).toBe(true)
    expect(describeContextFromArtifact.contextBudget?.contextSelectionBudgetTokens).toBeGreaterThan(
      0,
    )
    expect(describeContextFromArtifact.pressure).not.toBeNull()
    expect(Array.isArray(describeContextFromArtifact.pressure?.recommendedTools)).toBe(true)
    expect(eventFeed.sessionId).toBe(session.id)
    expect(eventFeed.count).toBeGreaterThan(0)
    expect(eventFeed.pendingCount).toBe(0)
    expect(eventFeed.events.some((event) => event.type === "user.message")).toBe(true)
    expect(eventFeed.events.some((event) => event.type === "agent.message")).toBe(true)
    expect(eventFeedMarkdown).toContain("# Session Event Feed")
    expect(eventFeedMarkdown).toContain("`agent.message`")
    expect(wakeTraces.sessionId).toBe(session.id)
    expect(wakeTraces.count).toBeGreaterThan(0)
    expect(wakeTraces.traces[0]?.latestSummary).toBe("Materialized runtime catalogs.")

    const runtimeGuideJson = await readFile(join(runtimeDir, "session-runtime.json"), "utf8")
    expect(runtimeGuideJson).toContain(
      '"prompt": "Primary writable execution hand for this session.',
    )
    expect(runtimeGuideJson).toContain('"prompt": "Shared durable agent substrate.')
  })

  it("records durable outcome evaluation history across repeated wakes", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-outcome-history-1",
      type: "user.define_outcome",
      createdAt: "2026-04-10T09:10:00.000Z",
      processedAt: null,
      outcome: {
        title: "Verify evaluator history iterations",
        detail: "The session should keep a bounded record of recent evaluator verdicts.",
        successCriteria: ["History exists", "Iteration increases after another wake"],
      },
    })
    await store.emitEvent(session.id, {
      id: "event-outcome-history-2",
      type: "user.message",
      createdAt: "2026-04-10T09:10:01.000Z",
      processedAt: null,
      message: "Start the first bounded run.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'First evaluator pass.\n<openboa-session-loop>{"outcome":"sleep","summary":"Recorded one evaluator verdict.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    await orchestration.wake(session.id)
    await store.emitEvent(session.id, {
      id: "event-outcome-history-3",
      type: "user.message",
      createdAt: "2026-04-10T09:15:00.000Z",
      processedAt: null,
      message: "Run the second bounded pass.",
    })
    await orchestration.wake(session.id)

    const runtimeMemory = await memoryStore.read("alpha", session.id)
    const history = runtimeMemory.checkpoint?.outcomeEvaluationHistory ?? []
    expect(history).toHaveLength(2)
    expect(history[0]?.iteration).toBe(0)
    expect(history[1]?.iteration).toBe(1)
    expect(history[0]?.outcomeTitle).toBe("Verify evaluator history iterations")
    expect(history[1]?.outcomeTitle).toBe("Verify evaluator history iterations")

    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing default environment for evaluator history test")
    }
    const latestSession = (await store.getSession(session.id)).session
    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: latestSession,
      wakeId: "manual-outcome-history-check",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const outcomeEvaluateTool = tools.find((tool) => tool.name === "outcome_evaluate")
    const outcomeHistoryTool = tools.find((tool) => tool.name === "outcome_history")
    const permissionsDescribeTool = tools.find((tool) => tool.name === "permissions_describe")
    const permissionsCheckTool = tools.find((tool) => tool.name === "permissions_check")
    const sessionListTool = tools.find((tool) => tool.name === "session_list")
    if (
      !outcomeEvaluateTool ||
      !outcomeHistoryTool ||
      !permissionsDescribeTool ||
      !permissionsCheckTool ||
      !sessionListTool
    ) {
      throw new Error("missing outcome history managed tools")
    }
    const outcomeEvaluateText = await outcomeEvaluateTool.execute({})
    const outcomeHistoryText = await outcomeHistoryTool.execute({})
    const permissionsDescribeText = await permissionsDescribeTool.execute({})
    const promotePreflightText = await permissionsCheckTool.execute({
      toolName: "resources_promote_to_substrate",
    })
    const stableSessionListText = await sessionListTool.execute({
      includeCurrent: true,
      limit: 5,
      outcomeTrend: "stable",
    })
    expect(outcomeEvaluateText).toContain('"evaluationHistory": [')
    expect(outcomeEvaluateText).toContain('"trend": "stable"')
    expect(outcomeHistoryText).toContain('"count": 2')
    expect(outcomeHistoryText).toContain('"iteration": 1')
    expect(permissionsDescribeText).toContain('"nextOutcomeStep": null')
    expect(promotePreflightText).toContain('"trend": "stable"')
    expect(promotePreflightText).toContain('"tool": "permissions_describe"')
    expect(stableSessionListText).toContain(`"sessionId": "${session.id}"`)
    expect(stableSessionListText).toContain('"outcomeTrend": "stable"')
  })

  it("processes pending events exactly once and safely no-ops when nothing is pending", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-user-1",
      type: "user.message",
      createdAt: "2026-04-09T09:00:00.000Z",
      processedAt: null,
      message: "What should happen next?",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Handled.\n<openboa-session-loop>{"outcome":"sleep","summary":"Handled the user request.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const firstWake = await orchestration.wake(session.id)
    expect(firstWake.executed).toBe(true)
    expect(firstWake.response).toContain("Handled.")
    expect(firstWake.stopReason).toBe("idle")

    const snapshot = await store.getSession(session.id)
    expect(snapshot.events.some((event) => event.type === "agent.message")).toBe(true)
    expect(snapshot.events.filter((event) => event.processedAt === null)).toHaveLength(0)

    const secondWake = await orchestration.wake(session.id)
    expect(secondWake.executed).toBe(false)
    expect(secondWake.stopReason).toBe("idle")
  })

  it("records an error-completed wake span and restores the session to idle when the runner throws", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-user-error",
      type: "user.message",
      createdAt: "2026-04-09T09:01:00.000Z",
      processedAt: null,
      message: "Trigger a runner failure.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw new Error("runner exploded")
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const wake = await orchestration.wake(session.id)
    expect(wake.executed).toBe(true)
    expect(wake.response).toBe("Wake failed: runner exploded")
    expect(wake.stopReason).toBe("idle")
    expect(wake.processedEventIds).toEqual([])

    const snapshot = await store.getSession(session.id)
    expect(snapshot.session.status).toBe("idle")
    expect(snapshot.session.stopReason).toBe("idle")
    expect(snapshot.events.find((event) => event.id === "event-user-error")?.processedAt).toBeNull()

    const errorSpan = [...snapshot.events]
      .reverse()
      .find(
        (event): event is Extract<SessionEvent, { type: "span.completed" }> =>
          event.type === "span.completed" && event.spanKind === "wake" && event.result === "error",
      )
    expect(errorSpan?.summary).toContain("runner exploded")

    const idleEvent = [...snapshot.events]
      .reverse()
      .find(
        (event): event is Extract<SessionEvent, { type: "session.status_idle" }> =>
          event.type === "session.status_idle",
      )
    expect(idleEvent?.summary).toContain("Wake failed: runner exploded")

    const checkpoint = JSON.parse(
      await readFile(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          session.id,
          "runtime",
          "checkpoint.json",
        ),
        "utf8",
      ),
    ) as {
      lastSummary: string
      lastOutcome: string
      stopReason: string
      lastEventIds: string[]
    }
    expect(checkpoint.lastSummary).toBe("Wake failed: runner exploded")
    expect(checkpoint.lastOutcome).toBe("sleep")
    expect(checkpoint.stopReason).toBe("idle")
    expect(checkpoint.lastEventIds).toEqual([])
  })

  it("defers retryable provider failures when pending events are still waiting", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-user-timeout",
      type: "user.message",
      createdAt: "2026-04-09T09:01:00.000Z",
      processedAt: null,
      message: "Trigger a retryable timeout.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          throw Object.assign(new Error("model call timed out"), {
            code: "model_timeout",
          })
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const wake = await orchestration.wake(session.id)
    expect(wake.executed).toBe(true)
    expect(wake.response).toBe(
      "Wake deferred after transient provider failure: model call timed out",
    )
    expect(wake.stopReason).toBe("rescheduling")
    expect(wake.queuedWakeIds).toEqual([])
    expect(wake.processedEventIds).toEqual([])

    const snapshot = await store.getSession(session.id)
    expect(snapshot.session.status).toBe("rescheduling")
    expect(snapshot.session.stopReason).toBe("rescheduling")
    expect(
      snapshot.events.find((event) => event.id === "event-user-timeout")?.processedAt,
    ).toBeNull()

    const statusChangedEvent = [...snapshot.events]
      .reverse()
      .find(
        (event): event is Extract<SessionEvent, { type: "session.status_changed" }> =>
          event.type === "session.status_changed" &&
          event.wakeId === wake.wakeId &&
          event.toStatus === "rescheduling",
      )
    expect(statusChangedEvent?.reason).toBe("rescheduling")

    const runnableSessions = await store.listRunnableSessions("alpha")
    expect(runnableSessions).toHaveLength(1)
    expect(runnableSessions[0]?.sessionId).toBe(session.id)
    expect(runnableSessions[0]?.pendingEventType).toBe("user.message")
    expect(typeof runnableSessions[0]?.deferUntil).toBe("string")

    const checkpoint = JSON.parse(
      await readFile(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          session.id,
          "runtime",
          "checkpoint.json",
        ),
        "utf8",
      ),
    ) as {
      lastSummary: string
      lastOutcome: string
      stopReason: string
      nextWakeAt: string | null
      queuedWakes: Array<{ reason: string }>
    }
    expect(checkpoint.lastSummary).toBe(
      "Wake deferred after transient provider failure: model call timed out",
    )
    expect(checkpoint.lastOutcome).toBe("continue")
    expect(checkpoint.stopReason).toBe("rescheduling")
    expect(typeof checkpoint.nextWakeAt).toBe("string")
    expect(checkpoint.queuedWakes).toEqual([])
  })

  it("writes explicit event cursor state into the runtime checkpoint", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-history",
      type: "agent.message",
      createdAt: "2026-04-09T09:05:00.000Z",
      processedAt: "2026-04-09T09:05:00.000Z",
      message: "Earlier summary",
      summary: "Earlier summary",
    })
    await store.emitEvent(session.id, {
      id: "event-pending",
      type: "user.message",
      createdAt: "2026-04-09T09:06:00.000Z",
      processedAt: null,
      message: "Handle the next thing.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Cursor written.\n<openboa-session-loop>{"outcome":"sleep","summary":"Persisted event cursor state.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    await orchestration.wake(session.id)

    const checkpoint = JSON.parse(
      await readFile(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          session.id,
          "runtime",
          "checkpoint.json",
        ),
        "utf8",
      ),
    ) as {
      version: number
      lastWakeId: string | null
      eventCursor: {
        lastContextEventId: string | null
        lastProcessedEventId: string | null
        lastProducedEventId: string | null
      }
    }

    const snapshot = await store.getSession(session.id)
    const producedEvent = snapshot.events.find(
      (event) => event.type === "agent.message" && event.id !== "event-history",
    )

    expect(checkpoint.version).toBe(6)
    expect(typeof checkpoint.lastWakeId).toBe("string")
    expect(
      (checkpoint as { lastAgentSetupFingerprint?: string | null }).lastAgentSetupFingerprint,
    ).toMatch(/^[a-f0-9]{64}$/u)
    expect(checkpoint.eventCursor.lastContextEventId).toBe("event-history")
    expect(checkpoint.eventCursor.lastProcessedEventId).toBe("event-pending")
    expect(checkpoint.eventCursor.lastProducedEventId).toBe(producedEvent?.id ?? null)
    expect(producedEvent?.wakeId).toBe(checkpoint.lastWakeId)
  })

  it("can reread one bounded wake trace through session_get_trace", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-user-trace",
      type: "user.message",
      createdAt: "2026-04-09T09:06:00.000Z",
      processedAt: null,
      message: "Run one bounded trace.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Trace written.\n<openboa-session-loop>{"outcome":"sleep","summary":"Produced one bounded trace.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    await orchestration.wake(session.id)

    const runtimeMemory = await new RuntimeMemoryStore(companyDir).read("alpha", session.id)
    const wakeId = runtimeMemory.checkpoint?.lastWakeId
    expect(typeof wakeId).toBe("string")

    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment || !wakeId) {
      throw new Error("missing environment or wakeId")
    }

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-trace-read",
      pendingEvents: [],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const getTraceTool = tools.find((tool) => tool.name === "session_get_trace")
    expect(getTraceTool).toBeDefined()
    if (!getTraceTool) {
      throw new Error("session_get_trace tool missing")
    }

    const traceText = await getTraceTool.execute({
      wakeId,
      types: [
        "session.status_changed",
        "span.started",
        "span.completed",
        "agent.message",
        "session.status_idle",
      ],
    })
    expect(traceText).toContain(`"wakeId": "${wakeId}"`)
    expect(traceText).toContain('"type": "session.status_changed"')
    expect(traceText).toContain('"type": "span.started"')
    expect(traceText).toContain('"type": "span.completed"')
    expect(traceText).toContain('"type": "agent.message"')
    expect(traceText).toContain('"type": "session.status_idle"')
  })

  it("surfaces the active outcome in the harness message and persists it into the runtime checkpoint", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-outcome-1",
      type: "user.define_outcome",
      createdAt: "2026-04-09T09:05:00.000Z",
      processedAt: null,
      outcome: {
        title: "Close the managed-agent outcome loop",
        detail: "Leave behind a durable goal that future turns can read.",
        successCriteria: [
          "harness message includes the active outcome",
          "checkpoint persists the outcome",
        ],
      },
    })
    await store.emitEvent(session.id, {
      id: "event-pending-outcome-followup",
      type: "user.message",
      createdAt: "2026-04-09T09:06:00.000Z",
      processedAt: null,
      message: "Continue working toward the stated outcome.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("<active-outcome>")
          expect(input.message).toContain("Close the managed-agent outcome loop")
          expect(input.message).toContain("checkpoint persists the outcome")
          return {
            response:
              'Outcome handled.\n<openboa-session-loop>{"outcome":"sleep","summary":"Persisted the active outcome into runtime memory.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    await orchestration.wake(session.id)

    const checkpoint = JSON.parse(
      await readFile(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          session.id,
          "runtime",
          "checkpoint.json",
        ),
        "utf8",
      ),
    ) as {
      activeOutcome: {
        title: string
        detail: string | null
        successCriteria: string[]
      } | null
    }

    expect(checkpoint.activeOutcome).toEqual({
      title: "Close the managed-agent outcome loop",
      detail: "Leave behind a durable goal that future turns can read.",
      successCriteria: [
        "harness message includes the active outcome",
        "checkpoint persists the outcome",
      ],
    })
  })

  it("keeps session runtime state isolated while sharing agent-level learnings", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const firstSession = await store.createSession({ agentId: "alpha" })
    const secondSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(firstSession.id, {
      id: "event-user-first",
      type: "user.message",
      createdAt: "2026-04-09T09:10:00.000Z",
      processedAt: null,
      message: "Capture one durable lesson.",
    })
    await store.emitEvent(secondSession.id, {
      id: "event-user-second",
      type: "user.message",
      createdAt: "2026-04-09T09:11:00.000Z",
      processedAt: null,
      message: "Just answer and stop.",
    })

    const responses = [
      'Learned.\n<openboa-session-loop>{"outcome":"sleep","summary":"Captured one reusable lesson.","followUpSeconds":null,"learnings":[{"kind":"lesson","title":"Session-first wins","detail":"Keep session state durable and provider brains swappable.","promoteToMemory":true,"dedupeKey":"session-first-wins"}]}</openboa-session-loop>',
      'Done.\n<openboa-session-loop>{"outcome":"sleep","summary":"Answered and stopped.","followUpSeconds":null}</openboa-session-loop>',
    ]
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          const response = responses.shift()
          if (!response) {
            throw new Error("no more mocked responses")
          }
          return {
            response,
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    await orchestration.wake(firstSession.id)
    await orchestration.wake(secondSession.id)

    const learningsStore = new AgentLearningsStore(companyDir)
    const learnings = await learningsStore.list("alpha")
    expect(learnings).toHaveLength(1)
    expect(learnings[0]?.learning.title).toBe("Session-first wins")

    const memory = await learningsStore.readWorkspaceMemory("alpha")
    expect(memory).toContain("Session-first wins")

    await expect(
      access(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          firstSession.id,
          "runtime",
          "checkpoint.json",
        ),
      ),
    ).resolves.toBeUndefined()
    await expect(
      access(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          secondSession.id,
          "runtime",
          "checkpoint.json",
        ),
      ),
    ).resolves.toBeUndefined()

    const firstRuntime = JSON.parse(
      await readFile(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          firstSession.id,
          "runtime",
          "checkpoint.json",
        ),
        "utf8",
      ),
    ) as { sessionId: string }
    const secondRuntime = JSON.parse(
      await readFile(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          secondSession.id,
          "runtime",
          "checkpoint.json",
        ),
        "utf8",
      ),
    ) as { sessionId: string }
    expect(firstRuntime.sessionId).toBe(firstSession.id)
    expect(secondRuntime.sessionId).toBe(secondSession.id)
  })

  it("pauses on custom tool requests and resumes only after a matching result event", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-user-custom",
      type: "user.message",
      createdAt: "2026-04-09T09:20:00.000Z",
      processedAt: null,
      message: "Use the custom tool if needed.",
    })

    const responses = [
      '<openboa-session-loop>{"outcome":"sleep","summary":"Need a custom result before continuing.","followUpSeconds":null,"customToolRequest":{"name":"fetch_spec","input":{"path":"spec.md"}}}</openboa-session-loop>',
      'Thanks.\n<openboa-session-loop>{"outcome":"sleep","summary":"Custom result processed.","followUpSeconds":null}</openboa-session-loop>',
    ]
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          const response = responses.shift()
          if (!response) {
            throw new Error("no more mocked responses")
          }
          return {
            response,
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const firstWake = await orchestration.wake(session.id)
    expect(firstWake.executed).toBe(true)

    const waiting = await store.getSession(session.id)
    expect(waiting.session.stopReason).toBe("requires_action")
    expect(waiting.session.pendingCustomToolRequest?.name).toBe("fetch_spec")

    const noOpWake = await orchestration.wake(session.id)
    expect(noOpWake.executed).toBe(false)

    await store.emitEvent(session.id, {
      id: "event-custom-result",
      type: "user.custom_tool_result",
      createdAt: "2026-04-09T09:21:00.000Z",
      processedAt: null,
      requestId: String(waiting.session.pendingCustomToolRequest?.id),
      toolName: "fetch_spec",
      output: "spec content",
    })

    const secondWake = await orchestration.wake(session.id)
    expect(secondWake.executed).toBe(true)

    const resumed = await store.getSession(session.id)
    expect(resumed.session.stopReason).toBe("idle")
    expect(resumed.session.pendingCustomToolRequest).toBeNull()
  })

  it("pauses on managed tool confirmation requests and resumes after a matching confirmation event", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({
      agentId: "alpha",
    })

    await store.emitEvent(session.id, {
      id: "event-user-promote",
      type: "user.message",
      createdAt: "2026-04-09T09:22:00.000Z",
      processedAt: null,
      message: "Promote the staged draft into shared substrate.",
    })

    let runCount = 0
    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          runCount += 1
          if (runCount === 1) {
            return {
              response: null,
              authMode: "none",
              provider: "openai-codex",
              model: "gpt-5.4",
              runner: "embedded",
              interruption: {
                kind: "tool_confirmation_required",
                request: {
                  id: "confirm-promote-1",
                  toolName: "resources_promote_to_substrate",
                  ownership: "managed",
                  permissionPolicy: "always_ask",
                  input: {
                    sourcePath: "drafts/plan.md",
                  },
                  requestedAt: "2026-04-09T09:22:00.000Z",
                },
              },
            }
          }
          return {
            response:
              'Confirmed.\n<openboa-session-loop>{"outcome":"sleep","summary":"Promotion approved and acknowledged.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
            interruption: null,
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const firstWake = await orchestration.wake(session.id)
    expect(firstWake.executed).toBe(true)
    expect(firstWake.stopReason).toBe("requires_action")

    const waiting = await store.getSession(session.id)
    expect(waiting.session.pendingToolConfirmationRequest?.toolName).toBe(
      "resources_promote_to_substrate",
    )

    const blockingIdleEvent = [...waiting.events]
      .reverse()
      .find(
        (event): event is Extract<SessionEvent, { type: "session.status_idle" }> =>
          event.type === "session.status_idle",
      )
    expect(blockingIdleEvent?.blockingEventIds).toHaveLength(1)

    await store.emitEvent(session.id, {
      id: "event-tool-confirm-1",
      type: "user.tool_confirmation",
      createdAt: "2026-04-09T09:23:00.000Z",
      processedAt: null,
      requestId: "confirm-promote-1",
      toolName: "resources_promote_to_substrate",
      allowed: true,
      note: "Shared substrate writeback approved.",
    })

    const secondWake = await orchestration.wake(session.id)
    expect(secondWake.executed).toBe(true)

    const resumed = await store.getSession(session.id)
    expect(resumed.session.stopReason).toBe("idle")
    expect(resumed.session.pendingToolConfirmationRequest).toBeNull()
  })

  it("recommends permissions_check for blocked managed-tool outcome grading", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await store.updateSession(session.id, (current) => ({
      ...current,
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-shell-run",
        toolName: "shell_run",
        ownership: "managed",
        permissionPolicy: "always_ask",
        input: { command: "printf ready > ready.txt" },
        requestedAt: "2026-04-10T11:12:00.000Z",
      },
    }))
    await memoryStore.write({
      agentId: "alpha",
      sessionId: session.id,
      updatedAt: "2026-04-10T11:12:01.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Waiting on shell confirmation before continuing the bounded session goal.",
      activeOutcome: {
        title: "Write the confirmation marker",
        detail: "Resume the managed shell flow after approval.",
        successCriteria: ["The shell command is approved", "The marker file is written"],
      },
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "requires_action",
      learnings: [],
      responseMessage: null,
    })

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: await store.getSession(session.id).then((snapshot) => snapshot.session),
      wakeId: "manual-blocked-outcome-grade",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const outcomeGradeTool = tools.find((tool) => tool.name === "outcome_grade")
    const permissionsCheckTool = tools.find((tool) => tool.name === "permissions_check")
    if (!outcomeGradeTool || !permissionsCheckTool) {
      throw new Error("outcome_grade/permissions_check tool missing")
    }

    const outcomeGradeText = await outcomeGradeTool.execute({})
    expect(outcomeGradeText).toContain('"status": "blocked"')
    expect(outcomeGradeText).toContain('"tool": "permissions_check"')
    expect(outcomeGradeText).toContain('"toolName": "shell_run"')

    const shellRunPreflightText = await permissionsCheckTool.execute({
      toolName: "shell_run",
    })
    expect(shellRunPreflightText).toContain('"outcomeEvaluation": {')
    expect(shellRunPreflightText).toContain('"status": "blocked"')
    expect(shellRunPreflightText).toContain('"nextOutcomeStep": {')
    expect(shellRunPreflightText).toContain('"artifactPaths": {')
    expect(shellRunPreflightText).toContain(".openboa-runtime/permission-posture.json")
  })

  it("recommends bash for blocked read-only shell confirmation loops", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await store.updateSession(session.id, (current) => ({
      ...current,
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-shell-pwd",
        toolName: "shell_run",
        ownership: "managed",
        permissionPolicy: "always_ask",
        input: { command: "pwd", cwd: "/workspace" },
        requestedAt: "2026-04-10T11:12:00.000Z",
      },
    }))
    await memoryStore.write({
      agentId: "alpha",
      sessionId: session.id,
      updatedAt: "2026-04-10T11:12:01.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Waiting on shell confirmation before continuing the bounded session goal.",
      activeOutcome: {
        title: "Inspect the current workspace path",
        detail: "Use the lowest-risk shell surface available.",
        successCriteria: ["The current cwd is inspected"],
      },
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "requires_action",
      learnings: [],
      responseMessage: null,
    })

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: await store.getSession(session.id).then((snapshot) => snapshot.session),
      wakeId: "manual-blocked-outcome-grade-readonly-shell",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const outcomeGradeTool = tools.find((tool) => tool.name === "outcome_grade")
    const permissionsDescribeTool = tools.find((tool) => tool.name === "permissions_describe")
    if (!outcomeGradeTool || !permissionsDescribeTool) {
      throw new Error("outcome_grade/permissions_describe missing")
    }

    const outcomeGradeText = await outcomeGradeTool.execute({})
    const permissionsDescribeText = await permissionsDescribeTool.execute({})
    expect(outcomeGradeText).toContain('"status": "blocked"')
    expect(outcomeGradeText).toContain('"tool": "bash"')
    expect(outcomeGradeText).toContain('"command": "pwd"')
    expect(outcomeGradeText).toContain(
      "Prefer the low-risk bash hand instead of waiting on confirmation",
    )
    expect(permissionsDescribeText).toContain('"pendingToolConfirmationRequest": {')
    expect(permissionsDescribeText).toContain('"toolName": "shell_run"')
    expect(permissionsDescribeText).toContain('"readOnlyAlternative": {')
    expect(permissionsDescribeText).toContain('"tool": "bash"')
    expect(permissionsDescribeText).toContain('"command": "pwd"')
  })

  it("executes a real shell_run confirmation roundtrip through the model tool loop", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    await new RuntimeMemoryStore(companyDir).writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T10:59:00.000Z",
      env: { SESSION_FLAG: "shell confirmed" },
    })

    await store.emitEvent(session.id, {
      id: "event-user-shell-confirm",
      type: "user.message",
      createdAt: "2026-04-10T11:00:00.000Z",
      processedAt: null,
      message: "Write a confirmation marker into the session workspace.",
    })

    const shellArgs = {
      command: "printf '%s' \"$SESSION_FLAG\" > confirmed.txt",
      cwd: "/workspace",
      timeoutMs: 5000,
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_shell_1",
            output: [
              {
                type: "function_call",
                name: "shell_run",
                call_id: "call_shell_1",
                arguments: JSON.stringify(shellArgs),
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_shell_2",
            output: [
              {
                type: "function_call",
                name: "shell_run",
                call_id: "call_shell_2",
                arguments: JSON.stringify(shellArgs),
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_shell_3",
            output_text:
              'Confirmed.\n<openboa-session-loop>{"outcome":"sleep","summary":"Executed the confirmed shell command.","followUpSeconds":null}</openboa-session-loop>',
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )

    const harness = new AgentHarness(companyDir, {
      runner: new AgentTurnRunner(
        new PiRuntimeAdapter(
          new CodexModelClient({
            fetchImpl,
          }),
        ),
      ),
      authProvider: {
        async resolve() {
          return {
            mode: "api-key",
            token: "test-api-key",
          }
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const firstWake = await orchestration.wake(session.id)
    expect(firstWake.executed).toBe(true)
    expect(firstWake.stopReason).toBe("requires_action")

    const waiting = await store.getSession(session.id)
    expect(waiting.session.pendingToolConfirmationRequest?.toolName).toBe("shell_run")
    expect(
      waiting.events.some(
        (event) =>
          event.type === "agent.tool_use" &&
          event.toolName === "shell_run" &&
          event.output === null,
      ),
    ).toBe(true)

    await expect(
      access(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          session.id,
          "workspace",
          "confirmed.txt",
        ),
      ),
    ).rejects.toBeDefined()

    await store.emitEvent(session.id, {
      id: "event-shell-confirm-allow",
      type: "user.tool_confirmation",
      createdAt: "2026-04-10T11:01:00.000Z",
      processedAt: null,
      requestId: String(waiting.session.pendingToolConfirmationRequest?.id),
      toolName: "shell_run",
      allowed: true,
      note: "Writable shell command approved.",
    })

    const secondWake = await orchestration.wake(session.id)
    expect(secondWake.executed).toBe(true)
    expect(secondWake.stopReason).toBe("idle")

    const resumed = await store.getSession(session.id)
    expect(resumed.session.pendingToolConfirmationRequest).toBeNull()
    const fileText = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "confirmed.txt",
      ),
      "utf8",
    )
    expect(fileText).toBe("shell confirmed")
    const shellRuntimeCatalogText = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        ".openboa-runtime",
        "shell-state.json",
      ),
      "utf8",
    )
    expect(shellRuntimeCatalogText).toContain('"count": 1')
    expect(shellRuntimeCatalogText).toContain('"SESSION_FLAG"')
    expect(shellRuntimeCatalogText).not.toContain('"SESSION_FLAG": "shell confirmed"')

    const shellState = await new RuntimeMemoryStore(companyDir).read("alpha", session.id)
    expect(shellState.shellState?.lastCommand?.command).toBe("shell")
    expect(shellState.shellState?.lastCommand?.args).toEqual([shellArgs.command])
    expect(shellState.shellState?.env).toEqual({ SESSION_FLAG: "shell confirmed" })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("executes the approved shell_run request even if the model reissues shell_run with drifted args", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-user-shell-confirm-drift",
      type: "user.message",
      createdAt: "2026-04-10T11:10:00.000Z",
      processedAt: null,
      message: "Write a confirmed marker into the session workspace.",
    })

    const approvedShellArgs = {
      command: "printf 'approved' > confirmed.txt",
      cwd: "/workspace",
      timeoutMs: 5000,
    }
    const driftedShellArgs = {
      command: "printf 'drifted' > drifted.txt",
      cwd: "/workspace",
      timeoutMs: 5000,
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_shell_drift_1",
            output: [
              {
                type: "function_call",
                name: "shell_run",
                call_id: "call_shell_drift_1",
                arguments: JSON.stringify(approvedShellArgs),
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_shell_drift_2",
            output: [
              {
                type: "function_call",
                name: "shell_run",
                call_id: "call_shell_drift_2",
                arguments: JSON.stringify(driftedShellArgs),
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_shell_drift_3",
            output_text:
              'Confirmed.\n<openboa-session-loop>{"outcome":"sleep","summary":"Executed the approved shell command.","followUpSeconds":null}</openboa-session-loop>',
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )

    const harness = new AgentHarness(companyDir, {
      runner: new AgentTurnRunner(
        new PiRuntimeAdapter(
          new CodexModelClient({
            fetchImpl,
          }),
        ),
      ),
      authProvider: {
        async resolve() {
          return {
            mode: "api-key",
            token: "test-api-key",
          }
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const firstWake = await orchestration.wake(session.id)
    expect(firstWake.executed).toBe(true)
    expect(firstWake.stopReason).toBe("requires_action")

    const waiting = await store.getSession(session.id)
    expect(waiting.session.pendingToolConfirmationRequest?.toolName).toBe("shell_run")
    expect(waiting.session.pendingToolConfirmationRequest?.input).toEqual(approvedShellArgs)

    await store.emitEvent(session.id, {
      id: "event-shell-confirm-drift-allow",
      type: "user.tool_confirmation",
      createdAt: "2026-04-10T11:11:00.000Z",
      processedAt: null,
      requestId: String(waiting.session.pendingToolConfirmationRequest?.id),
      toolName: "shell_run",
      allowed: true,
      note: "Run the approved shell command only.",
    })

    const secondWake = await orchestration.wake(session.id)
    expect(secondWake.executed).toBe(true)
    expect(secondWake.stopReason).toBe("idle")

    const resumed = await store.getSession(session.id)
    expect(resumed.session.pendingToolConfirmationRequest).toBeNull()
    const confirmedText = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "confirmed.txt",
      ),
      "utf8",
    )
    expect(confirmedText).toBe("approved")
    await expect(
      access(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          session.id,
          "workspace",
          "drifted.txt",
        ),
      ),
    ).rejects.toBeDefined()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("executes a persistent shell roundtrip through managed tools", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:40:00.000Z",
      env: { SESSION_FLAG: "managed persistent" },
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const openTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-persistent-shell-open",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const shellOpen = openTools.find((tool) => tool.name === "shell_open")
    const shellDescribe = openTools.find((tool) => tool.name === "shell_describe")
    if (!shellOpen || !shellDescribe) {
      throw new Error("persistent shell managed tools missing")
    }

    const openText = await shellOpen.execute({ cwd: "/workspace" })
    expect(openText).toContain('"persistentShell": {')
    expect(openText).toContain('"status": "active"')
    const describedOpenText = await shellDescribe.execute({})
    expect(describedOpenText).toContain('"persistentShell": {')
    expect(describedOpenText).toContain('"status": "active"')

    const execArgs = {
      command:
        'export EXTRA_FLAG=persisted && mkdir -p notes && cd notes && printf "%s/%s" "$SESSION_FLAG" "$EXTRA_FLAG" > managed-persistent.txt',
      timeoutMs: 5000,
    }
    const execTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-shell-exec",
          toolName: "shell_exec",
          input: execArgs,
          reason: "allow persistent shell execution",
          requestedAt: "2026-04-10T11:40:01.000Z",
        },
      },
      wakeId: "manual-persistent-shell-exec",
      pendingEvents: [
        {
          id: "confirm-shell-exec-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:40:02.000Z",
          processedAt: null,
          requestId: "confirm-shell-exec",
          toolName: "shell_exec",
          allowed: true,
          note: "Approved persistent shell execution.",
        },
      ],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const shellExec = execTools.find((tool) => tool.name === "shell_exec")
    const shellClose = execTools.find((tool) => tool.name === "shell_close")
    if (!shellExec || !shellClose) {
      throw new Error("persistent shell exec/close tools missing")
    }
    const execText = await shellExec.execute(execArgs)
    expect(execText).toContain('"persistent": true')
    expect(execText).toContain('"cwd": "/workspace/notes"')
    expect(execText).toContain('"SESSION_FLAG": "managed persistent"')
    expect(execText).toContain('"EXTRA_FLAG": "persisted"')

    const shellStateAfterExec = await memoryStore.read("alpha", session.id)
    expect(shellStateAfterExec.shellState?.cwd).toBe("/workspace/notes")
    expect(shellStateAfterExec.shellState?.env.SESSION_FLAG).toBe("managed persistent")
    expect(shellStateAfterExec.shellState?.env.EXTRA_FLAG).toBe("persisted")
    expect(shellStateAfterExec.shellState?.persistentShell?.status).toBe("active")
    expect(shellStateAfterExec.shellState?.persistentShell?.commandCount).toBe(1)

    const writtenPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "notes",
      "managed-persistent.txt",
    )
    expect(await readFile(writtenPath, "utf8")).toBe("managed persistent/persisted")

    const closeText = await shellClose.execute({})
    expect(closeText).toContain('"closed": true')
    const shellStateAfterClose = await memoryStore.read("alpha", session.id)
    expect(shellStateAfterClose.shellState?.persistentShell?.status).toBe("closed")
  })

  it("prefers live persistent shell status over stale runtime memory in shell_describe", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:45:00.000Z",
      env: {},
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-persistent-shell-stale-describe",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const shellOpen = tools.find((tool) => tool.name === "shell_open")
    const shellDescribe = tools.find((tool) => tool.name === "shell_describe")
    const shellRestart = tools.find((tool) => tool.name === "shell_restart")
    if (!shellOpen || !shellDescribe || !shellRestart) {
      throw new Error("persistent shell describe tools missing")
    }

    const openText = await shellOpen.execute({ cwd: "/workspace" })
    expect(openText).toContain('"status": "active"')

    await sandbox.execute("close_persistent_shell", {})

    const describedText = await shellDescribe.execute({})
    expect(describedText).toContain('"persistentShell": {')
    expect(describedText).toContain('"status": "closed"')
    expect(describedText).toContain('"recoveryPlan": {')
    expect(describedText).toContain('"tool": "shell_restart"')

    const restartedText = await shellRestart.execute({})
    expect(restartedText).toContain('"status": "active"')
  })

  it("surfaces live busy state and current command in shell_describe", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:46:00.000Z",
      env: {},
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-persistent-shell-busy-describe",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const shellOpen = tools.find((tool) => tool.name === "shell_open")
    const shellDescribe = tools.find((tool) => tool.name === "shell_describe")
    const shellWait = tools.find((tool) => tool.name === "shell_wait")
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    const permissionsDescribe = tools.find((tool) => tool.name === "permissions_describe")
    const sessionGetSnapshot = tools.find((tool) => tool.name === "session_get_snapshot")
    const sessionList = tools.find((tool) => tool.name === "session_list")
    const outcomeDefine = tools.find((tool) => tool.name === "outcome_define")
    const outcomeEvaluate = tools.find((tool) => tool.name === "outcome_evaluate")
    if (
      !shellOpen ||
      !shellDescribe ||
      !shellWait ||
      !permissionsCheck ||
      !permissionsDescribe ||
      !sessionGetSnapshot ||
      !sessionList ||
      !outcomeDefine ||
      !outcomeEvaluate
    ) {
      throw new Error("persistent shell permission tools missing")
    }

    await shellOpen.execute({ cwd: "/workspace" })
    const execPromise = sandbox.execute("exec_persistent_shell", {
      command: "printf 'start' && sleep 0.2 && printf 'done'",
      timeoutMs: 2000,
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))

    const describedBusyText = await shellDescribe.execute({})
    expect(describedBusyText).toContain('"persistentShell": {')
    expect(describedBusyText).toContain('"busy": true')
    expect(describedBusyText).toContain(
      "\"currentCommand\": \"printf 'start' && sleep 0.2 && printf 'done'\"",
    )
    expect(describedBusyText).toContain('"busyPlan": {')
    expect(describedBusyText).toContain('"tool": "shell_wait"')
    expect(describedBusyText).toContain('"allowlistedReadTools": [')
    expect(describedBusyText).toContain('"bash"')
    expect(describedBusyText).toContain('"read"')
    expect(describedBusyText).toContain('"evidencePlan": {')
    expect(describedBusyText).toContain('"tool": "shell_read_last_output"')
    expect(describedBusyText).toContain('"avoidTools": [')
    expect(describedBusyText).toContain('"liveOutputPreview": {')
    expect(describedBusyText).toContain('"stdoutPreview": "start"')
    expect(describedBusyText).toContain('"shellReadFirstAlternatives": [')
    const describedBusy = JSON.parse(describedBusyText) as {
      contextPressure: unknown
      shellReadFirstAlternatives: Array<{ tool: string }>
    }
    expect(describedBusy.contextPressure).toBeNull()
    expect(describedBusy.shellReadFirstAlternatives.some((entry) => entry.tool === "bash")).toBe(
      true,
    )
    expect(
      describedBusy.shellReadFirstAlternatives.some(
        (entry) => entry.tool === "shell_read_last_output",
      ),
    ).toBe(true)
    expect(
      describedBusy.shellReadFirstAlternatives.some((entry) => entry.tool === "shell_describe"),
    ).toBe(false)

    await outcomeDefine.execute({
      title: "Wait for the current shell step before calling the session done",
      detail: "The active shell command must finish before the bounded work is judged complete.",
      successCriteria: ["shell_wait returns completed", "shell last output is durable"],
    })
    const outcomeEvaluationBusyText = await outcomeEvaluate.execute({})
    expect(outcomeEvaluationBusyText).toContain('"status": "not_ready"')
    expect(outcomeEvaluationBusyText).toContain('"promotionReady": false')
    expect(outcomeEvaluationBusyText).toContain('"tool": "shell_wait"')
    expect(outcomeEvaluationBusyText).toContain("live persistent shell command is still running")
    const busySnapshotText = await sessionGetSnapshot.execute({})
    expect(busySnapshotText).toContain('"outcomeStatus": "not_ready"')
    expect(busySnapshotText).toContain('"promotionReady": false')
    expect(busySnapshotText).toContain('"tool": "shell_wait"')
    const busyListText = await sessionList.execute({
      includeCurrent: true,
      limit: 3,
      outcomeStatus: "not_ready",
    })
    expect(busyListText).toContain(session.id)
    expect(busyListText).toContain('"outcomeStatus": "not_ready"')

    const shellWaitRunningText = await shellWait.execute({ timeoutMs: 20 })
    expect(shellWaitRunningText).toContain('"status": "running"')
    expect(shellWaitRunningText).toContain('"artifactPaths": {')
    expect(shellWaitRunningText).toContain('"busyPlan": {')
    expect(shellWaitRunningText).toContain('"nextStep": {')
    expect(shellWaitRunningText).toContain('"tool": "shell_wait"')

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellMutationPosture": {')
    expect(shellRunPermissionText).toContain('"busyPlan": {')
    expect(shellRunPermissionText).toContain('"tool": "shell_wait"')
    expect(shellRunPermissionText).toContain('"allowlistedReadTools": [')
    expect(shellRunPermissionText).toContain('"bash"')
    expect(shellRunPermissionText).toContain('"evidencePlan": {')
    expect(shellRunPermissionText).toContain('"tool": "shell_read_last_output"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "shell_describe"')

    const shellExecPermissionText = await permissionsCheck.execute({
      toolName: "shell_exec",
    })
    expect(shellExecPermissionText).toContain('"toolName": "shell_exec"')
    expect(shellExecPermissionText).toContain('"nextStep": {')
    expect(shellExecPermissionText).toContain('"tool": "shell_wait"')
    expect(shellExecPermissionText).toContain('"outcomeEvaluation": {')
    expect(shellExecPermissionText).toContain("live persistent shell command is still running")

    const permissionDescribeText = await permissionsDescribe.execute({})
    expect(permissionDescribeText).toContain('"shellMutationPosture": {')
    expect(permissionDescribeText).toContain('"nextShellStep": {')
    expect(permissionDescribeText).toContain('"contextPressure": null')
    expect(permissionDescribeText).toContain('"tool": "shell_wait"')
    expect(permissionDescribeText).toContain('"allowlistedReadTools": [')
    expect(permissionDescribeText).toContain('"evidencePlan": {')
    expect(permissionDescribeText).toContain('"shellReadFirstAlternatives": [')
    expect(permissionDescribeText).toContain('"tool": "shell_describe"')
    expect(permissionDescribeText).toContain(".openboa-runtime/permission-posture.md")

    const shellLastOutput = tools.find((tool) => tool.name === "shell_read_last_output")
    const shellHistory = tools.find((tool) => tool.name === "shell_history")
    const shellReadCommand = tools.find((tool) => tool.name === "shell_read_command")
    if (!shellLastOutput || !shellHistory || !shellReadCommand) {
      throw new Error("shell read tools missing")
    }
    const lastOutputBusyText = await shellLastOutput.execute({})
    expect(lastOutputBusyText).toContain('"liveCommand": {')
    expect(lastOutputBusyText).toContain('"stdoutPreview": "start"')
    expect(lastOutputBusyText).toContain('"busyPlan": {')
    expect(lastOutputBusyText).toContain('"nextStep": {')
    expect(lastOutputBusyText).toContain('"tool": "shell_wait"')
    const shellHistoryBusyText = await shellHistory.execute({ limit: 3 })
    expect(shellHistoryBusyText).toContain('"busyPlan": {')
    expect(shellHistoryBusyText).toContain('"nextStep": {')
    expect(shellHistoryBusyText).toContain('"tool": "shell_wait"')
    const shellReadCommandBusyText = await shellReadCommand.execute({
      commandId: "unknown-command",
    })
    expect(shellReadCommandBusyText).toContain('"busyPlan": {')
    expect(shellReadCommandBusyText).toContain('"nextStep": {')
    expect(shellReadCommandBusyText).toContain('"tool": "shell_wait"')

    const shellWaitCompletedText = await shellWait.execute({ timeoutMs: 500 })
    expect(shellWaitCompletedText).toContain('"status": "completed"')
    expect(shellWaitCompletedText).toContain('"shellState": {')
    expect(shellWaitCompletedText).toContain('"stdout": "startdone"')

    await execPromise

    const syncedLastOutputText = await shellLastOutput.execute({})
    expect(syncedLastOutputText).toContain('"lastCommand": {')
    expect(syncedLastOutputText).toContain('"stdout": "startdone"')

    const shellWaitIdleText = await shellWait.execute({ timeoutMs: 20 })
    expect(shellWaitIdleText).toContain('"status": "idle"')

    const outcomeEvaluationIdleText = await outcomeEvaluate.execute({})
    expect(outcomeEvaluationIdleText).not.toContain(
      "live persistent shell command is still running",
    )

    const describedIdleText = await shellDescribe.execute({})
    expect(describedIdleText).toContain('"busy": false')
    expect(describedIdleText).toContain('"busyPlan": null')
  })

  it("surfaces read-first alternatives and context pressure in shell_describe without self-reference", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-describe-context-pressure",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
      contextBudgetRef: {
        current: createContextBudgetFixture({
          selectionHeadroomTokens: 320,
          droppedRuntimeNoteCount: 1,
        }),
      },
    })
    const shellDescribe = tools.find((tool) => tool.name === "shell_describe")
    if (!shellDescribe) {
      throw new Error("shell_describe missing")
    }

    const describedText = await shellDescribe.execute({})
    const described = JSON.parse(describedText) as {
      contextPressure: {
        level: string
        reasons: string[]
      } | null
      shellReadFirstAlternatives: Array<{ tool: string }>
    }

    expect(described.contextPressure).not.toBeNull()
    expect(described.contextPressure?.level).toBe("high")
    expect(described.contextPressure?.reasons).toContain("low_headroom:320")
    expect(
      described.shellReadFirstAlternatives.some(
        (entry) => entry.tool === "session_describe_context",
      ),
    ).toBe(true)
    expect(described.shellReadFirstAlternatives.some((entry) => entry.tool === "bash")).toBe(true)
    expect(
      described.shellReadFirstAlternatives.some((entry) => entry.tool === "shell_describe"),
    ).toBe(false)
  })

  it("recommends shell_open before shell_exec when no persistent shell is active", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-persistent-shell-open-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    const shellLastOutput = tools.find((tool) => tool.name === "shell_read_last_output")
    const shellHistory = tools.find((tool) => tool.name === "shell_history")
    const shellReadCommand = tools.find((tool) => tool.name === "shell_read_command")
    const shellWait = tools.find((tool) => tool.name === "shell_wait")
    if (!permissionsCheck || !shellLastOutput || !shellHistory || !shellReadCommand || !shellWait) {
      throw new Error("shell preflight tools missing")
    }

    const shellExecPermissionText = await permissionsCheck.execute({
      toolName: "shell_exec",
    })
    expect(shellExecPermissionText).toContain('"toolName": "shell_exec"')
    expect(shellExecPermissionText).toContain('"recoveryPlan": {')
    expect(shellExecPermissionText).toContain('"tool": "shell_open"')
    expect(shellExecPermissionText).toContain('"nextStep": {')

    const shellLastOutputText = await shellLastOutput.execute({})
    expect(shellLastOutputText).toContain('"recoveryPlan": {')
    expect(shellLastOutputText).toContain('"tool": "shell_open"')
    expect(shellLastOutputText).toContain('"nextStep": {')
    const shellHistoryText = await shellHistory.execute({ limit: 3 })
    expect(shellHistoryText).toContain('"recoveryPlan": {')
    expect(shellHistoryText).toContain('"tool": "shell_open"')
    expect(shellHistoryText).toContain('"nextStep": {')
    const shellReadCommandText = await shellReadCommand.execute({ commandId: "unknown-command" })
    expect(shellReadCommandText).toContain('"recoveryPlan": {')
    expect(shellReadCommandText).toContain('"tool": "shell_open"')
    expect(shellReadCommandText).toContain('"nextStep": {')
    const shellWaitText = await shellWait.execute({ timeoutMs: 20 })
    expect(shellWaitText).toContain('"recoveryPlan": {')
    expect(shellWaitText).toContain('"tool": "shell_open"')
    expect(shellWaitText).toContain('"nextStep": {')
  })

  it("recommends bash before shell_run when the planned command is read-only", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-readonly-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "pwd",
        cwd: "/workspace",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"requiresConfirmation": true')
    expect(shellRunPermissionText).toContain('"readOnlyAlternative": {')
    expect(shellRunPermissionText).toContain('"tool": "bash"')
    expect(shellRunPermissionText).toContain('"command": "pwd"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer bash before using the confirmation-gated writable shell surface",
    )
  })

  it("recommends glob before shell_exec when the planned command is a direct directory listing", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-exec-readonly-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellExecPermissionText = await permissionsCheck.execute({
      toolName: "shell_exec",
      toolArgs: {
        command: "ls src",
        cwd: "/workspace",
      },
    })
    expect(shellExecPermissionText).toContain('"toolName": "shell_exec"')
    expect(shellExecPermissionText).toContain('"recoveryPlan": {')
    expect(shellExecPermissionText).toContain('"tool": "shell_open"')
    expect(shellExecPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellExecPermissionText).toContain('"tool": "glob"')
    expect(shellExecPermissionText).toContain('"path": "/workspace/src"')
    expect(shellExecPermissionText).toContain('"pattern": "*"')
    expect(shellExecPermissionText).toContain('"nextStep": {')
    expect(shellExecPermissionText).toContain(
      "Prefer the first-class managed glob tool before opening a writable shell path",
    )
  })

  it("recommends glob before shell_exec when the planned command is an ls -la style directory listing", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-exec-flagged-listing-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellExecPermissionText = await permissionsCheck.execute({
      toolName: "shell_exec",
      toolArgs: {
        command: "ls -la src",
        cwd: "/workspace",
      },
    })
    expect(shellExecPermissionText).toContain('"toolName": "shell_exec"')
    expect(shellExecPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellExecPermissionText).toContain('"tool": "glob"')
    expect(shellExecPermissionText).toContain('"path": "/workspace/src"')
    expect(shellExecPermissionText).toContain('"pattern": "*"')
    expect(shellExecPermissionText).toContain('"nextStep": {')
    expect(shellExecPermissionText).toContain(
      "Prefer the first-class managed glob tool before opening a writable shell path",
    )
  })

  it("recommends glob before shell_run when the planned command is a bounded find -name search", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-find-name-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "find src -name '*.ts'",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "glob"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src"')
    expect(shellRunPermissionText).toContain('"pattern": "**/*.ts"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed glob tool before opening a writable shell path",
    )
  })

  it("recommends glob with a directory filter before shell_run when the planned command is find -type d -name", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-find-directory-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "find src -type d -name agents",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "glob"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src"')
    expect(shellRunPermissionText).toContain('"pattern": "**/agents"')
    expect(shellRunPermissionText).toContain('"kind": "directory"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed glob tool before opening a writable shell path",
    )
  })

  it("recommends glob before shell_run when the planned find -name search relies on the current cwd", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/src",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-find-cwd-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "find -name '*.ts'",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "glob"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src"')
    expect(shellRunPermissionText).toContain('"pattern": "**/*.ts"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed glob tool before opening a writable shell path",
    )
  })

  it("recommends read before shell_run when the planned command is a direct file read", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/docs",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-file-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "cat guide.md",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "read"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/docs/guide.md"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed read tool before opening a writable shell path",
    )
  })

  it("recommends read before shell_run when the planned command is a head preview", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/docs",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-head-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "head -n 3 guide.md",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "read"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/docs/guide.md"')
    expect(shellRunPermissionText).toContain('"lineCount": 3')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed read tool before opening a writable shell path",
    )
  })

  it("recommends read before shell_run when the planned command is a sed line-range preview", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/docs",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-sed-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "sed -n '10,20p' guide.md",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "read"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/docs/guide.md"')
    expect(shellRunPermissionText).toContain('"startLine": 10')
    expect(shellRunPermissionText).toContain('"lineCount": 11')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed read tool before opening a writable shell path",
    )
  })

  it("recommends read before shell_run when the planned command is a wc -l inspection", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/docs",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-wc-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "wc -l guide.md",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "read"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/docs/guide.md"')
    expect(shellRunPermissionText).toContain('"lineCount": 1')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed read tool before opening a writable shell path",
    )
  })

  it("recommends grep before shell_run when the planned command is a direct workspace search", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/src",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-search-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "grep permissions_check runtime.ts",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "grep"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src/runtime.ts"')
    expect(shellRunPermissionText).toContain('"query": "permissions_check"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed grep tool before opening a writable shell path",
    )
  })

  it("recommends grep before shell_run when the planned command is a grep -in style workspace search", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/src",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-search-flags-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "grep -in permissions_check runtime.ts",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "grep"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src/runtime.ts"')
    expect(shellRunPermissionText).toContain('"query": "permissions_check"')
    expect(shellRunPermissionText).toContain('"caseSensitive": false')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed grep tool before opening a writable shell path",
    )
  })

  it("recommends grep before shell_run when the planned command is a bounded rg search", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/src",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-rg-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "rg -n permissions_check runtime.ts",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "grep"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src/runtime.ts"')
    expect(shellRunPermissionText).toContain('"query": "permissions_check"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed grep tool before opening a writable shell path",
    )
  })

  it("recommends grep before shell_run when the planned rg search relies on the current cwd", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace/src",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-rg-cwd-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "rg -n permissions_check",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "grep"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src"')
    expect(shellRunPermissionText).toContain('"query": "permissions_check"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed grep tool before opening a writable shell path",
    )
  })

  it("recommends grep before shell_run when the planned command is a grep -Rn style recursive workspace search", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-read-first-search-recursive-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
      toolArgs: {
        command: "grep -Rn permissions_check src",
      },
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"shellReadFirstAlternatives": [')
    expect(shellRunPermissionText).toContain('"tool": "grep"')
    expect(shellRunPermissionText).toContain('"path": "/workspace/src"')
    expect(shellRunPermissionText).toContain('"query": "permissions_check"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain(
      "Prefer the first-class managed grep tool before opening a writable shell path",
    )
  })

  it("defaults shell_run preflight to shell_describe when no stronger shell blocker exists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: session.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T11:47:00.000Z",
      env: {},
      persistentShell: null,
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(session.resources)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-shell-run-describe-preflight",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox,
      sandboxEnabled: true,
    })
    const permissionsCheck = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsCheck) {
      throw new Error("permissions_check missing")
    }

    const shellRunPermissionText = await permissionsCheck.execute({
      toolName: "shell_run",
    })
    expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
    expect(shellRunPermissionText).toContain('"nextStep": {')
    expect(shellRunPermissionText).toContain('"tool": "shell_describe"')
    expect(shellRunPermissionText).toContain("Inspect the current session shell posture first")
  })

  it("clears pending blocked state when a user interrupt arrives before the next wake", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.updateSession(session.id, (current) => ({
      ...current,
      status: "requires_action",
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-interrupt",
        toolName: "shell_run",
        ownership: "managed",
        permissionPolicy: "always_ask",
        input: { command: "printf blocked > blocked.txt" },
        requestedAt: "2026-04-10T11:10:00.000Z",
      },
    }))
    await store.emitEvent(session.id, {
      id: "event-interrupt",
      type: "user.interrupt",
      createdAt: "2026-04-10T11:11:00.000Z",
      processedAt: null,
      note: "drop the pending approval and continue",
    })
    await store.emitEvent(session.id, {
      id: "event-after-interrupt",
      type: "user.message",
      createdAt: "2026-04-10T11:11:01.000Z",
      processedAt: null,
      message: "Continue without the old blocked command.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.interrupt: drop the pending approval and continue")
          expect(input.message).not.toContain("pendingToolConfirmation: shell_run")
          return {
            response:
              'Interrupted path cleared.\n<openboa-session-loop>{"outcome":"sleep","summary":"Cleared the blocked tool request and continued.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
    expect(result.stopReason).toBe("idle")

    const updated = await store.getSession(session.id)
    expect(updated.session.pendingToolConfirmationRequest).toBeNull()
    expect(updated.session.stopReason).toBe("idle")
    const interruptResetEvent = updated.events.find(
      (event): event is Extract<SessionEvent, { type: "session.status_idle" }> =>
        event.type === "session.status_idle" &&
        event.summary.startsWith("User interrupted prior blocked or scheduled work"),
    )
    expect(interruptResetEvent).toBeDefined()
  })

  it("lets a user interrupt override a pending tool confirmation that arrived in the same wake window", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.updateSession(session.id, (current) => ({
      ...current,
      status: "requires_action",
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-interrupt-priority",
        toolName: "shell_run",
        ownership: "managed",
        permissionPolicy: "always_ask",
        input: { command: "printf approved > approved.txt" },
        requestedAt: "2026-04-12T00:00:00.000Z",
      },
    }))
    await store.emitEvent(session.id, {
      id: "event-confirm-before-interrupt",
      type: "user.tool_confirmation",
      createdAt: "2026-04-12T00:00:01.000Z",
      processedAt: null,
      requestId: "confirm-interrupt-priority",
      toolName: "shell_run",
      allowed: true,
      note: "approve it",
    })
    await store.emitEvent(session.id, {
      id: "event-interrupt-after-confirm",
      type: "user.interrupt",
      createdAt: "2026-04-12T00:00:02.000Z",
      processedAt: null,
      note: "actually cancel the old blocked command",
    })
    await store.emitEvent(session.id, {
      id: "event-follow-up-message",
      type: "user.message",
      createdAt: "2026-04-12T00:00:03.000Z",
      processedAt: null,
      message: "Continue without the approved blocked command.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          expect(input.message).toContain("user.interrupt: actually cancel the old blocked command")
          expect(input.message).not.toContain("pendingToolConfirmation: shell_run")
          return {
            response:
              'Interrupt won.\n<openboa-session-loop>{"outcome":"sleep","summary":"Ignored the stale confirmation and continued from the interrupt.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
    expect(result.stopReason).toBe("idle")

    const updated = await store.getSession(session.id)
    expect(updated.session.pendingToolConfirmationRequest).toBeNull()
    const confirmationEvent = updated.events.find(
      (event): event is Extract<SessionEvent, { type: "user.tool_confirmation" }> =>
        event.type === "user.tool_confirmation" && event.requestId === "confirm-interrupt-priority",
    )
    expect(confirmationEvent?.processedAt).not.toBeNull()
    const finalMessage = [...updated.events]
      .reverse()
      .find(
        (event): event is Extract<SessionEvent, { type: "agent.message" }> =>
          event.type === "agent.message",
      )
    expect(finalMessage?.message).toContain("Interrupt won.")
  })

  it("migrates legacy transcript and per-agent runtime files into the session layout", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const legacySessionsDir = join(companyDir, ".openboa", "agents", "alpha", "sessions")
    const legacyRuntimeDir = join(companyDir, ".openboa", "agents", "alpha", "runtime")

    await writeFile(
      join(legacySessionsDir, "main.jsonl"),
      `${JSON.stringify({
        kind: "turn.completed",
        conversationId: "legacy-conversation",
        sessionId: "main",
        agentId: "alpha",
        requestMessage: "legacy request",
        responseMessage: "legacy response",
        authMode: "none",
        provider: "openai-codex",
        model: "gpt-5.4",
        runner: "embedded",
        checkpoint: {
          checkpointId: "legacy-checkpoint",
          previousCheckpointId: null,
          createdAt: "2026-04-09T09:30:00.000Z",
        },
      })}\n`,
      "utf8",
    )
    await mkdir(legacyRuntimeDir, { recursive: true })
    await writeFile(
      join(legacyRuntimeDir, "checkpoint.json"),
      `${JSON.stringify({ migrated: true }, null, 2)}\n`,
      "utf8",
    )
    await writeFile(join(legacyRuntimeDir, "session-state.md"), "# Legacy session state\n", "utf8")
    await writeFile(
      join(legacyRuntimeDir, "working-buffer.md"),
      "# Legacy working buffer\n",
      "utf8",
    )

    const store = new SessionStore(companyDir)
    const sessions = await store.listAgentSessions("alpha")

    expect(sessions).toHaveLength(1)
    expect(isUuidV7(sessions[0]?.id)).toBe(true)
    await expect(
      access(join(companyDir, ".openboa", "agents", "alpha", "legacy-sessions", "main.jsonl")),
    ).resolves.toBeUndefined()
    await expect(
      access(
        join(
          companyDir,
          ".openboa",
          "agents",
          "alpha",
          "sessions",
          String(sessions[0]?.id),
          "runtime",
          "checkpoint.json",
        ),
      ),
    ).resolves.toBeUndefined()
  })

  it("discovers vault mounts as read-only session resources", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await mkdir(join(companyDir, ".openboa", "vaults", "github"), { recursive: true })
    await writeFile(
      join(companyDir, ".openboa", "vaults", "github", "token.txt"),
      "secret-token",
      "utf8",
    )
    const store = new SessionStore(companyDir)

    const session = await store.createSession({ agentId: "alpha" })
    const vault = session.resources.find((resource) => resource.kind === "vault")

    expect(vault).toBeDefined()
    expect(vault?.mountPath).toBe("/vaults/github")
    expect(vault?.access).toBe("read_only")
  })

  it("supports positional session event slices beyond the current pending set", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-1",
      type: "user.message",
      createdAt: "2026-04-09T10:00:00.000Z",
      processedAt: null,
      message: "first",
    })
    await store.emitEvent(session.id, {
      id: "event-2",
      type: "agent.message",
      createdAt: "2026-04-09T10:01:00.000Z",
      processedAt: "2026-04-09T10:01:00.000Z",
      message: "second",
      summary: "second",
    })
    await store.emitEvent(session.id, {
      id: "event-3",
      type: "user.message",
      createdAt: "2026-04-09T10:02:00.000Z",
      processedAt: null,
      message: "third",
    })

    const leadUp = await store.listEvents(session.id, {
      beforeEventId: "event-3",
      limit: 2,
    })
    expect(leadUp.map((event) => event.id)).toEqual(["event-1", "event-2"])

    const afterFirst = await store.listEvents(session.id, {
      afterEventId: "event-1",
    })
    expect(afterFirst.map((event) => event.id)).toEqual(["event-2", "event-3"])

    const pendingOnly = await store.listEvents(session.id, {
      includeProcessed: false,
    })
    expect(pendingOnly.map((event) => event.id)).toEqual(["event-1", "event-3"])

    const messagesOnly = await store.listEvents(session.id, {
      includeProcessed: true,
      types: ["agent.message"],
    })
    expect(messagesOnly.map((event) => event.id)).toEqual(["event-2"])

    await store.emitEvent(session.id, {
      id: "event-4",
      type: "session.status_idle",
      createdAt: "2026-04-09T10:03:00.000Z",
      processedAt: "2026-04-09T10:03:00.000Z",
      reason: "idle",
      summary: "fourth",
      blockingEventIds: null,
    })

    const aroundSecond = await store.listEvents(session.id, {
      aroundEventId: "event-2",
      beforeLimit: 1,
      afterLimit: 1,
      includeProcessed: true,
    })
    expect(aroundSecond.map((event) => event.id)).toEqual(["event-1", "event-2", "event-3"])
  })

  it("queries around the checkpoint cursor and includes runtime notes in model history", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-history-user",
      type: "user.message",
      createdAt: "2026-04-09T10:05:00.000Z",
      processedAt: "2026-04-09T10:05:00.000Z",
      message: "Earlier question",
    })
    await store.emitEvent(session.id, {
      id: "event-history-agent",
      type: "agent.message",
      createdAt: "2026-04-09T10:06:00.000Z",
      processedAt: "2026-04-09T10:06:00.000Z",
      message: "Earlier answer",
      summary: "Earlier answer",
    })
    await store.emitEvent(session.id, {
      id: "event-runtime-tool",
      type: "agent.tool_use",
      createdAt: "2026-04-09T10:07:00.000Z",
      processedAt: "2026-04-09T10:07:00.000Z",
      requestId: null,
      toolName: "memory_read",
      ownership: "managed",
      permissionPolicy: "always_allow",
      input: { target: "checkpoint" },
      output: '{"checkpoint":null}',
    })
    await store.emitEvent(session.id, {
      id: "event-runtime-idle",
      type: "session.status_idle",
      createdAt: "2026-04-09T10:08:00.000Z",
      processedAt: "2026-04-09T10:08:00.000Z",
      reason: "idle",
      summary: "Reached a bounded idle checkpoint.",
      blockingEventIds: null,
    })
    await store.emitEvent(session.id, {
      id: "event-pending-next",
      type: "user.message",
      createdAt: "2026-04-09T10:09:00.000Z",
      processedAt: null,
      message: "Use the recent runtime context.",
    })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: session.id,
      updatedAt: "2026-04-09T10:08:00.000Z",
      lastContextEventId: "event-history-agent",
      processedEventIds: ["event-history-agent"],
      producedEventId: "event-history-agent",
      outcome: "sleep",
      summary: "Earlier answer",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Earlier answer",
    })

    const originalListEvents = store.listEvents.bind(store)
    const listEventCalls: Array<{
      afterEventId?: string | null
      beforeEventId?: string | null
      includeProcessed?: boolean
      limit?: number
      types?: string[]
    }> = []
    store.listEvents = async (sessionId, options = {}) => {
      listEventCalls.push({
        afterEventId: options.afterEventId,
        beforeEventId: options.beforeEventId,
        includeProcessed: options.includeProcessed,
        limit: options.limit,
        types: options.types ? [...options.types] : undefined,
      })
      return originalListEvents(sessionId, options)
    }

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      memoryStore,
      runner: {
        async run(input) {
          const historyMessages = input.context.selectedHistory.map((record) => record.message)
          const conversationMessages = input.context.conversationHistory.map(
            (record) => record.message,
          )
          const runtimeNoteMessages = input.context.runtimeNotes.map((record) => record.message)
          expect(historyMessages).toContain("Earlier question")
          expect(historyMessages).toContain("Earlier answer")
          expect(conversationMessages).toEqual(["Earlier question", "Earlier answer"])
          expect(
            historyMessages.some((message) =>
              message.startsWith("[session-event] agent.tool_use memory_read"),
            ),
          ).toBe(true)
          expect(
            historyMessages.some((message) =>
              message.startsWith("[session-event] session.status_idle reason=idle"),
            ),
          ).toBe(true)
          expect(
            runtimeNoteMessages.some((message) =>
              message.startsWith("[session-event] agent.tool_use memory_read"),
            ),
          ).toBe(true)
          expect(
            runtimeNoteMessages.some((message) =>
              message.startsWith("[session-event] session.status_idle reason=idle"),
            ),
          ).toBe(true)
          expect(historyMessages).not.toContain("Use the recent runtime context.")

          return {
            response:
              'Context query improved.\n<openboa-session-loop>{"outcome":"sleep","summary":"Queried context around the checkpoint cursor.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
    expect(
      listEventCalls.some(
        (call) =>
          call.beforeEventId === "event-history-agent" &&
          call.includeProcessed === true &&
          call.limit === 12 &&
          JSON.stringify(call.types) ===
            JSON.stringify([...SESSION_CONTEXT_CONVERSATION_EVENT_TYPES]),
      ),
    ).toBe(true)
    expect(
      listEventCalls.some(
        (call) =>
          call.beforeEventId === "event-history-agent" &&
          call.includeProcessed === true &&
          call.limit === 4 &&
          JSON.stringify(call.types) === JSON.stringify([...SESSION_CONTEXT_RUNTIME_EVENT_TYPES]),
      ),
    ).toBe(true)
    expect(
      listEventCalls.some(
        (call) =>
          call.afterEventId === "event-history-agent" &&
          call.includeProcessed === true &&
          call.limit === 24 &&
          JSON.stringify(call.types) ===
            JSON.stringify([...SESSION_CONTEXT_CONVERSATION_EVENT_TYPES]),
      ),
    ).toBe(true)
    expect(
      listEventCalls.some(
        (call) =>
          call.afterEventId === "event-history-agent" &&
          call.includeProcessed === true &&
          call.limit === 8 &&
          JSON.stringify(call.types) === JSON.stringify([...SESSION_CONTEXT_RUNTIME_EVENT_TYPES]),
      ),
    ).toBe(true)
  })

  it("uses a bounded processed tail when no context cursor exists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 100000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    for (let index = 1; index <= 60; index += 1) {
      const message = `history ${String(index).padStart(2, "0")}`
      const createdAt = `2026-04-09T10:00:00.${String(index).padStart(3, "0")}Z`
      await store.emitEvent(session.id, {
        id: `event-history-${String(index).padStart(2, "0")}`,
        type: "user.message",
        createdAt,
        processedAt: createdAt,
        message,
      })
    }

    await store.emitEvent(session.id, {
      id: "event-pending-bootstrap",
      type: "user.message",
      createdAt: "2026-04-09T11:10:00.000Z",
      processedAt: null,
      message: "Only the recent processed tail should load.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const conversationMessages = input.context.conversationHistory.map(
            (record) => record.message,
          )
          expect(conversationMessages).not.toContain("history 01")
          expect(conversationMessages).not.toContain("history 12")
          expect(conversationMessages).toContain("history 13")
          expect(conversationMessages).toContain("history 60")
          expect(conversationMessages).toHaveLength(48)

          return {
            response:
              'Bootstrap tail bounded.\n<openboa-session-loop>{"outcome":"sleep","summary":"Loaded only the recent processed tail without a cursor.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
  })

  it("searches cross-session memory for prior learnings and session summaries", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const learningsStore = new AgentLearningsStore(companyDir)
    const priorSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: priorSession.id,
      updatedAt: "2026-04-10T06:00:00.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Customer prefers compact memory search results.",
      activeOutcome: {
        title: "Compact preference recall",
        detail: "Retain compact preference details without broad transcript dumps.",
        successCriteria: ["Use concise ranked recall", "Avoid broad transcript dumps"],
      },
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Compact memory search results are better.",
    })
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: priorSession.id,
      cwd: "/workspace/notes",
      updatedAt: "2026-04-10T06:00:02.000Z",
      env: {},
      lastCommand: {
        command: "grep",
        args: ["compact", "MEMORY.md"],
        cwd: "/workspace/notes",
        exitCode: 0,
        timedOut: false,
        durationMs: 12,
        updatedAt: "2026-04-10T06:00:02.000Z",
        outputPreview: "compact preference note found",
        stdoutPreview: "compact preference note found",
        stderrPreview: "",
      },
    })
    await memoryStore.write({
      agentId: "alpha",
      sessionId: currentSession.id,
      updatedAt: "2026-04-10T06:00:30.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "continue",
      summary: "Continue the compact preference recall flow.",
      activeOutcome: {
        title: "Compact preference recall",
        detail: "Keep recall compact while preserving relevant prior work.",
        successCriteria: ["Use concise ranked recall", "Avoid broad transcript dumps"],
      },
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: null,
    })
    await learningsStore.capture({
      agentId: "alpha",
      sessionId: priorSession.id,
      createdAt: "2026-04-10T06:00:01.000Z",
      sourceReason: "session.status_idle",
      learnings: [
        {
          kind: "lesson",
          title: "Compact memory search",
          detail: "Keep cross-session memory search results concise and ranked.",
          promoteToMemory: true,
          dedupeKey: "compact-memory-search",
        },
      ],
    })
    await writeAgentWorkspaceManagedMemoryNotes({
      companyDir,
      agentId: "alpha",
      content: "- Prefer compact preference recall over broad transcript dumps.",
      mode: "append",
    })

    await store.emitEvent(currentSession.id, {
      id: "event-user-memory-search",
      type: "user.message",
      createdAt: "2026-04-10T06:01:00.000Z",
      processedAt: null,
      message: "Search memory for compact preferences.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          const toolMap = new Map((input.tools ?? []).map((tool) => [tool.name, tool]))
          const memorySearchTool = toolMap.get("memory_search")
          expect(memorySearchTool).toBeDefined()
          if (!memorySearchTool) {
            throw new Error("memory_search was not registered")
          }

          const searchText = await memorySearchTool.execute({
            query: "compact memory search",
            limit: 8,
          })

          expect(searchText).toContain('"count":')
          expect(searchText).toContain("Compact memory search")
          expect(searchText).toContain("Customer prefers compact memory search results.")
          expect(searchText).toContain('"source": "learning"')
          expect(searchText).toContain('"source": "workspace_memory"')
          expect(searchText).toContain('"source": "workspace_memory_notes"')
          expect(searchText).toContain('"source": "session_checkpoint"')
          expect(searchText).toContain('"source": "session_evaluation"')
          expect(searchText).toContain('"source": "session_outcome"')
          expect(searchText).toContain('"source": "session_state"')
          expect(searchText).toContain('"source": "working_buffer"')
          expect(searchText).toContain('"source": "shell_state"')
          expect(searchText).toContain('"title": "workspace MEMORY.md"')
          expect(searchText).toContain('"tool": "memory_read"')
          expect(searchText).toContain('"tool": "session_get_snapshot"')
          expect(searchText).toContain('"tool": "outcome_evaluate"')
          expect(searchText).toContain('"tool": "outcome_read"')
          expect(searchText).toContain('"tool": "shell_read_last_output"')
          expect(searchText).toContain('"target": "session_state"')
          expect(searchText).toContain('"target": "working_buffer"')
          expect(searchText).toContain("objective:title-match")

          return {
            response:
              'Cross-session memory searched.\n<openboa-session-loop>{"outcome":"sleep","summary":"Searched prior session memory and learnings.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)

    const snapshot = await store.getSession(currentSession.id)
    const toolEvents = snapshot.events.filter((event) => event.type === "agent.tool_use")
    const searchEvent = toolEvents.find((event) => event.toolName === "memory_search")
    expect(searchEvent?.input).toMatchObject({
      query: "compact memory search",
      limit: 8,
    })
  })

  it("searches and rereads same-agent context across sessions", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const parentSession = await store.createSession({ agentId: "alpha" })
    const priorSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })
    const siblingSession = await store.createSession({ agentId: "alpha" })

    await store.updateSession(priorSession.id, (session) => ({
      ...session,
      metadata: {
        ...session.metadata,
        parentSessionId: parentSession.id,
      },
    }))
    await store.updateSession(currentSession.id, (session) => ({
      ...session,
      metadata: {
        ...session.metadata,
        parentSessionId: parentSession.id,
      },
    }))
    await store.updateSession(siblingSession.id, (session) => ({
      ...session,
      metadata: {
        ...session.metadata,
        parentSessionId: parentSession.id,
      },
    }))

    await store.emitEvent(priorSession.id, {
      id: "prior-user",
      type: "user.message",
      createdAt: "2026-04-10T06:20:00.000Z",
      processedAt: "2026-04-10T06:20:00.000Z",
      wakeId: "wake-prior-1",
      message: "Discuss compact recall behavior.",
    })
    await store.emitEvent(priorSession.id, {
      id: "prior-agent",
      type: "agent.message",
      createdAt: "2026-04-10T06:20:01.000Z",
      processedAt: "2026-04-10T06:20:01.000Z",
      wakeId: "wake-prior-1",
      message: "We should keep recall compact and targeted.",
      summary: "Keep recall compact and targeted.",
    })
    await store.emitEvent(siblingSession.id, {
      id: "sibling-agent",
      type: "agent.message",
      createdAt: "2026-04-10T06:20:02.000Z",
      processedAt: "2026-04-10T06:20:02.000Z",
      wakeId: "wake-sibling-1",
      message: "Sibling note about compact recall behavior.",
      summary: "Sibling note about compact recall behavior.",
    })

    await store.emitEvent(currentSession.id, {
      id: "event-user-cross-session-context",
      type: "user.message",
      createdAt: "2026-04-10T06:21:00.000Z",
      processedAt: null,
      message: "Search prior context for compact recall.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          const toolMap = new Map((input.tools ?? []).map((tool) => [tool.name, tool]))
          const searchTool = toolMap.get("session_search_context")
          const searchTracesTool = toolMap.get("session_search_traces")
          const getEventsTool = toolMap.get("session_get_events")
          expect(searchTool).toBeDefined()
          expect(searchTracesTool).toBeDefined()
          expect(getEventsTool).toBeDefined()
          if (!searchTool || !searchTracesTool || !getEventsTool) {
            throw new Error("cross-session context tools were not registered")
          }

          const searchText = await searchTool.execute({
            query: "compact recall",
            limit: 3,
          })
          expect(searchText).toContain(priorSession.id)
          expect(searchText).toContain('"eventId": "prior-agent"')
          expect(searchText).toContain('"tool": "session_get_trace"')
          expect(searchText).toContain('"sessionRelation": "sibling"')

          const parentOnlyText = await searchTool.execute({
            query: "compact recall",
            limit: 3,
            lineage: "parent",
          })
          expect(parentOnlyText).not.toContain(priorSession.id)

          const siblingOnlyText = await searchTool.execute({
            query: "compact recall",
            limit: 4,
            lineage: "siblings",
          })
          expect(siblingOnlyText).toContain(priorSession.id)
          expect(siblingOnlyText).toContain(siblingSession.id)
          expect(siblingOnlyText).not.toContain(parentSession.id)

          const searchTracesText = await searchTracesTool.execute({
            query: "compact targeted",
            limit: 3,
            lineage: "siblings",
          })
          expect(searchTracesText).toContain(priorSession.id)
          expect(searchTracesText).toContain('"wakeId": "wake-prior-1"')
          expect(searchTracesText).toContain('"tool": "session_get_trace"')

          const getTraceTool = toolMap.get("session_get_trace")
          expect(getTraceTool).toBeDefined()
          if (!getTraceTool) {
            throw new Error("session_get_trace tool was not registered")
          }

          const rereadText = await getTraceTool.execute({
            sessionId: priorSession.id,
            wakeId: "wake-prior-1",
          })
          expect(rereadText).toContain(`"sessionId": "${priorSession.id}"`)
          expect(rereadText).toContain('"wakeId": "wake-prior-1"')
          expect(rereadText).toContain("Discuss compact recall behavior.")
          expect(rereadText).toContain("We should keep recall compact and targeted.")

          return {
            response:
              'Cross-session context search worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Searched and reread prior same-agent session context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)

    const snapshot = await store.getSession(currentSession.id)
    const toolEvents = snapshot.events.filter((event) => event.type === "agent.tool_use")
    expect(toolEvents.map((event) => event.toolName)).toContain("session_search_context")
    expect(toolEvents.map((event) => event.toolName)).toContain("session_search_traces")
    expect(toolEvents.map((event) => event.toolName)).toContain("session_get_trace")
  })

  it("injects relevant cross-session memory notes into the harness context", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const learningsStore = new AgentLearningsStore(companyDir)
    const priorSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: priorSession.id,
      updatedAt: "2026-04-10T06:10:00.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Customer prefers concise answers with compact memory recall.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Concise answers work best.",
    })
    await learningsStore.capture({
      agentId: "alpha",
      sessionId: priorSession.id,
      createdAt: "2026-04-10T06:10:01.000Z",
      sourceReason: "session.status_idle",
      learnings: [
        {
          kind: "lesson",
          title: "Concise memory recall",
          detail: "When recalling prior sessions, surface only the most compact useful hits.",
          promoteToMemory: true,
          dedupeKey: "concise-memory-recall",
        },
      ],
    })

    await store.emitEvent(currentSession.id, {
      id: "event-user-cross-session",
      type: "user.message",
      createdAt: "2026-04-10T06:11:00.000Z",
      processedAt: null,
      message: "Keep memory recall compact and concise.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      memoryStore,
      learningsStore,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[retrieval-plan]"))).toBe(true)
          expect(runtimeNotes.some((message) => message.startsWith("[retrieval-candidate]"))).toBe(
            true,
          )
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("backend=memory") || message.includes("backend=session_context"),
            ),
          ).toBe(true)
          expect(
            runtimeNotes.some(
              (message) => message.includes("nextTool=") && message.includes("nextArgs="),
            ),
          ).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("compact useful hits") ||
                message.includes("compact memory recall") ||
                message.includes("concise answers") ||
                message.includes("Concise memory recall"),
            ),
          ).toBe(true)

          return {
            response:
              'Automatic memory recall worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected relevant cross-session memory into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects relevant skill candidates into the harness context", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await createAgentSkillFixture({
      companyDir,
      name: TEST_SKILL_NAME,
      description:
        "Continue an ongoing conversation naturally while preserving concise continuity.",
      body: `
# Conversation Continuity

Use this skill when the session should continue an existing conversation without resetting tone or context.
- Keep the reply concise.
- Carry forward the latest user goal.
- Do not restart the interaction from scratch.
      `,
    })
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(currentSession.id, {
      id: "event-user-skill-candidate",
      type: "user.message",
      createdAt: "2026-04-10T06:12:00.000Z",
      processedAt: null,
      message: "Continue the conversation naturally and keep continuity concise.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[skill-candidate]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes(TEST_SKILL_NAME) &&
                message.includes("nextTool=skills_read") &&
                message.includes("preview="),
            ),
          ).toBe(true)

          return {
            response:
              'Automatic skill recall worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected relevant skill candidates into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects an outcome repair hint when the session is missing a durable outcome", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(currentSession.id, {
      id: "event-user-missing-outcome",
      type: "user.message",
      createdAt: "2026-04-10T06:12:30.000Z",
      processedAt: null,
      message: "Keep going from the last bounded runtime step.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[outcome-repair]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("status=missing_outcome") &&
                message.includes("nextTool=outcome_define"),
            ),
          ).toBe(true)

          return {
            response:
              'Outcome repair hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected an outcome repair hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects a promotion gate hint when a durable outcome exists but evaluation is not pass", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(currentSession.id, {
      id: "event-user-define-outcome",
      type: "user.define_outcome",
      createdAt: "2026-04-10T06:12:40.000Z",
      processedAt: null,
      outcome: {
        title: "Finish a promotion-safe memory update",
        detail: "Only promote once the runtime has actually validated the outcome.",
        successCriteria: ["Promotion-ready evaluation", "Validated trace evidence"],
      },
    })
    await store.emitEvent(currentSession.id, {
      id: "event-user-promotion-gate",
      type: "user.message",
      createdAt: "2026-04-10T06:12:41.000Z",
      processedAt: null,
      message: "Keep refining until promotion is actually safe.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[promotion-gate]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("promotionReady=false") &&
                message.includes("nextTool=session_get_trace"),
            ),
          ).toBe(true)

          return {
            response:
              'Promotion gate hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a promotion gate hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects an outcome trend hint when evaluator posture stalls across bounded iterations", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-user-define-outcome-trend",
      type: "user.define_outcome",
      createdAt: "2026-04-10T07:10:00.000Z",
      processedAt: null,
      outcome: {
        title: "Reach a promotion-safe bounded result",
        detail: "Keep iterating until the durable outcome is actually ready for promotion.",
        successCriteria: ["Evaluator says promotionReady", "Latest wake evidence is sufficient"],
      },
    })
    await store.emitEvent(session.id, {
      id: "event-user-outcome-trend-1",
      type: "user.message",
      createdAt: "2026-04-10T07:10:01.000Z",
      processedAt: null,
      message: "Run the first bounded pass.",
    })

    let runCount = 0
    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          runCount += 1
          if (runCount === 2) {
            const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
            expect(runtimeNotes.some((message) => message.startsWith("[outcome-trend]"))).toBe(true)
            expect(
              runtimeNotes.some(
                (message) =>
                  message.includes("trend=stable") && message.includes("nextTool=outcome_history"),
              ),
            ).toBe(true)
          }

          return {
            response:
              'Still refining.\n<openboa-session-loop>{"outcome":"sleep","summary":"Bounded refinement is still in progress.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const first = await orchestration.wake(session.id)
    expect(first.executed).toBe(true)

    await store.emitEvent(session.id, {
      id: "event-user-outcome-trend-2",
      type: "user.message",
      createdAt: "2026-04-10T07:11:00.000Z",
      processedAt: null,
      message: "Run the second bounded pass without assuming promotion safety yet.",
    })

    const second = await orchestration.wake(session.id)
    expect(second.executed).toBe(true)
    expect(runCount).toBe(2)

    const memoryStore = new RuntimeMemoryStore(companyDir)
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing default environment for outcome trend permission test")
    }
    const latestSession = (await store.getSession(session.id)).session
    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: latestSession,
      wakeId: "manual-outcome-trend-permission-check",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const permissionsDescribeTool = tools.find((tool) => tool.name === "permissions_describe")
    const promotePreflightTool = tools.find((tool) => tool.name === "permissions_check")
    if (!permissionsDescribeTool || !promotePreflightTool) {
      throw new Error("missing permission tools for outcome trend test")
    }
    const permissionsDescribeText = await permissionsDescribeTool.execute({})
    const promotePreflightText = await promotePreflightTool.execute({
      toolName: "resources_promote_to_substrate",
    })
    expect(permissionsDescribeText).toContain('"nextOutcomeStep": {')
    expect(permissionsDescribeText).toContain('"tool": "outcome_history"')
    expect(promotePreflightText).toContain('"tool": "outcome_history"')
  })

  it("injects a context pressure hint when selected history is crowded", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 220, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    for (let index = 0; index < 8; index += 1) {
      await store.emitEvent(currentSession.id, {
        id: `event-context-history-user-${index}`,
        type: "user.message",
        createdAt: `2026-04-10T06:20:${String(index).padStart(2, "0")}.000Z`,
        processedAt: `2026-04-10T06:20:${String(index).padStart(2, "0")}.100Z`,
        message: `Historical user context ${index} about a long bounded task and prior runtime details.`,
      })
      await store.emitEvent(currentSession.id, {
        id: `event-context-history-agent-${index}`,
        type: "agent.message",
        createdAt: `2026-04-10T06:20:${String(index).padStart(2, "0")}.500Z`,
        processedAt: `2026-04-10T06:20:${String(index).padStart(2, "0")}.700Z`,
        wakeId: `wake-context-${index}`,
        message: `Historical agent reply ${index} with follow-up execution details and outcome commentary.`,
        summary: `Historical summary ${index}`,
      })
    }

    await store.emitEvent(currentSession.id, {
      id: "event-user-context-pressure",
      type: "user.message",
      createdAt: "2026-04-10T06:21:00.000Z",
      processedAt: null,
      message: "Continue the same work without losing the earlier important details.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[context-pressure]"))).toBe(
            true,
          )
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("nextTool=session_describe_context") &&
                message.includes("droppedConversation="),
            ),
          ).toBe(true)

          return {
            response:
              'Context pressure hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a context pressure hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects a read-first hint for direct file inspection requests", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(currentSession.id, {
      id: "event-user-read-first-file",
      type: "user.message",
      createdAt: "2026-04-10T06:22:00.000Z",
      processedAt: null,
      message: "Read /workspace/notes/todo.md and tell me what changed.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[read-first]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("intent=file_read") &&
                message.includes("nextTool=read") &&
                message.includes("/workspace/notes/todo.md"),
            ),
          ).toBe(true)

          return {
            response:
              'Read-first file hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a read-first file hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects a read-first hint for workspace search requests", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(currentSession.id, {
      id: "event-user-read-first-search",
      type: "user.message",
      createdAt: "2026-04-10T06:23:00.000Z",
      processedAt: null,
      message: 'Find where "permissions_check" is handled in the workspace.',
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[read-first]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("intent=workspace_search") &&
                message.includes("nextTool=grep") &&
                message.includes('"query":"permissions_check"'),
            ),
          ).toBe(true)

          return {
            response:
              'Read-first search hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a read-first search hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects a read-first hint for bootstrap quote requests", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(currentSession.id, {
      id: "event-user-read-first-bootstrap",
      type: "user.message",
      createdAt: "2026-04-10T06:24:00.000Z",
      processedAt: null,
      message:
        "Inspect AGENTS.md and answer with two exact quoted lines plus one grounded summary sentence. Do not rewrite the quoted text.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[read-first]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("intent=bootstrap_read") &&
                message.includes("nextTool=read") &&
                message.includes("/workspace/agent/AGENTS.md"),
            ),
          ).toBe(true)

          return {
            response:
              'Read-first bootstrap hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a bootstrap read-first hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("injects a shell busy hint when a live persistent shell command is still running", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })
    const memoryStore = new RuntimeMemoryStore(companyDir)
    await memoryStore.writeShellState({
      agentId: "alpha",
      sessionId: currentSession.id,
      cwd: "/workspace",
      updatedAt: "2026-04-10T06:25:00.000Z",
      env: {},
      persistentShell: {
        shellId: "stale-shell",
        shellPath: "/bin/zsh",
        startedAt: "2026-04-10T06:24:00.000Z",
        updatedAt: "2026-04-10T06:25:00.000Z",
        lastCommandAt: "2026-04-10T06:25:00.000Z",
        commandCount: 1,
        status: "active",
      },
    })
    const sandbox = new LocalSandbox()
    await sandbox.provision(currentSession.resources)
    await sandbox.execute("open_persistent_shell", {
      cwd: "/workspace",
    })
    const execPromise = sandbox.execute("exec_persistent_shell", {
      command: "sleep 0.2 && printf 'done'",
      timeoutMs: 2000,
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))

    await store.emitEvent(currentSession.id, {
      id: "event-user-shell-busy",
      type: "user.message",
      createdAt: "2026-04-10T06:26:00.000Z",
      processedAt: null,
      message: "Keep going, but be careful with the current shell step.",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      memoryStore,
      sandbox,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[shell-busy]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("nextTool=shell_read_last_output") &&
                message.includes("currentCommand=") &&
                message.includes("readTools=") &&
                message.includes("bash"),
            ),
          ).toBe(true)
          return {
            response:
              'Shell busy hint worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a shell busy hint into context.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
    await execPromise
  })

  it("injects a setup drift hint when the agent setup contract changes across wakes", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-setup-drift-initial",
      type: "user.message",
      createdAt: "2026-04-10T06:30:00.000Z",
      processedAt: null,
      message: "Seed the first wake so the session records its setup fingerprint.",
    })

    const firstHarness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run() {
          return {
            response:
              'First wake complete.\n<openboa-session-loop>{"outcome":"sleep","summary":"Recorded the initial agent setup contract.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness: firstHarness,
    })
    await orchestration.wake(session.id)

    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "AGENTS.md"),
      "# AGENTS.md\n\nYou are alpha.\n\n- This line changes the setup contract between wakes.\n",
      "utf8",
    )
    await store.emitEvent(session.id, {
      id: "event-setup-drift-followup",
      type: "user.message",
      createdAt: "2026-04-10T06:31:00.000Z",
      processedAt: null,
      message: "Continue after the runtime contract changed.",
    })

    const secondHarness = new AgentHarness(companyDir, {
      sessionStore: store,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[setup-drift]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("nextTool=session_get_snapshot") &&
                message.includes("previousFingerprint=") &&
                message.includes("currentFingerprint="),
            ),
          ).toBe(true)
          return {
            response:
              'Setup drift noted.\n<openboa-session-loop>{"outcome":"sleep","summary":"Observed setup drift and continued safely.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const secondOrchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness: secondHarness,
    })
    await secondOrchestration.wake(session.id)
  })

  it("falls back to recent same-agent session candidates when retrieval has no direct hit", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const priorSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: priorSession.id,
      updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Prior roadmap checkpoint with pending follow-up work.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Earlier roadmap work is paused.",
    })
    await store.updateSession(priorSession.id, (session) => ({
      ...session,
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-prior-follow-up",
        toolName: "shell_run",
        input: { command: "pwd" },
        reason: "Prior roadmap checkpoint still needs a bounded shell follow-up.",
        requestedAt: "2026-04-10T06:12:30.000Z",
      },
      updatedAt: "2026-04-10T06:12:30.000Z",
    }))

    await store.emitEvent(currentSession.id, {
      id: "event-user-session-fallback",
      type: "user.message",
      createdAt: "2026-04-10T06:13:00.000Z",
      processedAt: null,
      message: "blorptask",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      memoryStore,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[session-candidate]"))).toBe(
            true,
          )
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes(priorSession.id) &&
                message.includes("requiresAction=true") &&
                message.includes("pendingActionTool=shell_run") &&
                message.includes("nextTool=session_get_snapshot") &&
                message.includes("outcomeTrend="),
            ),
          ).toBe(true)
          return {
            response:
              'Recent session fallback worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Injected a recent same-agent session candidate.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("builds automatic recall queries from current summary and working buffer, not only the latest user message", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const learningsStore = new AgentLearningsStore(companyDir)
    const priorSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: priorSession.id,
      updatedAt: "2026-04-10T06:30:00.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Customer prefers compact recall for roadmap discussions.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Compact recall should stay focused.",
    })
    await learningsStore.capture({
      agentId: "alpha",
      sessionId: priorSession.id,
      createdAt: "2026-04-10T06:30:01.000Z",
      sourceReason: "session.status_idle",
      learnings: [
        {
          kind: "lesson",
          title: "Roadmap compact recall",
          detail: "When discussing the roadmap, keep recall compact and focused.",
          promoteToMemory: true,
          dedupeKey: "roadmap-compact-recall",
        },
      ],
    })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: currentSession.id,
      updatedAt: "2026-04-10T06:31:00.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Roadmap planning thread needs prior compact recall guidance.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "No response yet.",
    })

    await store.emitEvent(currentSession.id, {
      id: "event-user-vague-recall",
      type: "user.message",
      createdAt: "2026-04-10T06:31:01.000Z",
      processedAt: null,
      message: "What about that?",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      memoryStore,
      learningsStore,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(
            runtimeNotes.some(
              (message) => message.includes("roadmap") && message.includes("compact recall"),
            ),
          ).toBe(true)

          return {
            response:
              'Summary-assisted recall worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Built recall query from current session summary and working buffer.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("builds automatic recall queries from current open-loop cues when no user message is pending", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await writeFile(
      join(companyDir, ".openboa", "bootstrap", "runtime.json"),
      `${JSON.stringify({ tokenBudget: 12000, defaultProvider: "openai-codex", authProviders: ["codex"] }, null, 2)}\n`,
      "utf8",
    )
    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const learningsStore = new AgentLearningsStore(companyDir)
    const priorSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: priorSession.id,
      updatedAt: "2026-04-10T06:40:00.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "When fetch_spec is waiting, reread the spec recall hints before continuing.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "requires_action",
      learnings: [],
      responseMessage: "Use spec recall hints before resuming.",
    })
    await learningsStore.capture({
      agentId: "alpha",
      sessionId: priorSession.id,
      createdAt: "2026-04-10T06:40:01.000Z",
      sourceReason: "session.status_idle",
      learnings: [
        {
          kind: "lesson",
          title: "fetch_spec recall",
          detail: "When fetch_spec resumes, surface the prior spec recall guidance first.",
          promoteToMemory: true,
          dedupeKey: "fetch-spec-recall",
        },
      ],
    })

    await store.updateSession(currentSession.id, (session) => ({
      ...session,
      updatedAt: "2026-04-10T06:41:00.000Z",
      stopReason: "requires_action",
      pendingCustomToolRequest: {
        id: "request-fetch-spec",
        name: "fetch_spec",
        input: { path: "spec.md" },
        requestedAt: "2026-04-10T06:40:55.000Z",
      },
    }))

    await memoryStore.write({
      agentId: "alpha",
      sessionId: currentSession.id,
      updatedAt: "2026-04-10T06:41:00.000Z",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "The session is paused on fetch_spec and needs the prior spec recall guidance.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "requires_action",
      learnings: [],
      responseMessage: "Waiting on fetch_spec.",
    })

    await store.emitEvent(currentSession.id, {
      id: "event-user-fetch-spec-result",
      type: "user.custom_tool_result",
      createdAt: "2026-04-10T06:41:01.000Z",
      processedAt: null,
      requestId: "request-fetch-spec",
      toolName: "fetch_spec",
      output: "spec content loaded",
    })

    const harness = new AgentHarness(companyDir, {
      sessionStore: store,
      memoryStore,
      learningsStore,
      runner: {
        async run(input) {
          const runtimeNotes = input.context.runtimeNotes.map((record) => record.message)
          expect(runtimeNotes.some((message) => message.startsWith("[retrieval-plan]"))).toBe(true)
          expect(
            runtimeNotes.some(
              (message) =>
                message.includes("fetch_spec") && message.includes("spec recall guidance"),
            ),
          ).toBe(true)

          return {
            response:
              'Open-loop recall worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Built recall query from the current open loop.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(currentSession.id)
    expect(result.executed).toBe(true)
  })

  it("exposes managed runtime tools through the harness and records tool-use events", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await createAgentSkillFixture({
      companyDir,
      name: TEST_SKILL_NAME,
      description:
        "Continue an ongoing conversation naturally while preserving concise continuity.",
      body: `
# Conversation Continuity

Use this skill when the session should continue an existing conversation without resetting tone or context.
- Keep the reply concise.
- Carry forward the latest user goal.
- Do not restart the interaction from scratch.
      `,
    })
    const configPath = join(companyDir, ".openboa", "agents", "alpha", "agent.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>
    config.sandbox = {
      mode: "workspace",
      workspaceAccess: "rw",
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    await mkdir(
      join(companyDir, ".openboa", "agents", "alpha", "sessions", session.id, "workspace", "notes"),
      { recursive: true },
    )
    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "baseline.md"),
      "shared baseline",
      "utf8",
    )
    await writeAgentWorkspaceManagedMemoryNotes({
      companyDir,
      agentId: "alpha",
      content: "- durable managed note",
      mode: "append",
    })
    await store.emitEvent(session.id, {
      id: "event-user-tools",
      type: "user.message",
      createdAt: "2026-04-09T10:10:00.000Z",
      processedAt: null,
      message: "Use the managed runtime tools.",
    })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run(input) {
          const toolMap = new Map((input.tools ?? []).map((tool) => [tool.name, tool]))
          const requireTool = (name: string) => {
            const tool = toolMap.get(name)
            expect(tool).toBeDefined()
            if (!tool) {
              throw new Error(`tool ${name} was not registered`)
            }
            return tool
          }
          expect(toolMap.has("session_get_snapshot")).toBe(true)
          expect(toolMap.has("session_describe_context")).toBe(true)
          expect(toolMap.has("environment_describe")).toBe(true)
          expect(toolMap.has("agent_describe_setup")).toBe(true)
          expect(toolMap.has("agent_compare_setup")).toBe(true)
          expect(toolMap.has("vault_list")).toBe(true)
          expect(toolMap.has("permissions_describe")).toBe(true)
          expect(toolMap.has("permissions_check")).toBe(true)
          expect(toolMap.has("session_list")).toBe(true)
          expect(toolMap.has("session_list_children")).toBe(true)
          expect(toolMap.has("session_delegate")).toBe(true)
          expect(toolMap.has("session_run_child")).toBe(true)
          expect(toolMap.has("session_list_traces")).toBe(true)
          expect(toolMap.has("outcome_read")).toBe(true)
          expect(toolMap.has("outcome_grade")).toBe(true)
          expect(toolMap.has("outcome_evaluate")).toBe(true)
          expect(toolMap.has("outcome_history")).toBe(true)
          expect(toolMap.has("outcome_define")).toBe(true)
          expect(toolMap.has("session_get_events")).toBe(true)
          expect(toolMap.has("session_get_trace")).toBe(true)
          expect(toolMap.has("session_search_traces")).toBe(true)
          expect(toolMap.has("session_search_context")).toBe(true)
          expect(toolMap.has("retrieval_search")).toBe(true)
          expect(toolMap.has("resources_list")).toBe(true)
          expect(toolMap.has("resources_stage_from_substrate")).toBe(true)
          expect(toolMap.has("resources_list_versions")).toBe(true)
          expect(toolMap.has("resources_read_version")).toBe(true)
          expect(toolMap.has("resources_restore_version")).toBe(true)
          expect(toolMap.has("resources_compare_with_substrate")).toBe(true)
          expect(toolMap.has("resources_promote_to_substrate")).toBe(true)
          expect(toolMap.has("memory_list")).toBe(true)
          expect(toolMap.has("memory_read")).toBe(true)
          expect(toolMap.has("memory_list_versions")).toBe(true)
          expect(toolMap.has("memory_read_version")).toBe(true)
          expect(toolMap.has("memory_write")).toBe(true)
          expect(toolMap.has("memory_promote_note")).toBe(true)
          expect(toolMap.has("memory_search")).toBe(true)
          expect(toolMap.has("learning_list")).toBe(true)
          expect(toolMap.has("skills_list")).toBe(true)
          expect(toolMap.has("skills_search")).toBe(true)
          expect(toolMap.has("skills_read")).toBe(true)
          expect(toolMap.has("shell_describe")).toBe(true)
          expect(toolMap.has("shell_history")).toBe(true)
          expect(toolMap.has("shell_wait")).toBe(true)
          expect(toolMap.has("shell_read_last_output")).toBe(true)
          expect(toolMap.has("shell_read_command")).toBe(true)
          expect(toolMap.has("shell_set_cwd")).toBe(true)
          expect(toolMap.has("shell_set_env")).toBe(true)
          expect(toolMap.has("shell_unset_env")).toBe(true)
          expect(toolMap.has("shell_open")).toBe(true)
          expect(toolMap.has("shell_restart")).toBe(true)
          expect(toolMap.has("shell_run")).toBe(true)
          expect(toolMap.has("shell_exec")).toBe(true)
          expect(toolMap.has("shell_close")).toBe(true)
          expect(toolMap.has("read")).toBe(true)
          expect(toolMap.has("write")).toBe(true)
          expect(toolMap.has("edit")).toBe(true)
          expect(toolMap.has("glob")).toBe(true)
          expect(toolMap.has("grep")).toBe(true)
          expect(toolMap.has("bash")).toBe(true)
          expect(toolMap.has("sandbox_describe")).toBe(true)
          expect(toolMap.has("sandbox_execute")).toBe(true)
          expect(requireTool("session_get_snapshot").effects).toEqual(["session_read"])
          expect(requireTool("session_describe_context").effects).toEqual(["session_read"])
          expect(requireTool("environment_describe").effects).toEqual(["resource_read"])
          expect(requireTool("agent_describe_setup").effects).toEqual([
            "session_read",
            "resource_read",
          ])
          expect(requireTool("agent_compare_setup").effects).toEqual([
            "session_read",
            "resource_read",
          ])
          expect(requireTool("vault_list").effects).toEqual(["resource_read"])
          expect(requireTool("permissions_describe").effects).toEqual([
            "session_read",
            "memory_read",
            "sandbox_execute",
          ])
          expect(requireTool("permissions_check").effects).toEqual([
            "session_read",
            "memory_read",
            "sandbox_execute",
          ])
          expect(requireTool("session_list").effects).toEqual(["session_read", "memory_read"])
          expect(requireTool("session_list_children").effects).toEqual([
            "session_read",
            "memory_read",
          ])
          expect(requireTool("session_delegate").effects).toEqual(["session_write"])
          expect(requireTool("session_run_child").effects).toEqual([
            "session_write",
            "session_read",
            "memory_read",
          ])
          expect(requireTool("session_list_traces").effects).toEqual(["session_read"])
          expect(requireTool("outcome_read").effects).toEqual(["session_read"])
          expect(requireTool("outcome_grade").effects).toEqual(["session_read", "memory_read"])
          expect(requireTool("outcome_evaluate").effects).toEqual(["session_read", "memory_read"])
          expect(requireTool("outcome_history").effects).toEqual(["session_read", "memory_read"])
          expect(requireTool("outcome_define").effects).toEqual(["session_write"])
          expect(requireTool("session_get_events").effects).toEqual(["session_read"])
          expect(requireTool("session_get_trace").effects).toEqual(["session_read"])
          expect(requireTool("session_search_traces").effects).toEqual(["session_read"])
          expect(requireTool("session_search_context").effects).toEqual(["session_read"])
          expect(requireTool("retrieval_search").effects).toEqual(["memory_read", "session_read"])
          expect(requireTool("resources_list").effects).toEqual(["resource_read"])
          expect(requireTool("resources_stage_from_substrate").effects).toEqual([
            "resource_read",
            "resource_write",
          ])
          expect(requireTool("resources_stage_from_substrate").readOnly).toBe(false)
          expect(requireTool("resources_list_versions").effects).toEqual(["resource_read"])
          expect(requireTool("resources_read_version").effects).toEqual(["resource_read"])
          expect(requireTool("resources_restore_version").effects).toEqual(["resource_write"])
          expect(requireTool("resources_restore_version").permissionPolicy).toBe("always_ask")
          expect(requireTool("resources_compare_with_substrate").effects).toEqual(["resource_read"])
          expect(requireTool("resources_compare_with_substrate").readOnly).toBe(true)
          expect(requireTool("resources_promote_to_substrate").effects).toEqual(["resource_write"])
          expect(requireTool("resources_promote_to_substrate").readOnly).toBe(false)
          expect(requireTool("memory_list").effects).toEqual(["memory_read"])
          expect(requireTool("memory_read").effects).toEqual(["memory_read"])
          expect(requireTool("memory_list_versions").effects).toEqual(["memory_read"])
          expect(requireTool("memory_read_version").effects).toEqual(["memory_read"])
          expect(requireTool("memory_write").effects).toEqual(["memory_write"])
          expect(requireTool("memory_promote_note").effects).toEqual(["memory_write"])
          expect(requireTool("memory_promote_note").permissionPolicy).toBe("always_ask")
          expect(requireTool("memory_search").effects).toEqual(["memory_read"])
          expect(requireTool("learning_list").effects).toEqual(["learning_read"])
          expect(requireTool("skills_list").effects).toEqual(["skill_read"])
          expect(requireTool("skills_search").effects).toEqual(["skill_read"])
          expect(requireTool("skills_read").effects).toEqual(["skill_read"])
          expect(requireTool("shell_describe").effects).toEqual(["memory_read", "sandbox_execute"])
          expect(requireTool("shell_describe").readOnly).toBe(true)
          expect(requireTool("shell_history").effects).toEqual(["memory_read", "sandbox_execute"])
          expect(requireTool("shell_history").readOnly).toBe(true)
          expect(requireTool("shell_wait").effects).toEqual([
            "memory_read",
            "memory_write",
            "sandbox_execute",
          ])
          expect(requireTool("shell_wait").readOnly).toBe(true)
          expect(requireTool("shell_read_last_output").effects).toEqual([
            "memory_read",
            "sandbox_execute",
          ])
          expect(requireTool("shell_read_last_output").readOnly).toBe(true)
          expect(requireTool("shell_read_command").effects).toEqual([
            "memory_read",
            "sandbox_execute",
          ])
          expect(requireTool("shell_read_command").readOnly).toBe(true)
          expect(requireTool("shell_set_cwd").effects).toEqual(["memory_write", "sandbox_execute"])
          expect(requireTool("shell_set_cwd").readOnly).toBe(false)
          expect(requireTool("shell_set_env").effects).toEqual(["memory_write"])
          expect(requireTool("shell_set_env").readOnly).toBe(false)
          expect(requireTool("shell_unset_env").effects).toEqual(["memory_write"])
          expect(requireTool("shell_unset_env").readOnly).toBe(false)
          expect(requireTool("shell_open").effects).toEqual(["sandbox_execute", "memory_write"])
          expect(requireTool("shell_open").readOnly).toBe(false)
          expect(requireTool("shell_restart").effects).toEqual(["sandbox_execute", "memory_write"])
          expect(requireTool("shell_restart").readOnly).toBe(false)
          expect(requireTool("shell_run").effects).toEqual(["sandbox_execute", "memory_write"])
          expect(requireTool("shell_run").readOnly).toBe(false)
          expect(requireTool("shell_run").permissionPolicy).toBe("always_ask")
          expect(requireTool("shell_exec").effects).toEqual(["sandbox_execute", "memory_write"])
          expect(requireTool("shell_exec").readOnly).toBe(false)
          expect(requireTool("shell_exec").permissionPolicy).toBe("always_ask")
          expect(requireTool("shell_close").effects).toEqual(["sandbox_execute", "memory_write"])
          expect(requireTool("shell_close").readOnly).toBe(false)
          expect(requireTool("read").effects).toEqual(["resource_read", "sandbox_execute"])
          expect(requireTool("write").effects).toEqual(["resource_write", "sandbox_execute"])
          expect(requireTool("edit").effects).toEqual(["resource_write", "sandbox_execute"])
          expect(requireTool("glob").effects).toEqual(["resource_read", "sandbox_execute"])
          expect(requireTool("grep").effects).toEqual(["resource_read", "sandbox_execute"])
          expect(requireTool("bash").effects).toEqual(["sandbox_execute"])
          expect(requireTool("sandbox_describe").effects).toEqual(["sandbox_execute"])
          expect(requireTool("sandbox_describe").readOnly).toBe(true)
          expect(requireTool("sandbox_execute").effects).toEqual(["sandbox_execute"])
          expect(requireTool("sandbox_execute").readOnly).toBe(false)

          const snapshotText = await requireTool("session_get_snapshot").execute({})
          const describeContextText = await requireTool("session_describe_context").execute({})
          const environmentText = await requireTool("environment_describe").execute({})
          const agentSetupText = await requireTool("agent_describe_setup").execute({})
          const agentCompareSetupText = await requireTool("agent_compare_setup").execute({})
          const vaultListText = await requireTool("vault_list").execute({})
          const permissionsText = await requireTool("permissions_describe").execute({})
          const shellRunPermissionText = await requireTool("permissions_check").execute({
            toolName: "shell_run",
          })
          const sessionListText = await requireTool("session_list").execute({
            includeCurrent: true,
            limit: 5,
          })
          const delegatedSessionText = await requireTool("session_delegate").execute({
            title: "Handle a delegated bounded subproblem",
            detail: "Use a child session when current context should stay focused.",
            successCriteria: ["Child session exists", "Child session has a seeded message"],
            message: "Inspect the runtime catalogs from an isolated child session.",
          })
          const delegatedSession = JSON.parse(delegatedSessionText) as {
            parentSessionId: string
            childSession: { sessionId: string; parentSessionId: string | null }
          }
          const childSessionListText = await requireTool("session_list_children").execute({})
          const sessionTraceListText = await requireTool("session_list_traces").execute({
            limit: 6,
          })
          const initialOutcomeText = await requireTool("outcome_read").execute({})
          const initialOutcomeGradeText = await requireTool("outcome_grade").execute({})
          const initialOutcomeEvaluationText = await requireTool("outcome_evaluate").execute({})
          const initialOutcomeHistoryText = await requireTool("outcome_history").execute({})
          const outcomeDefineText = await requireTool("outcome_define").execute({
            title: "Ship a bounded managed-agent outcome loop",
            detail: "The session should leave behind a durable active outcome for later turns.",
            successCriteria: [
              "outcome_read returns the defined title",
              "session_get_snapshot shows activeOutcome",
            ],
          })
          const outcomeDefine = JSON.parse(outcomeDefineText) as {
            eventId: string
          }
          const outcomeReadText = await requireTool("outcome_read").execute({})
          const outcomeGradeText = await requireTool("outcome_grade").execute({})
          const outcomeEvaluationText = await requireTool("outcome_evaluate").execute({})
          const outcomeHistoryText = await requireTool("outcome_history").execute({})
          const promotePermissionText = await requireTool("permissions_check").execute({
            toolName: "resources_promote_to_substrate",
          })
          const snapshotAfterOutcomeText = await requireTool("session_get_snapshot").execute({})
          const eventText = await requireTool("session_get_events").execute({
            aroundEventId: "event-user-tools",
            beforeLimit: 0,
            afterLimit: 12,
            includeProcessed: true,
            types: ["user.message", "agent.tool_use"],
          })
          const parsedTraceListText = JSON.parse(sessionTraceListText) as {
            traces: Array<{ wakeId: string }>
          }
          const tracedWakeId = parsedTraceListText.traces[0]?.wakeId ?? null
          const traceText = tracedWakeId
            ? await requireTool("session_get_trace").execute({
                wakeId: tracedWakeId,
                types: [
                  "session.status_changed",
                  "span.started",
                  "span.completed",
                  "agent.tool_use",
                ],
              })
            : null
          if (!traceText) {
            throw new Error("session_get_trace did not receive a traced wakeId")
          }
          const outcomeEventText = await requireTool("session_get_events").execute({
            aroundEventId: outcomeDefine.eventId,
            beforeLimit: 1,
            afterLimit: 0,
            includeProcessed: true,
            types: ["user.message", "user.define_outcome"],
          })
          const sessionSearchText = await requireTool("session_search_context").execute({
            query: "managed tools",
            limit: 3,
            includeCurrent: true,
            types: ["user.message"],
          })
          const retrievalSearchText = await requireTool("retrieval_search").execute({
            query: "managed tools",
            limit: 4,
            includeCurrent: true,
            backends: ["memory", "session_context"],
          })
          const parsedRetrievalSearch = JSON.parse(retrievalSearchText) as {
            expansionPlan: Array<{ tool: string }>
          }
          const vectorOnlyRetrievalSearchText = await requireTool("retrieval_search").execute({
            query: "managed tools",
            limit: 4,
            includeCurrent: true,
            backends: ["vector"],
          })
          const resourceText = await requireTool("resources_list").execute({})
          const stageText = await requireTool("resources_stage_from_substrate").execute({
            sourcePath: "notes/baseline.md",
            targetPath: "drafts/baseline.md",
            overwrite: true,
          })
          const compareText = await requireTool("resources_compare_with_substrate").execute({
            sessionPath: "drafts/baseline.md",
            substratePath: "notes/baseline.md",
            maxPreviewLines: 6,
          })
          const parsedCompare = JSON.parse(compareText) as {
            substrateContentHash: string | null
            latestVersionId: string | null
            promotePrecondition: {
              expectedVersionId: string | null
              expectedContentHash: string | null
              versionAvailable: boolean
              contentHashAvailable: boolean
            }
          }
          const seededResourceVersion = await new SubstrateArtifactVersionStore(
            companyDir,
          ).recordPromotion({
            agentId: "alpha",
            sessionId: session.id,
            sourcePath: "drafts/baseline.md",
            targetPath: "notes/baseline.md",
            content: "shared baseline",
            createdAt: "2026-04-10T10:10:00.000Z",
            wakeId: "seed-wake",
          })
          const compareTrackedText = await requireTool("resources_compare_with_substrate").execute({
            sessionPath: "drafts/baseline.md",
            substratePath: "notes/baseline.md",
            maxPreviewLines: 6,
          })
          const parsedCompareTracked = JSON.parse(compareTrackedText) as {
            latestVersionId: string | null
            latestVersionContentHash: string | null
            promotePrecondition: {
              expectedVersionId: string | null
              expectedContentHash: string | null
              versionAvailable: boolean
              contentHashAvailable: boolean
            }
          }
          const resourceVersionListText = await requireTool("resources_list_versions").execute({
            targetPath: "notes/baseline.md",
            limit: 5,
          })
          const resourceVersionText = await requireTool("resources_read_version").execute({
            versionId: seededResourceVersion.versionId,
          })
          const memoryListText = await requireTool("memory_list").execute({})
          const memoryText = await requireTool("memory_read").execute({ target: "checkpoint" })
          const memoryWriteText = await requireTool("memory_write").execute({
            target: "working_buffer",
            content: "- captured by managed tool",
            mode: "append",
          })
          const parsedMemoryWrite = JSON.parse(memoryWriteText) as {
            versionId: string
            contentHash: string
          }
          const memoryVersionListText = await requireTool("memory_list_versions").execute({
            target: "working_buffer",
            limit: 5,
          })
          const memoryVersionText = await requireTool("memory_read_version").execute({
            target: "working_buffer",
            versionId: parsedMemoryWrite.versionId,
          })
          const sharedMemoryNotesText = await requireTool("memory_read").execute({
            target: "workspace_memory_notes",
          })
          const memorySearchText = await requireTool("memory_search").execute({
            query: "managed tools",
            limit: 3,
          })
          const learningText = await requireTool("learning_list").execute({})
          const skillsText = await requireTool("skills_list").execute({})
          const shellDescribeInitialText = await requireTool("shell_describe").execute({})
          const shellSetText = await requireTool("shell_set_cwd").execute({
            path: "/workspace/notes",
          })
          const shellDescribeAfterText = await requireTool("shell_describe").execute({})
          const shellHistoryInitialText = await requireTool("shell_history").execute({ limit: 5 })
          const parsedShellHistoryInitial = JSON.parse(shellHistoryInitialText) as {
            commands: Array<{ commandId: string }>
          }
          const shellLastOutputInitialText = await requireTool("shell_read_last_output").execute({})
          const shellReadCommandInitialText = await requireTool("shell_read_command").execute({
            commandId: parsedShellHistoryInitial.commands[0]?.commandId,
          })
          const shellRunTool = requireTool("shell_run")
          expect(shellRunTool.permissionPolicy).toBe("always_ask")
          const skillSearchText = await requireTool("skills_search").execute({
            query: "continue conversation naturally concise continuity",
            limit: 3,
          })
          const skillReadText = await requireTool("skills_read").execute({
            name: TEST_SKILL_NAME,
            maxChars: 2000,
          })
          const readToolText = await requireTool("read").execute({
            path: "/workspace/agent/AGENTS.md",
            maxChars: 1200,
          })
          const readHeadToolText = await requireTool("read").execute({
            path: "/workspace/agent/AGENTS.md",
            lineCount: 2,
          })
          const readHeadWithIgnoredTailToolText = await requireTool("read").execute({
            path: "/workspace/agent/AGENTS.md",
            lineCount: 2,
            tailLines: 0,
          })
          const readRangeToolText = await requireTool("read").execute({
            path: "/workspace/agent/AGENTS.md",
            startLine: 2,
            lineCount: 2,
          })
          const readTailToolText = await requireTool("read").execute({
            path: "/workspace/agent/AGENTS.md",
            tailLines: 2,
          })
          const writeToolText = await requireTool("write").execute({
            path: "notes/direct-tool.md",
            content: "direct write",
          })
          const editToolText = await requireTool("edit").execute({
            path: "notes/direct-tool.md",
            oldText: "direct write",
            newText: "direct edit",
          })
          const globToolText = await requireTool("glob").execute({
            path: "/workspace",
            pattern: "**/*.md",
            limit: 10,
          })
          const grepToolText = await requireTool("grep").execute({
            path: "/workspace",
            query: "direct edit",
            limit: 10,
          })
          const bashToolText = await requireTool("bash").execute({
            command: "pwd",
            args: [],
            timeoutMs: 5000,
          })
          const shellStateText = await requireTool("memory_read").execute({
            target: "shell_state",
          })
          const snapshotAfterShellText = await requireTool("session_get_snapshot").execute({})
          const shellHistoryPath = join(
            companyDir,
            ".openboa",
            "agents",
            "alpha",
            "sessions",
            session.id,
            "workspace",
            ".openboa-runtime",
            "shell-history.md",
          )
          const shellStateCatalogPath = join(
            companyDir,
            ".openboa",
            "agents",
            "alpha",
            "sessions",
            session.id,
            "workspace",
            ".openboa-runtime",
            "shell-state.json",
          )
          const shellHistoryJsonPath = join(
            companyDir,
            ".openboa",
            "agents",
            "alpha",
            "sessions",
            session.id,
            "workspace",
            ".openboa-runtime",
            "shell-history.json",
          )
          const shellLastOutputJsonPath = join(
            companyDir,
            ".openboa",
            "agents",
            "alpha",
            "sessions",
            session.id,
            "workspace",
            ".openboa-runtime",
            "shell-last-output.json",
          )
          const shellLastOutputMarkdownPath = join(
            companyDir,
            ".openboa",
            "agents",
            "alpha",
            "sessions",
            session.id,
            "workspace",
            ".openboa-runtime",
            "shell-last-output.md",
          )
          const sessionRelationsPath = join(
            companyDir,
            ".openboa",
            "agents",
            "alpha",
            "sessions",
            session.id,
            "workspace",
            ".openboa-runtime",
            "session-relations.json",
          )
          const sandboxDescribeText = await requireTool("sandbox_describe").execute({})
          const sandboxWriteText = await requireTool("sandbox_execute").execute({
            name: "write_text",
            input: { path: "notes/tool.md", content: "managed write" },
          })
          const sandboxReadText = await requireTool("sandbox_execute").execute({
            name: "read_text",
            input: { path: "notes/tool.md" },
          })
          const sandboxReplaceText = await requireTool("sandbox_execute").execute({
            name: "replace_text",
            input: {
              path: "notes/tool.md",
              oldText: "managed write",
              newText: "managed replace",
            },
          })
          const sandboxReadReplacedText = await requireTool("sandbox_execute").execute({
            name: "read_text",
            input: { path: "notes/tool.md" },
          })
          const sandboxListText = await requireTool("sandbox_execute").execute({
            name: "list_dir",
            input: { path: "/workspace/notes", limit: 10 },
          })
          const sandboxCommandText = await requireTool("sandbox_execute").execute({
            name: "run_command",
            input: {
              command: "pwd",
              args: [],
              cwd: "/workspace/notes",
              timeoutMs: 5000,
            },
          })
          const promoteTool = requireTool("resources_promote_to_substrate")

          expect(snapshotText).toContain(session.id)
          expect(describeContextText).toContain(`"sessionId": "${session.id}"`)
          expect(describeContextText).toContain('"available": true')
          expect(describeContextText).toContain('"contextSelectionBudgetTokens"')
          expect(describeContextText).toContain('"droppedRuntimeNoteCount"')
          expect(describeContextText).toContain('"pressure":')
          expect(describeContextText).toContain('"topSchemas"')
          expect(describeContextText).toContain("/workspace/.openboa-runtime/context-budget.json")
          expect(environmentText).toContain('"id": "local-default"')
          expect(environmentText).toContain('"fingerprint":')
          expect(environmentText).toContain('"resourceContractFingerprint":')
          expect(environmentText).toContain('"agentSetupFingerprint":')
          expect(environmentText).toContain(".openboa-runtime/environment.json")
          expect(environmentText).toContain(".openboa-runtime/agent-setup.json")
          expect(environmentText).toContain('"mountedResources"')
          expect(agentSetupText).toContain('"available": true')
          expect(agentSetupText).toContain(`"sessionId": "${session.id}"`)
          expect(agentSetupText).toContain(".openboa-runtime/agent-setup.json")
          expect(agentSetupText).toContain(".openboa-runtime/agent-setup.md")
          expect(agentSetupText).toContain('"agentId": "alpha"')
          expect(agentSetupText).toContain('"provider": "openai-codex"')
          expect(agentSetupText).toContain('"model": "gpt-5.4"')
          expect(agentSetupText).toContain('"resilience": {')
          expect(agentSetupText).toContain('"profile": "resilient"')
          expect(agentSetupText).toContain('"recoverableWakeRetryDelayMs": 5000')
          expect(agentSetupText).toContain('"wakeFailureReplayDelayMs": 2000')
          expect(agentSetupText).toContain('"pendingEventBackoffBaseMs": 2000')
          expect(agentSetupText).toContain('"pendingEventBackoffMaxMs": 30000')
          expect(agentSetupText).toContain('"guarantees": [')
          expect(agentSetupText).toContain('"resumable_pauses"')
          expect(agentSetupText).toContain('"replay_safe_delayed_wakes"')
          expect(agentSetupText).toContain('"tools": {')
          expect(agentSetupText).toContain('"skills": {')
          expect(agentSetupText).toContain('"resourceContract": {')
          expect(agentCompareSetupText).toContain(`"currentSessionId": "${session.id}"`)
          expect(agentCompareSetupText).toContain(`"targetSessionId": "${session.id}"`)
          expect(agentCompareSetupText).toContain('"sameSetup": true')
          expect(agentCompareSetupText).toContain('"changedSections": []')
          expect(agentCompareSetupText).toContain(".openboa-runtime/agent-setup.json")
          expect(vaultListText).toContain('"count": 0')
          expect(permissionsText).toContain('"alwaysAskTools"')
          expect(permissionsText).toContain('"outcomeGatedTools"')
          expect(permissionsText).toContain('"outcomeEvaluation": {')
          expect(permissionsText).toContain('"nextOutcomeStep": {')
          expect(permissionsText).toContain('"contextPressure":')
          expect(permissionsText).toContain('"shellMutationPosture": {')
          expect(permissionsText).toContain('"nextShellStep": {')
          expect(permissionsText).toContain(".openboa-runtime/permission-posture.json")
          expect(permissionsText).toContain('"name": "resources_promote_to_substrate"')
          expect(permissionsText).toContain('"name": "resources_restore_version"')
          expect(permissionsText).toContain('"name": "memory_promote_note"')
          expect(permissionsText).toContain('"name": "shell_run"')
          expect(shellRunPermissionText).toContain('"toolName": "shell_run"')
          expect(shellRunPermissionText).toContain('"requiresConfirmation": true')
          expect(shellRunPermissionText).toContain('"permissionPolicy": "always_ask"')
          expect(shellRunPermissionText).toContain('"shellMutationPosture": {')
          expect(shellRunPermissionText).toContain('"contextPressure":')
          expect(shellRunPermissionText).toContain(".openboa-runtime/permission-posture.md")
          expect(snapshotText).toContain('"eventCursor": null')
          expect(snapshotText).toContain('"lastActivityAt":')
          expect(snapshotText).toContain('"activeOutcome": null')
          expect(snapshotText).toContain('"resourceContractFingerprint":')
          expect(snapshotText).toContain('"agentSetupFingerprint":')
          expect(snapshotText).toContain('"artifactPaths": {')
          expect(snapshotText).toContain(".openboa-runtime/agent-setup.json")
          expect(snapshotText).toContain(".openboa-runtime/context-budget.json")
          expect(snapshotText).toContain('"outcomeGrade": {')
          expect(initialOutcomeText).toContain('"activeOutcome": null')
          expect(initialOutcomeGradeText).toContain('"status": "missing_outcome"')
          expect(initialOutcomeEvaluationText).toContain('"status": "missing_outcome"')
          expect(initialOutcomeHistoryText).toContain('"count": 0')
          expect(outcomeDefineText).toContain("Ship a bounded managed-agent outcome loop")
          expect(outcomeReadText).toContain("Ship a bounded managed-agent outcome loop")
          expect(outcomeGradeText).toContain('"status": "in_progress"')
          expect(outcomeGradeText).toContain('"matchedCriteria":')
          expect(outcomeEvaluationText).toContain('"status": "not_ready"')
          expect(outcomeEvaluationText).toContain('"promotionReady": false')
          expect(outcomeEvaluationText).toContain('"evaluationHistory": [')
          expect(outcomeHistoryText).toContain('"count": 1')
          expect(outcomeHistoryText).toContain('"iteration": 0')
          expect(promotePermissionText).toContain('"toolName": "resources_promote_to_substrate"')
          expect(promotePermissionText).toContain('"requiresConfirmation": true')
          expect(promotePermissionText).toContain('"requiresOutcomePass": true')
          expect(promotePermissionText).toContain('"outcomeEvaluation": {')
          expect(promotePermissionText).toContain('"tool": "session_get_trace"')
          expect(snapshotAfterOutcomeText).toContain('"activeOutcome": {')
          expect(snapshotAfterOutcomeText).toContain('"outcomeGrade": {')
          expect(snapshotAfterOutcomeText).toContain('"outcomeTrend": "')
          expect(snapshotAfterOutcomeText).toContain('"nextOutcomeStep": {')
          expect(snapshotAfterOutcomeText).toContain('"outcomeEvaluation": {')
          expect(snapshotAfterOutcomeText).toContain(".openboa-runtime/outcome-grade.json")
          expect(snapshotAfterOutcomeText).toContain("Ship a bounded managed-agent outcome loop")
          expect(sessionListText).toContain('"count":')
          expect(sessionListText).toContain(session.id)
          expect(sessionListText).toContain('"lastActivityAt":')
          expect(sessionListText).toContain('"agentSetupFingerprint":')
          expect(delegatedSession.parentSessionId).toBe(session.id)
          expect(delegatedSession.childSession.parentSessionId).toBe(session.id)
          expect(childSessionListText).toContain(delegatedSession.childSession.sessionId)
          expect(childSessionListText).toContain(`"parentSessionId": "${session.id}"`)
          expect(sessionTraceListText).toContain('"count":')
          expect(sessionTraceListText).toContain('"wakeId":')
          expect(eventText).toContain("event-user-tools")
          expect(eventText).toContain('"count":')
          expect(eventText).toContain('"toolName": "session_get_snapshot"')
          expect(eventText).toContain('"toolName": "environment_describe"')
          expect(eventText).toContain('"wakeId":')
          expect(traceText).not.toBeNull()
          expect(traceText).toContain('"wakeId":')
          expect(traceText).toContain('"type": "session.status_changed"')
          expect(traceText).toContain('"type": "span.started"')
          expect(traceText).toContain('"type": "span.completed"')
          expect(traceText).toContain('"type": "agent.tool_use"')
          expect(outcomeEventText).toContain('"count": 1')
          expect(outcomeEventText).toContain('"type": "user.define_outcome"')
          expect(outcomeEventText).toContain("Ship a bounded managed-agent outcome loop")
          expect(sessionSearchText).toContain('"count":')
          expect(retrievalSearchText).toContain('"count":')
          expect(retrievalSearchText).toContain('"backendSummary"')
          expect(retrievalSearchText).toContain('"expansionPlan"')
          expect(retrievalSearchText).toContain('"backend":')
          expect(retrievalSearchText).toContain('"expansion":')
          expect(
            parsedRetrievalSearch.expansionPlan.some(
              (step) => step.tool === "session_get_events" || step.tool === "session_get_trace",
            ),
          ).toBe(true)
          expect(vectorOnlyRetrievalSearchText).toContain('"count": 0')
          expect(vectorOnlyRetrievalSearchText).toContain('"backendSummary": []')
          expect(resourceText).toContain("session_workspace")
          expect(resourceText).toContain("agent_workspace_substrate")
          expect(stageText).toContain('"targetPath": "drafts/baseline.md"')
          expect(compareText).toContain('"identical": true')
          expect(compareText).toContain('"sessionContentHash":')
          expect(compareText).toContain('"substrateContentHash":')
          expect(compareText).toContain('"latestVersionId": null')
          expect(parsedCompare.promotePrecondition.expectedVersionId).toBeNull()
          expect(parsedCompare.promotePrecondition.expectedContentHash).toBe(
            parsedCompare.substrateContentHash,
          )
          expect(parsedCompare.promotePrecondition.versionAvailable).toBe(false)
          expect(parsedCompare.promotePrecondition.contentHashAvailable).toBe(true)
          expect(compareTrackedText).toContain(
            `"latestVersionId": "${seededResourceVersion.versionId}"`,
          )
          expect(compareTrackedText).toContain(
            `"latestVersionContentHash": "${seededResourceVersion.contentHash}"`,
          )
          expect(parsedCompareTracked.latestVersionId).toBe(seededResourceVersion.versionId)
          expect(parsedCompareTracked.latestVersionContentHash).toBe(
            seededResourceVersion.contentHash,
          )
          expect(parsedCompareTracked.promotePrecondition.expectedVersionId).toBe(
            seededResourceVersion.versionId,
          )
          expect(parsedCompareTracked.promotePrecondition.expectedContentHash).toBe(
            seededResourceVersion.contentHash,
          )
          expect(parsedCompareTracked.promotePrecondition.versionAvailable).toBe(true)
          expect(parsedCompareTracked.promotePrecondition.contentHashAvailable).toBe(true)
          expect(resourceVersionListText).toContain(seededResourceVersion.versionId)
          expect(promoteTool.permissionPolicy).toBe("always_ask")
          expect(resourceVersionText).toContain(seededResourceVersion.versionId)
          expect(resourceVersionText).toContain(seededResourceVersion.contentHash)
          expect(resourceVersionText).toContain("shared baseline")
          expect(memoryListText).toContain('"count":')
          expect(memoryListText).toContain('"target": "shell_state"')
          expect(memoryListText).toContain('"writable": false')
          expect(memoryText).toContain('"checkpoint": null')
          expect(memoryWriteText).toContain('"target": "working_buffer"')
          expect(memoryWriteText).toContain('"versionId":')
          expect(memoryWriteText).toContain('"contentHash":')
          expect(memoryWriteText).toContain("captured by managed tool")
          expect(memoryVersionListText).toContain('"count":')
          expect(memoryVersionListText).toContain(parsedMemoryWrite.versionId)
          expect(memoryVersionText).toContain(parsedMemoryWrite.versionId)
          expect(memoryVersionText).toContain(parsedMemoryWrite.contentHash)
          expect(memoryVersionText).toContain("captured by managed tool")
          expect(sharedMemoryNotesText).toContain("durable managed note")
          expect(memorySearchText).toContain('"count":')
          expect(learningText).toContain('"count": 0')
          expect(skillsText).toContain(TEST_SKILL_NAME)
          expect(skillsText).toContain('"preview":')
          expect(skillsText).toContain('"nextStep": {')
          expect(skillsText).toContain('"tool": "skills_read"')
          expect(shellDescribeInitialText).toContain('"cwd": "/workspace"')
          expect(shellDescribeInitialText).toContain('"count": 0')
          expect(shellDescribeInitialText).toContain('"artifactPaths": {')
          expect(shellDescribeInitialText).toContain(
            "/workspace/.openboa-runtime/shell-last-output.json",
          )
          expect(shellLastOutputInitialText).toContain('"lastCommand"')
          expect(shellLastOutputInitialText).toContain('"stdout"')
          expect(shellLastOutputInitialText).toContain('"artifactPaths"')
          expect(shellSetText).toContain('"cwd": "/workspace/notes"')
          const shellSetEnvText = await requireTool("shell_set_env").execute({
            key: "SESSION_FLAG",
            value: "managed",
          })
          const shellDescribeWithEnvText = await requireTool("shell_describe").execute({})
          const bashEnvText = await requireTool("bash").execute({
            command: "env",
            args: [],
            timeoutMs: 5000,
          })
          const shellUnsetEnvText = await requireTool("shell_unset_env").execute({
            key: "SESSION_FLAG",
          })
          const shellDescribeWithoutEnvText = await requireTool("shell_describe").execute({})
          expect(shellDescribeAfterText).toContain('"cwd": "/workspace/notes"')
          expect(shellSetEnvText).toContain('"key": "SESSION_FLAG"')
          expect(shellSetEnvText).toContain('"count": 1')
          expect(shellDescribeWithEnvText).toContain('"SESSION_FLAG": "managed"')
          expect(bashEnvText).toContain("SESSION_FLAG=managed")
          expect(shellUnsetEnvText).toContain('"key": "SESSION_FLAG"')
          expect(shellUnsetEnvText).toContain('"count": 0')
          expect(shellDescribeWithoutEnvText).toContain('"count": 0')
          expect(shellHistoryInitialText).toContain('"count": 1')
          expect(shellHistoryInitialText).toContain('"commandId":')
          expect(shellHistoryInitialText).toContain('"command": "pwd"')
          expect(shellHistoryInitialText).toContain('"outputPreview":')
          expect(shellHistoryInitialText).toContain('"artifactPaths": {')
          expect(shellReadCommandInitialText).toContain('"commandId":')
          expect(shellReadCommandInitialText).toContain('"command": "pwd"')
          expect(shellReadCommandInitialText).toContain('"artifactPaths": {')
          expect(skillSearchText).toContain('"count":')
          expect(skillSearchText).toContain(TEST_SKILL_NAME)
          expect(skillSearchText).toContain('"preview":')
          expect(skillSearchText).toContain('"reasons": [')
          expect(skillSearchText).toContain('"nextStep": {')
          expect(skillSearchText).toContain('"tool": "skills_read"')
          expect(skillReadText).toContain(`"name": "${TEST_SKILL_NAME}"`)
          expect(skillReadText).toContain('"preview":')
          expect(skillReadText).toContain('"content":')
          expect(readToolText).toContain('"ok": true')
          expect(readToolText).toContain("AGENTS.md")
          expect(readToolText).toContain('"totalLineCount":')
          expect(readToolText).toContain('"selectedLineCount":')
          expect(readHeadToolText).toContain('"ok": true')
          expect(readHeadWithIgnoredTailToolText).toContain('"ok": true')
          expect(readHeadToolText).toContain('"lineWindow": {')
          expect(readHeadWithIgnoredTailToolText).toContain('"lineWindow": {')
          expect(readHeadToolText).toContain('"mode": "head"')
          expect(readHeadWithIgnoredTailToolText).toContain('"mode": "head"')
          expect(readHeadToolText).toContain('"count": 2')
          expect(readHeadWithIgnoredTailToolText).toContain('"count": 2')
          expect(readHeadToolText).toContain('"selectedLineCount": 2')
          expect(readHeadWithIgnoredTailToolText).toContain('"selectedLineCount": 2')
          expect(readRangeToolText).toContain('"ok": true')
          expect(readRangeToolText).toContain('"lineWindow": {')
          expect(readRangeToolText).toContain('"mode": "range"')
          expect(readRangeToolText).toContain('"startLine": 2')
          expect(readRangeToolText).toContain('"count": 2')
          expect(readRangeToolText).toContain('"selectedLineCount": 2')
          expect(readTailToolText).toContain('"ok": true')
          expect(readTailToolText).toContain('"lineWindow": {')
          expect(readTailToolText).toContain('"mode": "tail"')
          expect(readTailToolText).toContain('"count": 2')
          expect(readTailToolText).toContain('"selectedLineCount": 2')
          expect(writeToolText).toContain('"ok": true')
          expect(writeToolText).toContain("direct-tool.md")
          expect(editToolText).toContain('"ok": true')
          expect(editToolText).toContain('"replace_text"')
          expect(globToolText).toContain('"ok": true')
          expect(globToolText).toContain("direct-tool.md")
          expect(grepToolText).toContain('"ok": true')
          expect(grepToolText).toContain("direct-tool.md")
          expect(bashToolText).toContain('"ok": true')
          expect(bashToolText).toContain("command=pwd")
          expect(bashToolText).toContain('"shellState": {')
          expect(bashToolText).toContain('"recentCommands": [')
          expect(bashToolText).toContain('"outputPreview":')
          expect(bashToolText).toContain('"stdoutPreview":')
          expect(bashToolText).toContain('"/workspace/notes"')
          expect(bashToolText).toContain('"env": {}')
          expect(shellStateText).toContain('"cwd": "/workspace/notes"')
          expect(shellStateText).toContain('"recentCommands": [')
          expect(shellStateText).toContain('"outputPreview":')
          expect(shellStateText).toContain('"stdoutPreview":')
          expect(shellStateText).toContain('"env": {}')
          expect(snapshotAfterShellText).toContain('"shellState": {')
          expect(snapshotAfterShellText).toContain(".openboa-runtime/shell-last-output.json")
          expect(snapshotAfterShellText).toContain('"/workspace/notes"')
          expect(await readFile(shellStateCatalogPath, "utf8")).toContain('"version": 5')
          expect(await readFile(shellStateCatalogPath, "utf8")).toContain('"outputPreview":')
          expect(await readFile(shellStateCatalogPath, "utf8")).toContain('"stdoutPreview":')
          expect(await readFile(shellHistoryJsonPath, "utf8")).toContain('"count": 1')
          expect(await readFile(shellHistoryJsonPath, "utf8")).toContain('"command": "pwd"')
          expect(await readFile(shellHistoryPath, "utf8")).toContain("# Shell History")
          expect(await readFile(shellHistoryPath, "utf8")).toContain("```text")
          expect(await readFile(shellHistoryPath, "utf8")).toContain("#### stdout")
          expect(await readFile(shellHistoryPath, "utf8")).toContain("#### summary")
          expect(await readFile(shellHistoryPath, "utf8")).toContain("command=pwd")
          expect(await readFile(shellLastOutputJsonPath, "utf8")).toContain('"lastCommand": {')
          expect(await readFile(shellLastOutputJsonPath, "utf8")).toContain('"command": "pwd"')
          expect(await readFile(shellLastOutputMarkdownPath, "utf8")).toContain(
            "# Shell Last Output",
          )
          expect(await readFile(shellLastOutputMarkdownPath, "utf8")).toContain("## stdout")
          expect(await readFile(sessionRelationsPath, "utf8")).toContain(
            delegatedSession.childSession.sessionId,
          )
          expect(await readFile(sessionRelationsPath, "utf8")).toContain('"childCount": 1')
          expect(sandboxDescribeText).toContain('"kind": "local-workspace-fs"')
          expect(sandboxDescribeText).toContain('"constraints"')
          expect(sandboxDescribeText).toContain('"commandPolicy"')
          expect(sandboxDescribeText).toContain('"allowlistedCommands"')
          expect(sandboxDescribeText).toContain('"actionExamples"')
          expect(sandboxWriteText).toContain('"ok": true')
          expect(sandboxWriteText).toContain('"name": "write_text"')
          expect(sandboxWriteText).toContain("/workspace/notes/tool.md")
          expect(sandboxReadText).toContain('"ok": true')
          expect(sandboxReadText).toContain("managed write")
          expect(sandboxReplaceText).toContain('"ok": true')
          expect(sandboxReplaceText).toContain('"name": "replace_text"')
          expect(sandboxReadReplacedText).toContain("managed replace")
          expect(sandboxListText).toContain('"ok": true')
          expect(sandboxListText).toContain("/workspace/notes/tool.md")
          expect(sandboxCommandText).toContain('"ok": true')
          expect(sandboxCommandText).toContain("command=pwd")
          expect(sandboxCommandText).toContain("cwd=/workspace/notes")
          expect(sandboxCommandText).toContain("/sessions/")

          return {
            response:
              'Managed tools worked.\n<openboa-session-loop>{"outcome":"sleep","summary":"Exercised the managed runtime tools.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const orchestration = new AgentOrchestration(companyDir, {
      sessionStore: store,
      harness,
    })

    const result = await orchestration.wake(session.id)
    expect(result.executed).toBe(true)
  })

  it("enforces optimistic version preconditions for memory_write", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-memory-version-test",
      pendingEvents: [],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const memoryWrite = tools.find((tool) => tool.name === "memory_write")
    const memoryListVersions = tools.find((tool) => tool.name === "memory_list_versions")
    if (!memoryWrite || !memoryListVersions) {
      throw new Error("memory version tools missing")
    }

    const firstWriteText = await memoryWrite.execute({
      target: "session_state",
      content: "- first durable note",
      mode: "append",
    })
    const firstWrite = JSON.parse(firstWriteText) as { versionId: string }

    await expect(
      memoryWrite.execute({
        target: "session_state",
        content: "- conflicting durable note",
        mode: "append",
        expectedVersionId: "wrong-version-id",
      }),
    ).rejects.toThrow(/version precondition failed/u)

    const listedText = await memoryListVersions.execute({
      target: "session_state",
      limit: 5,
    })
    expect(listedText).toContain(firstWrite.versionId)
    expect(listedText).toContain('"count": 1')
  })

  it("gates memory_promote_note behind outcome evaluation when a durable outcome exists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }

    await store.emitEvent(session.id, {
      id: "event-outcome-gate-memory",
      type: "user.define_outcome",
      createdAt: "2026-04-10T12:00:00.000Z",
      processedAt: "2026-04-10T12:00:00.000Z",
      outcome: {
        title: "Promote only verified notes",
        detail: "Shared memory notes should wait until the outcome is truly complete.",
        successCriteria: ["verified promotion-safe summary exists"],
      },
    })

    const gatedArgs = {
      content: "- unverified durable note",
      mode: "append",
    }
    const gatedTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-memory-promote-gated",
          toolName: "memory_promote_note",
          ownership: "managed",
          permissionPolicy: "always_ask",
          input: gatedArgs,
          requestedAt: "2026-04-10T12:00:01.000Z",
        },
      },
      wakeId: "manual-memory-promote-gate",
      pendingEvents: [
        {
          id: "event-memory-promote-gated-approval",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T12:00:02.000Z",
          processedAt: null,
          requestId: "confirm-memory-promote-gated",
          toolName: "memory_promote_note",
          allowed: true,
          note: "Approved to test outcome gate.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const gatedPromoteTool = gatedTools.find((tool) => tool.name === "memory_promote_note")
    if (!gatedPromoteTool) {
      throw new Error("memory_promote_note missing")
    }
    await expect(gatedPromoteTool.execute(gatedArgs)).rejects.toThrow(/requires outcome_evaluate/u)

    const bypassArgs = {
      content: "- explicitly bypassed durable note",
      mode: "append",
      requireOutcomePass: false,
    }
    const bypassTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-memory-promote-bypass",
          toolName: "memory_promote_note",
          ownership: "managed",
          permissionPolicy: "always_ask",
          input: bypassArgs,
          requestedAt: "2026-04-10T12:00:03.000Z",
        },
      },
      wakeId: "manual-memory-promote-bypass",
      pendingEvents: [
        {
          id: "event-memory-promote-bypass-approval",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T12:00:04.000Z",
          processedAt: null,
          requestId: "confirm-memory-promote-bypass",
          toolName: "memory_promote_note",
          allowed: true,
          note: "Approved to bypass the outcome gate.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const bypassPromoteTool = bypassTools.find((tool) => tool.name === "memory_promote_note")
    if (!bypassPromoteTool) {
      throw new Error("memory_promote_note bypass tool missing")
    }
    const bypassText = await bypassPromoteTool.execute(bypassArgs)
    expect(bypassText).toContain('"target": "workspace_memory_notes"')
    expect(bypassText).toContain('"outcomeEvaluation": {')
  })

  it("enforces optimistic content preconditions for resources_promote_to_substrate", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await mkdir(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
      ),
      { recursive: true },
    )
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "guarded.md"),
      "shared initial substrate",
      "utf8",
    )
    await writeFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
        "guarded.md",
      ),
      "session promoted body",
      "utf8",
    )

    const baseTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-resource-version-test",
      pendingEvents: [],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const compareTool = baseTools.find((tool) => tool.name === "resources_compare_with_substrate")
    if (!compareTool) {
      throw new Error("resource compare/promote tools missing")
    }

    const compareText = await compareTool.execute({
      sessionPath: "drafts/guarded.md",
      substratePath: "notes/guarded.md",
      maxPreviewLines: 4,
    })
    const compareResult = JSON.parse(compareText) as {
      promotePrecondition: {
        expectedContentHash: string | null
      }
    }

    const wrongHashArgs = {
      sourcePath: "drafts/guarded.md",
      targetPath: "notes/guarded.md",
      overwrite: true,
      expectedContentHash: "wrong-hash",
    }
    const approvedWrongHashTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-resource-promote-wrong-hash",
          toolName: "resources_promote_to_substrate",
          input: wrongHashArgs,
          reason: "allow wrong-hash precondition test",
          requestedAt: "2026-04-10T11:20:00.000Z",
        },
      },
      wakeId: "manual-resource-version-test",
      pendingEvents: [
        {
          id: "confirm-resource-promote-wrong-hash-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:20:01.000Z",
          processedAt: null,
          requestId: "confirm-resource-promote-wrong-hash",
          toolName: "resources_promote_to_substrate",
          allowed: true,
          note: "Approved for optimistic hash mismatch test.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const wrongHashPromoteTool = approvedWrongHashTools.find(
      (tool) => tool.name === "resources_promote_to_substrate",
    )
    if (!wrongHashPromoteTool) {
      throw new Error("approved resource promote tool missing")
    }
    await expect(wrongHashPromoteTool.execute(wrongHashArgs)).rejects.toThrow(
      /content precondition failed/u,
    )

    const successfulPromoteArgs = {
      sourcePath: "drafts/guarded.md",
      targetPath: "notes/guarded.md",
      overwrite: true,
      expectedContentHash: compareResult.promotePrecondition.expectedContentHash,
    }
    const approvedPromoteTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-resource-promote-correct-hash",
          toolName: "resources_promote_to_substrate",
          input: successfulPromoteArgs,
          reason: "allow correct-hash promotion test",
          requestedAt: "2026-04-10T11:20:02.000Z",
        },
      },
      wakeId: "manual-resource-version-test",
      pendingEvents: [
        {
          id: "confirm-resource-promote-correct-hash-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:20:03.000Z",
          processedAt: null,
          requestId: "confirm-resource-promote-correct-hash",
          toolName: "resources_promote_to_substrate",
          allowed: true,
          note: "Approved for optimistic hash success test.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const promoteTool = approvedPromoteTools.find(
      (tool) => tool.name === "resources_promote_to_substrate",
    )
    if (!promoteTool) {
      throw new Error("approved promote tool missing")
    }
    const promoteText = await promoteTool.execute(successfulPromoteArgs)
    expect(promoteText).toContain('"versionId":')
    expect(promoteText).toContain('"contentHash":')
    const promotedText = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "guarded.md"),
      "utf8",
    )
    expect(promotedText).toBe("session promoted body")
  })

  it("promotes to shared substrate from an absolute mount path even when no prior substrate version exists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }

    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "IDENTITY.md"),
      "# IDENTITY.md\n\n- Agent id: `alpha`\n",
      "utf8",
    )
    await mkdir(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
      ),
      { recursive: true },
    )
    await writeFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
        "IDENTITY.md",
      ),
      "# IDENTITY.md\n\n- Agent id: `alpha`\n- Scenario-PROMOTE-IDENTITY\n",
      "utf8",
    )

    const baseTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session,
      wakeId: "manual-bootstrap-promote-precondition",
      pendingEvents: [],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const compareTool = baseTools.find((tool) => tool.name === "resources_compare_with_substrate")
    if (!compareTool) {
      throw new Error("resources_compare_with_substrate missing")
    }

    const compareText = await compareTool.execute({
      sessionPath: "/workspace/drafts/IDENTITY.md",
      substratePath: "/workspace/agent/IDENTITY.md",
      maxPreviewLines: 4,
    })
    const compareResult = JSON.parse(compareText) as {
      promotePrecondition: {
        expectedVersionId: string | null
        expectedContentHash: string | null
        versionAvailable: boolean
        contentHashAvailable: boolean
      }
    }
    expect(compareResult.promotePrecondition.expectedVersionId).toBeNull()
    expect(compareResult.promotePrecondition.versionAvailable).toBe(false)
    expect(compareResult.promotePrecondition.contentHashAvailable).toBe(true)

    const promoteArgs = {
      sourcePath: "/workspace/drafts/IDENTITY.md",
      targetPath: "/workspace/agent/IDENTITY.md",
      overwrite: true,
      expectedContentHash: compareResult.promotePrecondition.expectedContentHash,
    }
    const approvedPromoteTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-bootstrap-promote-precondition",
          toolName: "resources_promote_to_substrate",
          ownership: "managed",
          permissionPolicy: "always_ask",
          input: promoteArgs,
          requestedAt: "2026-04-12T00:00:00.000Z",
        },
      },
      wakeId: "manual-bootstrap-promote-precondition",
      pendingEvents: [
        {
          id: "confirm-bootstrap-promote-precondition-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-12T00:00:01.000Z",
          processedAt: null,
          requestId: "confirm-bootstrap-promote-precondition",
          toolName: "resources_promote_to_substrate",
          allowed: true,
          note: "Approved for bootstrap substrate promotion test.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const promoteTool = approvedPromoteTools.find(
      (tool) => tool.name === "resources_promote_to_substrate",
    )
    if (!promoteTool) {
      throw new Error("resources_promote_to_substrate missing")
    }

    const promoteText = await promoteTool.execute(promoteArgs)
    expect(promoteText).toContain('"versionId":')
    const promotedIdentity = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "IDENTITY.md"),
      "utf8",
    )
    expect(promotedIdentity).toContain("- Scenario-PROMOTE-IDENTITY")
  })

  it("gates resources_promote_to_substrate behind outcome evaluation when a durable outcome exists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await mkdir(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
      ),
      { recursive: true },
    )
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "gated.md"),
      "shared initial substrate",
      "utf8",
    )
    await writeFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
        "gated.md",
      ),
      "session promoted body",
      "utf8",
    )
    await store.emitEvent(session.id, {
      id: "event-outcome-gate-substrate",
      type: "user.define_outcome",
      createdAt: "2026-04-10T12:10:00.000Z",
      processedAt: "2026-04-10T12:10:00.000Z",
      outcome: {
        title: "Promote only verified substrate",
        detail: "Shared substrate should wait until the outcome is truly complete.",
        successCriteria: ["verified substrate-ready summary exists"],
      },
    })

    const gatedArgs = {
      sourcePath: "drafts/gated.md",
      targetPath: "notes/gated.md",
      overwrite: true,
    }
    const gatedTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-substrate-promote-gated",
          toolName: "resources_promote_to_substrate",
          ownership: "managed",
          permissionPolicy: "always_ask",
          input: gatedArgs,
          requestedAt: "2026-04-10T12:10:01.000Z",
        },
      },
      wakeId: "manual-substrate-promote-gate",
      pendingEvents: [
        {
          id: "event-substrate-promote-gated-approval",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T12:10:02.000Z",
          processedAt: null,
          requestId: "confirm-substrate-promote-gated",
          toolName: "resources_promote_to_substrate",
          allowed: true,
          note: "Approved to test substrate outcome gate.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const gatedPromoteTool = gatedTools.find(
      (tool) => tool.name === "resources_promote_to_substrate",
    )
    if (!gatedPromoteTool) {
      throw new Error("resources_promote_to_substrate missing")
    }
    await expect(gatedPromoteTool.execute(gatedArgs)).rejects.toThrow(/requires outcome_evaluate/u)

    const bypassArgs = {
      sourcePath: "drafts/gated.md",
      targetPath: "notes/gated.md",
      overwrite: true,
      requireOutcomePass: false,
    }
    const bypassTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-substrate-promote-bypass",
          toolName: "resources_promote_to_substrate",
          ownership: "managed",
          permissionPolicy: "always_ask",
          input: bypassArgs,
          requestedAt: "2026-04-10T12:10:03.000Z",
        },
      },
      wakeId: "manual-substrate-promote-bypass",
      pendingEvents: [
        {
          id: "event-substrate-promote-bypass-approval",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T12:10:04.000Z",
          processedAt: null,
          requestId: "confirm-substrate-promote-bypass",
          toolName: "resources_promote_to_substrate",
          allowed: true,
          note: "Approved to bypass the substrate outcome gate.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const bypassPromoteTool = bypassTools.find(
      (tool) => tool.name === "resources_promote_to_substrate",
    )
    if (!bypassPromoteTool) {
      throw new Error("resources_promote_to_substrate bypass tool missing")
    }
    const bypassText = await bypassPromoteTool.execute(bypassArgs)
    expect(bypassText).toContain('"versionId":')
    expect(bypassText).toContain('"outcomeEvaluation": {')
  })

  it("enforces optimistic content preconditions for resources_restore_version", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const versionStore = new SubstrateArtifactVersionStore(companyDir)

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "rollback.md"),
      "current substrate body",
      "utf8",
    )
    const recordedVersion = await versionStore.recordPromotion({
      agentId: "alpha",
      sessionId: session.id,
      sourcePath: "drafts/rollback.md",
      targetPath: "notes/rollback.md",
      content: "restored substrate body",
      createdAt: "2026-04-10T11:30:00.000Z",
      wakeId: "seed-rollback-version",
    })
    const currentHash = createHash("sha256").update("current substrate body").digest("hex")

    const wrongHashArgs = {
      versionId: recordedVersion.versionId,
      expectedContentHash: "wrong-hash",
    }
    const approvedWrongHashTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-resource-restore-wrong-hash",
          toolName: "resources_restore_version",
          input: wrongHashArgs,
          reason: "allow wrong-hash rollback test",
          requestedAt: "2026-04-10T11:30:01.000Z",
        },
      },
      wakeId: "manual-resource-restore-version-test",
      pendingEvents: [
        {
          id: "confirm-resource-restore-wrong-hash-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:30:02.000Z",
          processedAt: null,
          requestId: "confirm-resource-restore-wrong-hash",
          toolName: "resources_restore_version",
          allowed: true,
          note: "Approved for rollback hash mismatch test.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const wrongHashRestoreTool = approvedWrongHashTools.find(
      (tool) => tool.name === "resources_restore_version",
    )
    if (!wrongHashRestoreTool) {
      throw new Error("approved restore tool missing")
    }
    await expect(wrongHashRestoreTool.execute(wrongHashArgs)).rejects.toThrow(
      /content precondition failed/u,
    )

    const restoreArgs = {
      versionId: recordedVersion.versionId,
      expectedContentHash: currentHash,
    }
    const approvedRestoreTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-resource-restore-correct-hash",
          toolName: "resources_restore_version",
          input: restoreArgs,
          reason: "allow correct-hash rollback test",
          requestedAt: "2026-04-10T11:30:03.000Z",
        },
      },
      wakeId: "manual-resource-restore-version-test",
      pendingEvents: [
        {
          id: "confirm-resource-restore-correct-hash-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:30:04.000Z",
          processedAt: null,
          requestId: "confirm-resource-restore-correct-hash",
          toolName: "resources_restore_version",
          allowed: true,
          note: "Approved for rollback hash success test.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const restoreTool = approvedRestoreTools.find(
      (tool) => tool.name === "resources_restore_version",
    )
    if (!restoreTool) {
      throw new Error("approved restore tool missing")
    }
    const restoreText = await restoreTool.execute(restoreArgs)
    expect(restoreText).toContain('"restoredFromVersionId":')
    expect(restoreText).toContain('"contentHash":')
    const restoredText = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "rollback.md"),
      "utf8",
    )
    expect(restoredText).toBe("restored substrate body")
  })

  it("gates resources_restore_version behind outcome evaluation when a durable outcome exists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const environmentStore = new EnvironmentStore(companyDir)
    const environment = await environmentStore.getEnvironment(session.environmentId)
    if (!environment) {
      throw new Error("missing environment")
    }
    const versionStore = new SubstrateArtifactVersionStore(companyDir)

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "gated-restore.md"),
      "current substrate body",
      "utf8",
    )
    const recordedVersion = await versionStore.recordPromotion({
      agentId: "alpha",
      sessionId: session.id,
      sourcePath: "drafts/gated-restore.md",
      targetPath: "notes/gated-restore.md",
      content: "restored gated substrate body",
      createdAt: "2026-04-10T11:40:00.000Z",
      wakeId: "seed-gated-restore-version",
    })
    await store.emitEvent(session.id, {
      id: "event-outcome-gate-restore",
      type: "user.define_outcome",
      createdAt: "2026-04-10T11:40:01.000Z",
      processedAt: "2026-04-10T11:40:01.000Z",
      outcome: {
        title: "Restore only verified substrate",
        detail: "A rollback should also wait for a pass evaluator verdict.",
        successCriteria: ["verified restore-ready summary exists"],
      },
    })

    const gatedArgs = { versionId: recordedVersion.versionId }
    const gatedTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-resource-restore-gated",
          toolName: "resources_restore_version",
          input: gatedArgs,
          reason: "allow gated restore test",
          requestedAt: "2026-04-10T11:40:02.000Z",
        },
      },
      wakeId: "manual-resource-restore-gated",
      pendingEvents: [
        {
          id: "confirm-resource-restore-gated-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:40:03.000Z",
          processedAt: null,
          requestId: "confirm-resource-restore-gated",
          toolName: "resources_restore_version",
          allowed: true,
          note: "Approved to test restore outcome gate.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const gatedRestoreTool = gatedTools.find((tool) => tool.name === "resources_restore_version")
    if (!gatedRestoreTool) {
      throw new Error("resources_restore_version missing")
    }
    await expect(gatedRestoreTool.execute(gatedArgs)).rejects.toThrow(/requires outcome_evaluate/u)

    const bypassArgs = {
      versionId: recordedVersion.versionId,
      requireOutcomePass: false,
    }
    const bypassTools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: {
        ...session,
        pendingToolConfirmationRequest: {
          id: "confirm-resource-restore-bypass",
          toolName: "resources_restore_version",
          input: bypassArgs,
          reason: "allow restore gate bypass test",
          requestedAt: "2026-04-10T11:40:04.000Z",
        },
      },
      wakeId: "manual-resource-restore-bypass",
      pendingEvents: [
        {
          id: "confirm-resource-restore-bypass-event",
          type: "user.tool_confirmation",
          createdAt: "2026-04-10T11:40:05.000Z",
          processedAt: null,
          requestId: "confirm-resource-restore-bypass",
          toolName: "resources_restore_version",
          allowed: true,
          note: "Approved to bypass the restore outcome gate.",
        },
      ],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: true,
    })
    const bypassRestoreTool = bypassTools.find((tool) => tool.name === "resources_restore_version")
    if (!bypassRestoreTool) {
      throw new Error("resources_restore_version bypass tool missing")
    }
    const bypassText = await bypassRestoreTool.execute(bypassArgs)
    expect(bypassText).toContain('"restoredFromVersionId":')
    expect(bypassText).toContain('"outcomeEvaluation": {')
  })

  it("scopes session navigation tools to the current agent", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    await createOfflineCodexAgent(companyDir, "beta")

    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const learningsStore = new AgentLearningsStore(companyDir)
    const parentAlphaSession = await store.createSession({ agentId: "alpha" })
    const currentSession = await store.createSession({ agentId: "alpha" })
    const priorAlphaSession = await store.createSession({ agentId: "alpha" })
    const staleAlphaSession = await store.createSession({ agentId: "alpha" })
    const betaSession = await store.createSession({ agentId: "beta" })
    const recentActivityAt = new Date(Date.now() - 15 * 60_000).toISOString()
    const staleActivityAt = new Date(Date.now() - 4 * 60 * 60_000).toISOString()
    const parentActivityAt = new Date(Date.now() - 5 * 60 * 60_000).toISOString()
    const currentOutcome = {
      title: "Stabilize alpha runtime",
      detail: "Prefer sessions already working on the same runtime objective.",
      successCriteria: ["Alpha prior session summary."],
    }
    const staleOutcome = {
      title: "Investigate older alpha thread",
      detail: "Keep this separate from the current runtime objective.",
      successCriteria: ["Older alpha session summary."],
    }

    await store.updateSession(currentSession.id, (session) => ({
      ...session,
      metadata: {
        ...session.metadata,
        parentSessionId: parentAlphaSession.id,
      },
    }))
    await store.updateSession(priorAlphaSession.id, (session) => ({
      ...session,
      metadata: {
        ...session.metadata,
        parentSessionId: parentAlphaSession.id,
      },
    }))

    await store.emitEvent(currentSession.id, {
      id: "event-current-outcome",
      type: "user.define_outcome",
      createdAt: recentActivityAt,
      processedAt: recentActivityAt,
      outcome: currentOutcome,
    })
    await store.emitEvent(priorAlphaSession.id, {
      id: "event-prior-outcome",
      type: "user.define_outcome",
      createdAt: recentActivityAt,
      processedAt: recentActivityAt,
      outcome: currentOutcome,
    })
    await store.emitEvent(priorAlphaSession.id, {
      id: "event-prior-message",
      type: "agent.message",
      createdAt: recentActivityAt,
      processedAt: recentActivityAt,
      wakeId: "wake-prior-alpha",
      message: "Alpha prior session summary.",
      summary: "Alpha prior session summary.",
    })
    await store.emitEvent(priorAlphaSession.id, {
      id: "event-prior-wake-complete",
      type: "span.completed",
      createdAt: recentActivityAt,
      processedAt: recentActivityAt,
      wakeId: "wake-prior-alpha",
      spanId: "wake-prior-alpha",
      parentSpanId: null,
      spanKind: "wake",
      name: "session_run",
      result: "success",
      summary: "Prior alpha wake completed successfully.",
    })
    await store.emitEvent(priorAlphaSession.id, {
      id: "event-prior-idle",
      type: "session.status_idle",
      createdAt: recentActivityAt,
      processedAt: recentActivityAt,
      wakeId: "wake-prior-alpha",
      reason: "idle",
      summary: "Alpha prior session summary.",
      blockingEventIds: null,
    })
    await store.emitEvent(staleAlphaSession.id, {
      id: "event-stale-outcome",
      type: "user.define_outcome",
      createdAt: staleActivityAt,
      processedAt: staleActivityAt,
      outcome: staleOutcome,
    })

    await memoryStore.write({
      agentId: "alpha",
      sessionId: parentAlphaSession.id,
      updatedAt: parentActivityAt,
      wakeId: "wake-parent-alpha",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Parent alpha coordination summary.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Parent alpha response.",
    })
    await memoryStore.write({
      agentId: "alpha",
      sessionId: currentSession.id,
      updatedAt: recentActivityAt,
      wakeId: "wake-current-alpha",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Current alpha objective is stabilization.",
      activeOutcome: currentOutcome,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Current alpha objective is stabilization.",
    })
    await memoryStore.write({
      agentId: "alpha",
      sessionId: priorAlphaSession.id,
      updatedAt: recentActivityAt,
      wakeId: "wake-prior-alpha",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Alpha prior session summary.",
      activeOutcome: currentOutcome,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Prior alpha response.",
    })
    await memoryStore.write({
      agentId: "alpha",
      sessionId: staleAlphaSession.id,
      updatedAt: staleActivityAt,
      wakeId: "wake-stale-alpha",
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Older alpha session summary.",
      activeOutcome: staleOutcome,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Older alpha response.",
    })
    await memoryStore.write({
      agentId: "beta",
      sessionId: betaSession.id,
      updatedAt: recentActivityAt,
      lastContextEventId: null,
      processedEventIds: [],
      producedEventId: null,
      outcome: "sleep",
      summary: "Beta session summary.",
      activeOutcome: null,
      nextWakeAt: null,
      consecutiveFollowUps: 0,
      queuedWakes: [],
      stopReason: "idle",
      learnings: [],
      responseMessage: "Prior beta response.",
    })
    const currentSessionSnapshot = await store.getSession(currentSession.id)

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment: await new EnvironmentStore(companyDir).ensureDefaultLocalEnvironment(),
      session: currentSessionSnapshot.session,
      wakeId: "manual-session-list",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore,
      sandbox: new LocalSandbox(),
      sandboxEnabled: false,
    })
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
    const requireTool = (name: string) => {
      const tool = toolMap.get(name)
      expect(tool).toBeDefined()
      if (!tool) {
        throw new Error(`tool ${name} was not registered`)
      }
      return tool
    }

    const listText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
    })
    const activeWindowListText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
      activeMinutes: 120,
    })
    const passOnlyListText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
      hasOutcome: true,
      outcomeStatus: "pass",
      promotionReady: true,
    })
    const siblingOnlyListText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
      lineage: "siblings",
    })
    const parentOnlyListText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
      lineage: "parent",
    })
    const snapshotText = await requireTool("session_get_snapshot").execute({
      sessionId: priorAlphaSession.id,
    })
    const parentSnapshotText = await requireTool("session_get_snapshot").execute({
      sessionId: parentAlphaSession.id,
    })
    const priorCheckpointText = await requireTool("memory_read").execute({
      target: "checkpoint",
      sessionId: priorAlphaSession.id,
    })
    const priorWorkingBufferText = await requireTool("memory_read").execute({
      target: "working_buffer",
      sessionId: priorAlphaSession.id,
    })
    const recentOnlyListText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
      activeMinutes: 30,
    })

    expect(listText).toContain(priorAlphaSession.id)
    expect(listText).toContain(staleAlphaSession.id)
    expect(listText).not.toContain(betaSession.id)
    expect(activeWindowListText).toContain(priorAlphaSession.id)
    expect(activeWindowListText).not.toContain(staleAlphaSession.id)
    expect(passOnlyListText).toContain(priorAlphaSession.id)
    expect(passOnlyListText).not.toContain(staleAlphaSession.id)
    expect(passOnlyListText).not.toContain(betaSession.id)
    expect(passOnlyListText).toContain('"outcomeMatchesCurrent": true')
    expect(passOnlyListText).toContain('"promotionReady": true')
    expect(passOnlyListText).toContain('"outcomeStatus": "pass"')
    expect(siblingOnlyListText).toContain(priorAlphaSession.id)
    expect(siblingOnlyListText).not.toContain(staleAlphaSession.id)
    expect(siblingOnlyListText).toContain('"relationToCurrent": "sibling"')
    expect(siblingOnlyListText).not.toContain('"relationToCurrent": "parent"')
    expect(parentOnlyListText).toContain(parentAlphaSession.id)
    expect(parentOnlyListText).not.toContain(priorAlphaSession.id)
    expect(parentOnlyListText).toContain('"relationToCurrent": "parent"')
    expect(parentOnlyListText).toContain('"childCount": 2')
    expect(snapshotText).toContain(priorAlphaSession.id)
    expect(snapshotText).toContain("Alpha prior session summary.")
    expect(snapshotText).toContain('"relationToCurrent": "sibling"')
    expect(snapshotText).toContain('"setupMatchesCurrent": false')
    expect(snapshotText).toContain('"childCount": 0')
    expect(snapshotText).toContain('"createdAt":')
    expect(snapshotText).toContain('"updatedAt":')
    expect(snapshotText).toContain(`"lastActivityAt": "${recentActivityAt}"`)
    expect(snapshotText).toContain('"outcomeGrade": {')
    expect(snapshotText).toContain('"outcomeStatus": "pass"')
    expect(snapshotText).toContain('"promotionReady": true')
    expect(parentSnapshotText).toContain(parentAlphaSession.id)
    expect(parentSnapshotText).toContain('"relationToCurrent": "parent"')
    expect(parentSnapshotText).toContain('"setupMatchesCurrent": false')
    expect(parentSnapshotText).toContain('"childCount": 2')
    expect(parentSnapshotText).toContain('"outcomeStatus": "missing_outcome"')
    expect(parentSnapshotText).toContain('"promotionReady": false')
    expect(priorCheckpointText).toContain("Alpha prior session summary.")
    expect(priorWorkingBufferText).toContain("Current focus: Alpha prior session summary.")
    expect(recentOnlyListText).toContain(priorAlphaSession.id)
    expect(recentOnlyListText).not.toContain(staleAlphaSession.id)
    expect(recentOnlyListText).not.toContain(betaSession.id)
    expect(listText.indexOf(priorAlphaSession.id)).toBeLessThan(
      listText.indexOf(staleAlphaSession.id),
    )
    expect(listText.indexOf(parentAlphaSession.id)).toBeLessThan(
      listText.indexOf(staleAlphaSession.id),
    )

    await expect(
      requireTool("session_get_snapshot").execute({
        sessionId: betaSession.id,
      }),
    ).rejects.toThrow(`Session ${betaSession.id} is not available to agent alpha`)
    await expect(
      requireTool("memory_read").execute({
        target: "checkpoint",
        sessionId: betaSession.id,
      }),
    ).rejects.toThrow(`Session ${betaSession.id} is not available to agent alpha`)
  })

  it("creates and lists bounded child sessions delegated from the current session", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")

    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const learningsStore = new AgentLearningsStore(companyDir)
    const parentSession = await store.createSession({ agentId: "alpha" })

    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment: await new EnvironmentStore(companyDir).ensureDefaultLocalEnvironment(),
      session: parentSession,
      wakeId: "manual-session-delegate",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore,
      sandbox: new LocalSandbox(),
      sandboxEnabled: false,
    })
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
    const requireTool = (name: string) => {
      const tool = toolMap.get(name)
      expect(tool).toBeDefined()
      if (!tool) {
        throw new Error(`tool ${name} was not registered`)
      }
      return tool
    }

    const delegatedText = await requireTool("session_delegate").execute({
      title: "Investigate a child runtime thread",
      detail: "Keep the parent session focused while a child inspects state.",
      successCriteria: ["Child session exists", "Child session has pending work"],
      message: "Inspect the child session runtime hand.",
    })
    const delegated = JSON.parse(delegatedText) as {
      parentSessionId: string
      childSession: {
        sessionId: string
        parentSessionId: string | null
        pendingEventCount: number
        activeOutcome: { title: string } | null
        outcomeGrade?: { status: string } | null
        outcomeStatus?: string | null
        promotionReady?: boolean
        relationToCurrent?: string | null
        childCount?: number
      }
      seededEventIds: string[]
    }

    const childListText = await requireTool("session_list_children").execute({})
    const notReadyChildListText = await requireTool("session_list_children").execute({
      hasOutcome: true,
      outcomeStatus: "not_ready",
      promotionReady: false,
    })
    const parentListText = await requireTool("session_list").execute({
      includeCurrent: true,
      limit: 5,
    })
    const parentSnapshotText = await requireTool("session_get_snapshot").execute({})
    expect(delegated.parentSessionId).toBe(parentSession.id)
    expect(delegated.childSession.parentSessionId).toBe(parentSession.id)
    expect(delegated.childSession.pendingEventCount).toBe(2)
    expect(delegated.childSession.activeOutcome?.title).toBe("Investigate a child runtime thread")
    expect(delegated.childSession.outcomeGrade?.status).toBe("in_progress")
    expect(delegated.childSession.outcomeStatus).toBe("not_ready")
    expect(delegated.childSession.promotionReady).toBe(false)
    expect(delegated.childSession.relationToCurrent).toBe("child")
    expect(delegated.childSession.childCount).toBe(0)
    expect(delegated.seededEventIds).toHaveLength(2)
    expect(childListText).toContain(delegated.childSession.sessionId)
    expect(childListText).toContain(`"parentSessionId": "${parentSession.id}"`)
    expect(childListText).toContain('"agentSetupFingerprint":')
    expect(childListText).toContain('"relationToCurrent": "child"')
    expect(childListText).toContain('"childCount": 0')
    expect(notReadyChildListText).toContain(delegated.childSession.sessionId)
    expect(notReadyChildListText).toContain('"promotionReady": false')
    expect(parentListText).toContain(`"sessionId": "${parentSession.id}"`)
    expect(parentListText).toContain('"childCount": 1')
    expect(parentListText).toContain('"outcomeStatus": "missing_outcome"')
    expect(parentListText).toContain('"promotionReady": false')
    expect(parentSnapshotText).toContain('"childCount": 1')

    const childSnapshot = await store.getSession(delegated.childSession.sessionId)
    expect(childSnapshot.session.metadata?.parentSessionId).toBe(parentSession.id)
    expect(childSnapshot.events.map((event) => event.type)).toEqual([
      "user.define_outcome",
      "user.message",
    ])
  })

  it("runs a delegated child session through bounded same-agent cycles", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")

    const store = new SessionStore(companyDir)
    const parentSession = await store.createSession({ agentId: "alpha" })

    const harness = new AgentHarness(companyDir, {
      runner: {
        async run() {
          return {
            response:
              'Child handled delegated work.\n<openboa-session-loop>{"outcome":"sleep","summary":"Child completed its bounded task.","followUpSeconds":null}</openboa-session-loop>',
            authMode: "none",
            provider: "openai-codex",
            model: "gpt-5.4",
            runner: "embedded",
          }
        },
      },
      authProvider: {
        async resolve() {
          return NONE_AUTH
        },
      },
    })
    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment: await new EnvironmentStore(companyDir).ensureDefaultLocalEnvironment(),
      session: parentSession,
      wakeId: "manual-session-run-child",
      pendingEvents: [],
      sessionStore: store,
      memoryStore: new RuntimeMemoryStore(companyDir),
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: false,
      onRunChildSession: async ({ childSessionId, maxCycles }) => {
        const runtimeHarness = harness as unknown as {
          run: (
            sessionId: string,
            wakeContext?: { reason: string; note: string | null } | null,
          ) => Promise<{
            session: Session
            response: string | null
            stopReason: string
            queuedWakes: Array<{
              reason: string
              dueAt: string
              note: string | null
              dedupeKey: string | null
              priority: "low" | "normal" | "high"
            }>
            processedEventIds: string[]
          }>
        }
        const wakeQueue = new SessionWakeQueue(companyDir, store)
        const loop = await runSessionLoop({
          sessionId: childSessionId,
          maxCycles,
          sessionStore: store,
          wakeQueue,
          runHarness: (targetSessionId, wakeContext) =>
            runtimeHarness.run(targetSessionId, wakeContext),
        })
        return {
          cycles: loop.cycles,
          executed: loop.executed,
          loopStopReason: loop.stopReason,
          session: loop.finalSession,
          response: loop.lastWake?.response ?? null,
          childStopReason: loop.finalSession.stopReason,
          queuedWakeIds: loop.lastWake?.queuedWakeIds ?? [],
          processedEventIds: loop.lastWake?.processedEventIds ?? [],
        }
      },
    })
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
    const requireTool = (name: string) => {
      const tool = toolMap.get(name)
      expect(tool).toBeDefined()
      if (!tool) {
        throw new Error(`tool ${name} was not registered`)
      }
      return tool
    }

    const delegatedText = await requireTool("session_delegate").execute({
      title: "Run a delegated child session",
      message: "Summarize your delegated work and stop.",
    })
    const delegated = JSON.parse(delegatedText) as {
      childSession: { sessionId: string }
    }
    const runChildText = await requireTool("session_run_child").execute({
      sessionId: delegated.childSession.sessionId,
      maxCycles: 2,
    })

    expect(runChildText).toContain(`"sessionId": "${delegated.childSession.sessionId}"`)
    expect(runChildText).toContain('"executedCycles": 1')
    expect(runChildText).toContain('"loopStopReason": "idle"')
    expect(runChildText).toContain('"childStopReason": "idle"')
    expect(runChildText).toContain("Child completed its bounded task.")

    const childSnapshot = await store.getSession(delegated.childSession.sessionId)
    const parentSnapshot = await store.getSession(parentSession.id)
    expect(childSnapshot.session.metadata?.parentSessionId).toBe(parentSession.id)
    expect(childSnapshot.session.stopReason).toBe("idle")
    expect(childSnapshot.events.some((event) => event.type === "agent.message")).toBe(true)
    expect(parentSnapshot.events.some((event) => event.type === "session.child_created")).toBe(true)
    expect(parentSnapshot.events.some((event) => event.type === "session.child_idle")).toBe(true)
    const childRelationsPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      delegated.childSession.sessionId,
      "workspace",
      ".openboa-runtime",
      "session-relations.json",
    )
    expect(await readFile(childRelationsPath, "utf8")).toContain(
      `"parentSessionId": "${parentSession.id}"`,
    )
  })

  it("surfaces requires-action posture in session snapshots and same-agent lists", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")

    const store = new SessionStore(companyDir)
    const memoryStore = new RuntimeMemoryStore(companyDir)
    const currentSession = await store.createSession({ agentId: "alpha" })
    const blockedSession = await store.createSession({ agentId: "alpha" })
    const idleSession = await store.createSession({ agentId: "alpha" })

    await store.updateSession(blockedSession.id, (session) => ({
      ...session,
      status: "requires_action",
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-blocked-shell",
        toolName: "shell_run",
        input: { command: "pwd" },
        reason: "Need confirmation before running shell mutation.",
        requestedAt: "2026-04-10T12:00:00.000Z",
      },
      updatedAt: "2026-04-10T12:00:00.000Z",
    }))
    await store.updateSession(idleSession.id, (session) => ({
      ...session,
      updatedAt: "2026-04-10T11:30:00.000Z",
    }))

    const environment = await new EnvironmentStore(companyDir).ensureDefaultLocalEnvironment()
    const tools = await buildManagedRuntimeTools({
      companyDir,
      environment,
      session: currentSession,
      wakeId: "manual-session-requires-action",
      pendingEvents: [],
      sessionStore: store,
      memoryStore,
      learningsStore: new AgentLearningsStore(companyDir),
      sandbox: new LocalSandbox(),
      sandboxEnabled: false,
    })
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
    const requireTool = (name: string) => {
      const tool = toolMap.get(name)
      expect(tool).toBeDefined()
      if (!tool) {
        throw new Error(`tool ${name} was not registered`)
      }
      return tool
    }

    const blockedSnapshotText = await requireTool("session_get_snapshot").execute({
      sessionId: blockedSession.id,
    })
    const listText = await requireTool("session_list").execute({
      includeCurrent: false,
      limit: 10,
    })

    expect(blockedSnapshotText).toContain(`"sessionId": "${blockedSession.id}"`)
    expect(blockedSnapshotText).toContain('"requiresAction": true')
    expect(blockedSnapshotText).toContain('"pendingActionKind": "tool_confirmation"')
    expect(blockedSnapshotText).toContain('"pendingActionToolName": "shell_run"')
    expect(listText).toContain(`"sessionId": "${blockedSession.id}"`)
    expect(listText).toContain('"requiresAction": true')
    expect(listText).toContain('"pendingActionKind": "tool_confirmation"')
    expect(listText).toContain('"pendingActionToolName": "shell_run"')
    expect(listText.indexOf(blockedSession.id)).toBeLessThan(listText.indexOf(idleSession.id))
  })
})
