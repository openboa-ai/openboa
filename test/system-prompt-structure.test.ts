import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "../src/agents/environment/bootstrap.js"
import { buildRuntimeEnvironmentPrompt } from "../src/agents/environment/runtime-environment.js"
import {
  buildHarnessMessage,
  buildHarnessSystemPromptAppendix,
} from "../src/agents/runtime/loop-directive.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("agent system prompt structure", () => {
  it("wraps bootstrap prompt sources in explicit XML-style sections", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")

    const prompt = await buildSystemPrompt(companyDir, "alpha")

    expect(prompt).toContain("<openboa-bootstrap-system>")
    expect(prompt).toContain("<workspace-bootstrap-section")
    expect(prompt).toContain("</openboa-bootstrap-system>")
  })

  it("wraps runtime environment prompt sections explicitly", async () => {
    const prompt = await buildRuntimeEnvironmentPrompt({
      companyDir: "/tmp/openboa-runtime-prompt",
      provider: "openai-codex",
      model: "gpt-5.4",
      environmentId: "local-default",
      environmentName: "Local Default",
      resources: [
        {
          id: "resource-workspace",
          kind: "session_workspace",
          sourceRef: "session://workspace",
          mountPath: "/workspace",
          access: "read_write",
          metadata: {
            prompt: "Use this as the writable execution hand.",
          },
        },
      ],
    })

    expect(prompt).toContain("<runtime-environment>")
    expect(prompt).toContain("<runtime-environment-summary>")
    expect(prompt).toContain("<mounted-resources>")
    expect(prompt).toContain("prompt=Use this as the writable execution hand.")
    expect(prompt).toContain("</runtime-environment>")
  })

  it("wraps harness guidance and session wake messages in explicit sections", () => {
    const appendix = buildHarnessSystemPromptAppendix()
    const message = buildHarnessMessage({
      sessionId: "session-1",
      sessionParentId: "parent-1",
      directChildCount: 2,
      stopReason: "requires_action",
      pendingEvents: ["user.message: Continue from the last approved step."],
      latestSummary: "The session is waiting on a bounded confirmation step.",
      latestResponse: "Need approval before promoting the draft.",
      runtimeSessionState: "Current durable state",
      runtimeWorkingBuffer: "Open loop notes",
      runtimeShellState: {
        cwd: "/workspace",
        envKeyCount: 1,
        envKeys: ["SESSION_FLAG"],
        persistentShell: {
          shellId: "shell-1",
          status: "active",
          commandCount: 2,
          busy: true,
          currentCommand: "sleep 1 && printf done",
          currentCommandStartedAt: "2026-04-10T00:00:03.000Z",
        },
        recentCommandCount: 1,
        lastCommand: {
          command: "pwd",
          cwd: "/workspace",
          exitCode: 0,
          timedOut: false,
          outputPreview: "command=pwd\ncwd=/workspace",
        },
      },
      activeOutcome: {
        title: "Ship the bounded agent runtime",
        detail: "Close the managed permission loop.",
        successCriteria: ["Tool confirmation pauses", "Resumes after approval"],
      },
      outcomeGrade: {
        status: "in_progress",
        confidence: "medium",
        summary: "The runtime is moving but completion is not yet proven.",
        matchedCriteria: 1,
        totalCriteria: 2,
        evidence: ["Matched criteria: 1/2", "Stop reason: requires_action"],
        nextSuggestedTool: {
          tool: "session_get_trace",
          args: { sessionId: "session-1" },
          rationale: "Inspect the latest wake trace before the next bounded move.",
        },
      },
      outcomeEvaluation: {
        status: "not_ready",
        confidence: "medium",
        promotionReady: false,
        summary: "The session still has active work, so promotion should wait.",
        evidence: ["Matched criteria: 1/2", "Stop reason: requires_action"],
        nextSuggestedTool: {
          tool: "session_get_trace",
          args: { sessionId: "session-1" },
          rationale: "Inspect the latest wake trace before promotion.",
        },
      },
      pendingToolConfirmationRequest: {
        id: "confirm-1",
        toolName: "resources_promote_to_substrate",
      },
    })

    expect(appendix).toContain("<harness-guidance>")
    expect(appendix).toContain("user.tool_confirmation")
    expect(appendix).toContain(
      "call the managed tool directly instead of asking for confirmation in plain text",
    )
    expect(appendix).toContain(
      "If the user explicitly names a managed tool and asks you to use it, call that exact tool",
    )
    expect(appendix).toContain("Bootstrap substrate files such as AGENTS.md, SOUL.md")
    expect(appendix).toContain(
      "Do not use shell_run or shell_exec for read-only bootstrap inspection.",
    )
    expect(appendix).toContain(
      "preserve the exact full line text including leading markdown markers, punctuation, and capitalization",
    )
    expect(appendix).toContain(
      "If the user explicitly asks for a reminder, follow-up, or revisit after a delay, emit queuedWakes for that delayed work",
    )
    expect(appendix).toContain("</harness-guidance>")
    expect(message).toContain("<session-wake>")
    expect(message).toContain("<session-relations>")
    expect(message).toContain("parent-1")
    expect(message).toContain("directChildCount: 2")
    expect(message).toContain("<pending-events>")
    expect(message).toContain("<active-outcome>")
    expect(message).toContain("<outcome-grade>")
    expect(message).toContain("<outcome-evaluation>")
    expect(message).toContain("status: in_progress")
    expect(message).toContain("promotionReady: false")
    expect(message).toContain("<runtime-session-state>")
    expect(message).toContain("<runtime-working-buffer>")
    expect(message).toContain("envKeys: 1 (SESSION_FLAG)")
    expect(message).toContain("persistentShell: active (shell-1, commands=2, busy=true)")
    expect(message).toContain("currentShellCommand: sleep 1 && printf done")
    expect(message).toContain("</session-wake>")
  })
})
