import { access, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { stageSubstrateArtifactToSessionWorkspace } from "../src/agents/resources/resource-access.js"
import { AgentTurnRunner } from "../src/agents/runners/agent-runner.js"
import { ActivationJournal } from "../src/agents/runtime/activation-journal.js"
import { AgentOrchestration } from "../src/agents/runtime/orchestration.js"
import { SessionWakeQueue } from "../src/agents/runtime/session-wake-queue.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { CHAT_REDACTED_MESSAGE_BODY } from "../src/chat/core/model.js"
import { ChatCommandService } from "../src/chat/policy/command-service.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

let stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true)

describe("runCli", () => {
  let cwd: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    cwd = await createCompanyFixture()
    await createOfflineCodexAgent(cwd, "pi-agent")
    process.chdir(cwd)
    stdoutWrite.mockClear()
  })

  afterEach(() => {
    stdoutWrite.mockClear()
  })

  it("prints auth login usage with supported provider aliases", async () => {
    const { runCli } = await import("../src/index.js")
    await expect(runCli([])).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("openboa auth login [--provider <codex|openai-codex|claude-cli|both>]")
  })

  it("creates a session, sends an event, and wakes it through the session-first CLI", async () => {
    vi.spyOn(AgentTurnRunner.prototype, "run").mockResolvedValue({
      response:
        'Hello.\n<openboa-session-loop>{"outcome":"sleep","summary":"Handled the session.","followUpSeconds":null}</openboa-session-loop>',
      authMode: "none",
      provider: "openai-codex",
      model: "gpt-5.4",
      runner: "embedded",
    })

    const { runCli } = await import("../src/index.js")
    await expect(
      runCli(["agent", "session", "create", "--name", "pi-agent"]),
    ).resolves.toBeUndefined()
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionMatch = createOutput.match(/session:\s+([0-9a-f-]{36})/i)
    const sessionId = String(sessionMatch?.[1] ?? "")
    expect(sessionId).toHaveLength(36)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "session",
        "send",
        "--session",
        sessionId,
        "--message",
        "hello from founder",
      ]),
    ).resolves.toBeUndefined()
    expect(stdoutWrite.mock.calls.map((call) => String(call[0])).join("")).toContain(
      "session event appended",
    )

    stdoutWrite.mockClear()
    await expect(runCli(["agent", "wake", "--session", sessionId])).resolves.toBeUndefined()
    const wakeOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(wakeOutput).toContain("Hello.")
    expect(wakeOutput).toContain("wake: executed")
    expect(wakeOutput).toContain("activationRequeued: false")
  })

  it("prints session status and events", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")

    stdoutWrite.mockClear()
    await runCli([
      "agent",
      "session",
      "send",
      "--session",
      sessionId,
      "--message",
      "show me status",
    ])

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("session status")
    expect(statusOutput).toContain("status: rescheduling")
    expect(statusOutput).toContain("stopReason: rescheduling")
    expect(statusOutput).toContain("pendingEvents: 1")
    expect(statusOutput).toContain("runnablePendingEvent: user.message")
    expect(statusOutput).toContain("nextRetryAt: none")
    expect(statusOutput).toContain("retryStreak: 0")
    expect(statusOutput).toContain("pendingQueuedWakes: 0")
    expect(statusOutput).toContain("nextQueuedWakeAt: none")
    expect(statusOutput).toContain("activeWakeLeaseOwner: none")
    expect(statusOutput).toContain("resilienceProfile: resilient")
    expect(statusOutput).toContain("resilienceRecoverableWakeRetryDelayMs: 5000")
    expect(statusOutput).toContain("resilienceWakeFailureReplayDelayMs: 2000")
    expect(statusOutput).toContain("resiliencePendingEventBackoffBaseMs: 2000")
    expect(statusOutput).toContain("resiliencePendingEventBackoffMaxMs: 30000")
    expect(statusOutput).toContain("stagedSubstrateDrafts: 0")

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "events", "--session", sessionId, "--limit", "5"]),
    ).resolves.toBeUndefined()
    const eventsOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(eventsOutput).toContain("session events:")
    expect(eventsOutput).toContain("user.message")
  })

  it("backfills legacy agent workspace bootstrap files when creating a session", async () => {
    const workspaceDir = join(cwd, ".openboa", "agents", "pi-agent", "workspace")
    await rm(workspaceDir, { recursive: true, force: true })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "create", "--name", "pi-agent"]),
    ).resolves.toBeUndefined()

    await expect(access(join(workspaceDir, "MEMORY.md"))).resolves.toBeUndefined()
    await expect(access(join(workspaceDir, "AGENTS.md"))).resolves.toBeUndefined()
  })

  it("prints retry, queued wake, and active lease details in session status", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    const sessionStore = new SessionStore(cwd)
    const wakeQueue = new SessionWakeQueue(cwd, sessionStore)
    await sessionStore.emitEvent(sessionId, {
      id: "event_defer_status_1",
      type: "user.message",
      createdAt: "2026-04-12T00:00:00.000Z",
      processedAt: null,
      message: "retry me",
    })
    await sessionStore.deferRunnableSession(sessionId, "2026-04-12T00:05:00.000Z")
    const lease = await sessionStore.acquireWakeLease(sessionId, "worker://status-test")
    expect(lease).not.toBeNull()
    await wakeQueue.enqueue({
      sessionId,
      dueAt: "2026-04-12T00:10:00.000Z",
      reason: "follow-up",
      note: "pending retry wake",
      dedupeKey: null,
      priority: "normal",
    })

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("runnablePendingEvent: user.message")
    expect(statusOutput).toContain("nextRetryAt: 2026-04-12T00:05:00.000Z")
    expect(statusOutput).toContain("retryStreak: 0")
    expect(statusOutput).toContain("pendingQueuedWakes: 1")
    expect(statusOutput).toContain("nextQueuedWakeAt: 2026-04-12T00:10:00.000Z")
    expect(statusOutput).toContain("activeWakeLeaseOwner: worker://status-test")
    expect(statusOutput).toContain("activeWakeLeaseAcquiredAt:")
    expect(statusOutput).toContain("resilienceProfile: resilient")
    expect(statusOutput).toContain("resilienceRecoverableWakeRetryDelayMs: 5000")
    expect(statusOutput).toContain("resilienceWakeFailureReplayDelayMs: 2000")
    expect(statusOutput).toContain("resiliencePendingEventBackoffBaseMs: 2000")
    expect(statusOutput).toContain("resiliencePendingEventBackoffMaxMs: 30000")
    expect(statusOutput).toContain("stagedSubstrateDrafts: 0")

    await lease?.release()
  })

  it("prints staged substrate draft status in session status", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    const store = new SessionStore(cwd)
    const session = (await store.getSession(sessionId)).session
    await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "SOUL.md",
      targetPath: "drafts/SOUL.md",
      overwrite: true,
    })

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("stagedSubstrateDrafts: 1")
    expect(statusOutput).toContain(
      "stagedDraft[1]: sessionPath=drafts/SOUL.md substratePath=SOUL.md status=in_sync",
    )
    expect(statusOutput).toContain("sourceChanged=false")
    expect(statusOutput).toContain("draftChanged=false")
  })

  it("prints the latest requeued activation details in session status", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    const store = new SessionStore(cwd)
    const journal = new ActivationJournal(store)
    const activation = {
      sessionId,
      agentId: "pi-agent",
      kind: "pending_events" as const,
      priority: "high" as const,
      dueAt: null,
      reason: "user.message",
      note: null,
      dueWakes: [],
    }

    await journal.recordLeased({
      agentId: "pi-agent",
      leaseOwner: "worker://status-requeue",
      claimId: "claim-status-requeue",
      activation,
    })
    await journal.recordRequeued({
      agentId: "pi-agent",
      leaseOwner: "worker://status-requeue",
      claimId: "claim-status-requeue",
      activation,
      requeue: {
        immediateRetryAt: "2026-04-12T00:05:00.000Z",
        nextQueuedWakeAt: "2026-04-12T00:10:00.000Z",
        queuedWakeIds: ["wake_status_requeue_1", "wake_status_requeue_2"],
      },
    })

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("lastActivationKind: activation.requeued")
    expect(statusOutput).toContain("lastActivationClaimId: claim-status-requeue")
    expect(statusOutput).toContain("lastActivationReason: user.message")
    expect(statusOutput).toContain("lastActivationLeaseOwner: worker://status-requeue")
    expect(statusOutput).toContain("lastActivationImmediateRetryAt: 2026-04-12T00:05:00.000Z")
    expect(statusOutput).toContain("lastActivationNextQueuedWakeAt: 2026-04-12T00:10:00.000Z")
    expect(statusOutput).toContain(
      "lastActivationQueuedWakeIds: wake_status_requeue_1, wake_status_requeue_2",
    )
  })

  it("prints the latest abandoned activation details in session status", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    const store = new SessionStore(cwd)
    const journal = new ActivationJournal(store)
    const activation = {
      sessionId,
      agentId: "pi-agent",
      kind: "queued_wake" as const,
      priority: "normal" as const,
      dueAt: "2026-04-12T00:10:00.000Z",
      reason: "follow-up",
      note: "resume later",
      dueWakes: [],
    }

    await journal.recordLeased({
      agentId: "pi-agent",
      leaseOwner: "worker://status-abandon",
      claimId: "claim-status-abandon",
      activation,
    })
    await journal.recordAbandoned({
      agentId: "pi-agent",
      leaseOwner: "worker://status-abandon",
      claimId: "claim-status-abandon",
      activation,
      abandon: {
        reason: "provider_error",
        errorMessage: "model call timed out",
      },
    })

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("lastActivationKind: activation.abandoned")
    expect(statusOutput).toContain("lastActivationClaimId: claim-status-abandon")
    expect(statusOutput).toContain("lastActivationReason: follow-up")
    expect(statusOutput).toContain("lastActivationLeaseOwner: worker://status-abandon")
    expect(statusOutput).toContain("lastActivationAbandonReason: provider_error")
    expect(statusOutput).toContain("lastActivationError: model call timed out")
  })

  it("prints activation journal entries for an agent", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    const store = new SessionStore(cwd)
    const journal = new ActivationJournal(store)

    await journal.recordLeased({
      agentId: "pi-agent",
      leaseOwner: "worker-1",
      claimId: "claim-cli-1",
      activation: {
        sessionId,
        agentId: "pi-agent",
        kind: "pending_events",
        priority: "high",
        dueAt: null,
        reason: "user.message",
        note: null,
        dueWakes: [],
      },
    })
    await journal.recordAcked({
      agentId: "pi-agent",
      leaseOwner: "worker-1",
      claimId: "claim-cli-1",
      activation: {
        sessionId,
        agentId: "pi-agent",
        kind: "pending_events",
        priority: "high",
        dueAt: null,
        reason: "user.message",
        note: null,
        dueWakes: [],
      },
      ack: {
        wakeId: "wake-cli-1",
        stopReason: "idle",
        queuedWakeIds: [],
        processedEventIds: ["event-cli-1"],
      },
    })
    await journal.recordRequeued({
      agentId: "pi-agent",
      leaseOwner: "worker-1",
      claimId: "claim-cli-1",
      activation: {
        sessionId,
        agentId: "pi-agent",
        kind: "pending_events",
        priority: "high",
        dueAt: null,
        reason: "user.message",
        note: null,
        dueWakes: [],
      },
      requeue: {
        immediateRetryAt: "2026-04-12T00:05:00.000Z",
        nextQueuedWakeAt: "2026-04-12T00:10:00.000Z",
        queuedWakeIds: ["wake-follow-up-cli-1"],
      },
    })

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "activation-events", "--agent", "pi-agent", "--limit", "5"]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("activation events: pi-agent")
    expect(output).toContain("activation.leased")
    expect(output).toContain("activation.acked")
    expect(output).toContain("activation.requeued")
    expect(output).toContain("claim=claim-cli-1")
    expect(output).toContain("wakeId=wake-cli-1")
    expect(output).toContain("processedEvents=1")
    expect(output).toContain("immediateRetryAt=2026-04-12T00:05:00.000Z")
    expect(output).toContain("nextQueuedWakeAt=2026-04-12T00:10:00.000Z")
    expect(output).toContain("queuedWakes=1")
  })

  it("filters activation journal entries by session and claim", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const firstCreateOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const firstSessionId = String(firstCreateOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    stdoutWrite.mockClear()
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const secondCreateOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const secondSessionId = String(
      secondCreateOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "",
    )

    const store = new SessionStore(cwd)
    const journal = new ActivationJournal(store)
    const firstActivation = {
      sessionId: firstSessionId,
      agentId: "pi-agent",
      kind: "pending_events" as const,
      priority: "high" as const,
      dueAt: null,
      reason: "user.message",
      note: null,
      dueWakes: [],
    }
    const secondActivation = {
      sessionId: secondSessionId,
      agentId: "pi-agent",
      kind: "queued_wake" as const,
      priority: "medium" as const,
      dueAt: "2026-04-12T00:20:00.000Z",
      reason: "follow-up",
      note: "retry",
      dueWakes: [],
    }

    await journal.recordLeased({
      agentId: "pi-agent",
      leaseOwner: "worker-a",
      claimId: "claim-filter-1",
      activation: firstActivation,
    })
    await journal.recordAcked({
      agentId: "pi-agent",
      leaseOwner: "worker-a",
      claimId: "claim-filter-1",
      activation: firstActivation,
      ack: {
        wakeId: "wake-filter-1",
        stopReason: "idle",
        queuedWakeIds: [],
        processedEventIds: ["event-filter-1"],
      },
    })
    await journal.recordLeased({
      agentId: "pi-agent",
      leaseOwner: "worker-b",
      claimId: "claim-filter-2",
      activation: secondActivation,
    })
    await journal.recordAbandoned({
      agentId: "pi-agent",
      leaseOwner: "worker-b",
      claimId: "claim-filter-2",
      activation: secondActivation,
      abandon: {
        reason: "wake_failed",
        errorMessage: "timed out",
      },
    })

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "activation-events", "--agent", "pi-agent", "--session", secondSessionId]),
    ).resolves.toBeUndefined()
    const sessionOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(sessionOutput).toContain(`activation events: pi-agent\n- session: ${secondSessionId}`)
    expect(sessionOutput).toContain("claim=claim-filter-2")
    expect(sessionOutput).toContain(`session=${secondSessionId}`)
    expect(sessionOutput).not.toContain("claim=claim-filter-1")

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "activation-events", "--agent", "pi-agent", "--claim", "claim-filter-1"]),
    ).resolves.toBeUndefined()
    const claimOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(claimOutput).toContain("activation events: pi-agent\n- claim: claim-filter-1")
    expect(claimOutput).toContain(`session=${firstSessionId}`)
    expect(claimOutput).toContain("claim=claim-filter-1")
    expect(claimOutput).not.toContain("claim=claim-filter-2")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "activation-events",
        "--agent",
        "pi-agent",
        "--kind",
        "activation.abandoned",
      ]),
    ).resolves.toBeUndefined()
    const kindOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(kindOutput).toContain("activation events: pi-agent\n- kinds: activation.abandoned")
    expect(kindOutput).toContain("claim=claim-filter-2")
    expect(kindOutput).toContain("activation.abandoned")
    expect(kindOutput).not.toContain("claim=claim-filter-1")
    expect(kindOutput).not.toContain("activation.acked")
  })

  it("rejects invalid activation event kind filters", async () => {
    const { runCli } = await import("../src/index.js")
    await expect(
      runCli(["agent", "activation-events", "--agent", "pi-agent", "--kind", "activation.unknown"]),
    ).rejects.toThrow("invalid activation event kind: activation.unknown")
  })

  it("prints pending tool confirmation details in session status", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")

    const sessionPath = join(
      cwd,
      ".openboa",
      "agents",
      "pi-agent",
      "sessions",
      sessionId,
      "session.json",
    )
    const session = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>
    session.pendingToolConfirmationRequest = {
      id: "request_shell_run_status",
      toolName: "shell_run",
      ownership: "managed",
      permissionPolicy: "always_ask",
      input: {},
      requestedAt: "2026-04-12T00:00:00.000Z",
    }
    await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8")

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("pendingToolConfirmation: shell_run")
    expect(statusOutput).toContain("pendingToolRequestId: request_shell_run_status")
    expect(statusOutput).toContain("pendingToolPermission: always_ask")
    expect(statusOutput).toContain("pendingToolRequestedAt: 2026-04-12T00:00:00.000Z")
  })

  it("prints pending custom tool details in session status", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")

    const sessionPath = join(
      cwd,
      ".openboa",
      "agents",
      "pi-agent",
      "sessions",
      sessionId,
      "session.json",
    )
    const session = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>
    session.pendingCustomToolRequest = {
      id: "request_fetch_spec_status",
      name: "fetch_spec",
      input: { path: "spec.md" },
      requestedAt: "2026-04-12T00:00:00.000Z",
    }
    await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8")

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "status", "--session", sessionId]),
    ).resolves.toBeUndefined()
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("pendingCustomTool: fetch_spec")
    expect(statusOutput).toContain("pendingCustomToolRequestId: request_fetch_spec_status")
    expect(statusOutput).toContain("pendingCustomToolRequestedAt: 2026-04-12T00:00:00.000Z")
    expect(statusOutput).toContain('pendingCustomToolInput: {"path":"spec.md"}')
    expect(statusOutput).toContain(
      `submitCustomToolResult: pnpm openboa agent session custom-tool-result --session ${sessionId} --request request_fetch_spec_status --output '<result>'`,
    )
  })

  it("appends a custom tool result event from the CLI", async () => {
    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")

    const sessionPath = join(
      cwd,
      ".openboa",
      "agents",
      "pi-agent",
      "sessions",
      sessionId,
      "session.json",
    )
    const session = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>
    session.pendingCustomToolRequest = {
      id: "request_fetch_spec_cli",
      name: "fetch_spec",
      input: { path: "spec.md" },
      requestedAt: "2026-04-12T00:00:00.000Z",
    }
    await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "session",
        "custom-tool-result",
        "--session",
        sessionId,
        "--request",
        "request_fetch_spec_cli",
        "--output",
        "spec contents",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("session event appended")
    expect(output).toContain("event: user.custom_tool_result")
    expect(output).toContain("request: request_fetch_spec_cli")
    expect(output).toContain("tool: fetch_spec")

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "session", "events", "--session", sessionId, "--limit", "5"]),
    ).resolves.toBeUndefined()
    const eventsOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(eventsOutput).toContain(
      "user.custom_tool_result fetch_spec request=request_fetch_spec_cli",
    )
    expect(eventsOutput).toContain('output="spec contents"')
  })

  it("runs the orchestrator and stops when idle", async () => {
    vi.spyOn(AgentTurnRunner.prototype, "run").mockResolvedValue({
      response:
        'Done.\n<openboa-session-loop>{"outcome":"sleep","summary":"Handled the session.","followUpSeconds":null}</openboa-session-loop>',
      authMode: "none",
      provider: "openai-codex",
      model: "gpt-5.4",
      runner: "embedded",
    })

    const { runCli } = await import("../src/index.js")
    await runCli(["agent", "session", "create", "--name", "pi-agent"])
    const sessionId = String(
      stdoutWrite.mock.calls
        .map((call) => String(call[0]))
        .join("")
        .match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "",
    )

    stdoutWrite.mockClear()
    await runCli([
      "agent",
      "session",
      "send",
      "--session",
      sessionId,
      "--message",
      "work this once",
    ])

    stdoutWrite.mockClear()
    await expect(
      runCli(["agent", "orchestrator", "--agent", "pi-agent", "--max-cycles", "3"]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("orchestrator: stopped")
    expect(output).toContain("stopReason: idle")
  })

  it("prints skippedReason when a manual wake is a no-op", async () => {
    const wake = vi.spyOn(AgentOrchestration.prototype, "wake").mockResolvedValue({
      session: {
        id: "session_noop_1",
        agentId: "pi-agent",
        environmentId: "local-default",
        status: "rescheduling",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        usage: { turns: 0 },
        resources: [],
        stopReason: "rescheduling",
        pendingCustomToolRequest: null,
        pendingToolConfirmationRequest: null,
        metadata: {},
      },
      wakeId: null,
      executed: false,
      skippedReason: "lease_contended",
      response: null,
      responsePreview: null,
      stopReason: "rescheduling",
      queuedWakeIds: [],
      queuedWakeSummaries: [],
      requeue: null,
      processedEventIds: [],
      consumedInputs: [],
      wakeEvents: [],
    })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(runCli(["agent", "wake", "--session", "session_noop_1"])).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("wake: no-op")
    expect(output).toContain("skippedReason: lease_contended")

    wake.mockRestore()
  })

  it("prints watch-mode activity while the orchestrator is running", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await options?.onActivity?.({
          cycle: 1,
          sessionId: "session_watch_1",
          activationClaimId: "claim_watch_1",
          wakeId: "wake_watch_1",
          stopReason: "idle",
          processedEventCount: 1,
          queuedWakeCount: 1,
          runnablePendingEventType: null,
          deferUntil: null,
          failureStreak: 0,
          pendingWakeCount: 1,
          nextQueuedWakeAt: "2026-04-12T00:00:02.000Z",
          requeue: {
            immediateRetryAt: "2026-04-12T00:00:01.500Z",
            nextQueuedWakeAt: "2026-04-12T00:00:02.000Z",
            queuedWakeIds: ["wake_followup_1"],
          },
          queuedWakeSummaries: [
            {
              id: "wake_followup_1",
              dueAt: "2026-04-12T00:00:02.000Z",
              reason: "Repeat agent name as requested",
              note: "Tell the user the agent name again without waiting for another user message.",
              priority: "normal",
            },
          ],
          consumedInputs: ["user.message: Read your current AGENTS.md"],
          responsePreview: "You are pi-agent. Keep changes bounded.",
          pendingToolConfirmation: null,
          pendingCustomTool: null,
          wakeEvents: [],
        })
        return {
          cycles: 2,
          executed: 1,
          stopReason: "idle_timeout",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "250",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("orchestrator: watching")
    expect(output).toContain("pollIntervalMs: 50")
    expect(output).toContain("idleTimeoutMs: 250")
    expect(output).toContain("orchestrator: activity")
    expect(output).toContain("session: session_watch_1")
    expect(output).toContain("activationClaimId: claim_watch_1")
    expect(output).toContain("processedEvents: 1")
    expect(output).toContain("queuedWakes: 1")
    expect(output).toContain("runnablePendingEvent: none")
    expect(output).toContain("nextRetryAt: none")
    expect(output).toContain("pendingQueuedWakes: 1")
    expect(output).toContain("nextQueuedWakeAt: 2026-04-12T00:00:02.000Z")
    expect(output).toContain("activationRequeued: true")
    expect(output).toContain("activationImmediateRetryAt: 2026-04-12T00:00:01.500Z")
    expect(output).toContain("activationNextQueuedWakeAt: 2026-04-12T00:00:02.000Z")
    expect(output).toContain("activationQueuedWakeIds: wake_followup_1")
    expect(output).toContain(
      "queuedWake[1]: dueAt=2026-04-12T00:00:02.000Z priority=normal reason=Repeat agent name as requested note=Tell the user the agent name again without waiting for another user message.",
    )
    expect(output).toContain("input[1]: user.message: Read your current AGENTS.md")
    expect(output).toContain("responsePreview: You are pi-agent. Keep changes bounded.")
    expect(output).toContain("orchestrator: stopped")
    expect(output).toContain("stopReason: idle_timeout")

    runAgentLoop.mockRestore()
  })

  it("treats --idle-timeout-ms 0 as no idle timeout in watch mode", async () => {
    const runAgentLoop = vi.spyOn(AgentOrchestration.prototype, "runAgentLoop").mockResolvedValue({
      cycles: 1,
      executed: 0,
      stopReason: "interrupted",
    })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "0",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("orchestrator: watching")
    expect(output).toContain("pollIntervalMs: 50")
    expect(output).toContain("idleTimeoutMs: none")
    expect(runAgentLoop).toHaveBeenCalledWith(
      "pi-agent",
      expect.objectContaining({
        watch: true,
        pollIntervalMs: 50,
        idleTimeoutMs: undefined,
      }),
    )

    runAgentLoop.mockRestore()
  })

  it("stops watch mode cleanly on SIGINT instead of bubbling a shell exit code", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve()
            return
          }
          options?.signal?.addEventListener("abort", () => resolve(), { once: true })
        })
        return {
          cycles: 1,
          executed: 0,
          stopReason: "interrupted",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    const interrupt = setTimeout(() => {
      process.emit("SIGINT")
    }, 0)

    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "0",
      ]),
    ).resolves.toBeUndefined()
    clearTimeout(interrupt)

    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("orchestrator: watching")
    expect(output).toContain("stopReason: interrupted")

    runAgentLoop.mockRestore()
  })

  it("runs the live scenario-loop command through the CLI surface", async () => {
    const scenarioLoopModule = await import("../src/agents/runtime/scenario-loop.js")
    const runAgentScenarioLoop = vi
      .spyOn(scenarioLoopModule, "runAgentScenarioLoop")
      .mockResolvedValue({
        agentId: "pi-agent",
        suite: "full",
        available: 100,
        outputPath: "/tmp/AGENT_SCENARIO_LOOP.md",
        executed: 3,
        passed: 3,
        failed: 0,
      })

    try {
      const { runCli } = await import("../src/index.js")
      stdoutWrite.mockClear()
      await expect(
        runCli([
          "agent",
          "scenario-loop",
          "--agent",
          "pi-agent",
          "--suite",
          "full",
          "--count",
          "3",
          "--output",
          "AGENT_SCENARIO_LOOP.md",
          "--model-timeout-ms",
          "45000",
        ]),
      ).resolves.toBeUndefined()
      expect(runAgentScenarioLoop).toHaveBeenCalledWith(
        expect.stringContaining("openboa-company-"),
        {
          agentId: "pi-agent",
          suite: "full",
          count: 3,
          outputPath: "AGENT_SCENARIO_LOOP.md",
          modelTimeoutMs: 45000,
        },
      )
      const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
      expect(output).toContain("scenario-loop: completed")
      expect(output).toContain("suite: full")
      expect(output).toContain("available: 100")
      expect(output).toContain("executed: 3")
      expect(output).toContain("passed: 3")
      expect(output).toContain("failed: 0")
    } finally {
      runAgentScenarioLoop.mockRestore()
    }
  })

  it("defaults the live scenario-loop command to the curated suite", async () => {
    const scenarioLoopModule = await import("../src/agents/runtime/scenario-loop.js")
    const runAgentScenarioLoop = vi
      .spyOn(scenarioLoopModule, "runAgentScenarioLoop")
      .mockResolvedValue({
        agentId: "pi-agent",
        suite: "curated",
        available: 30,
        outputPath: "/tmp/AGENT_SCENARIO_LOOP.md",
        executed: 30,
        passed: 30,
        failed: 0,
      })

    try {
      const { runCli } = await import("../src/index.js")
      stdoutWrite.mockClear()
      await expect(
        runCli([
          "agent",
          "scenario-loop",
          "--agent",
          "pi-agent",
          "--output",
          "AGENT_SCENARIO_LOOP.md",
        ]),
      ).resolves.toBeUndefined()
      expect(runAgentScenarioLoop).toHaveBeenCalledWith(
        expect.stringContaining("openboa-company-"),
        {
          agentId: "pi-agent",
          suite: undefined,
          count: undefined,
          outputPath: "AGENT_SCENARIO_LOOP.md",
          modelTimeoutMs: undefined,
        },
      )
      const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
      expect(output).toContain("suite: curated")
      expect(output).toContain("available: 30")
      expect(output).toContain("passed: 30")
      expect(output).toContain("failed: 0")
    } finally {
      runAgentScenarioLoop.mockRestore()
    }
  })

  it("runs the live scenario-soak command through the CLI surface", async () => {
    const scenarioSoakModule = await import("../src/agents/runtime/scenario-soak.js")
    const runAgentScenarioSoak = vi
      .spyOn(scenarioSoakModule, "runAgentScenarioSoak")
      .mockResolvedValue({
        agentId: "pi-agent",
        outputPath: "/tmp/AGENT_SCENARIO_SOAK.md",
        workers: 3,
        sessions: 6,
        delayedSessions: 3,
        blockedActivations: 2,
        immediatePassed: 6,
        delayedPassed: 3,
        failed: 0,
      })

    try {
      const { runCli } = await import("../src/index.js")
      stdoutWrite.mockClear()
      await expect(
        runCli([
          "agent",
          "scenario-soak",
          "--agent",
          "pi-agent",
          "--workers",
          "3",
          "--sessions",
          "6",
          "--delayed-sessions",
          "3",
          "--output",
          "AGENT_SCENARIO_SOAK.md",
          "--model-timeout-ms",
          "45000",
        ]),
      ).resolves.toBeUndefined()
      expect(runAgentScenarioSoak).toHaveBeenCalledWith(
        expect.stringContaining("openboa-company-"),
        {
          agentId: "pi-agent",
          workers: 3,
          sessions: 6,
          delayedSessions: 3,
          outputPath: "AGENT_SCENARIO_SOAK.md",
          modelTimeoutMs: 45000,
        },
      )
      const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
      expect(output).toContain("scenario-soak: completed")
      expect(output).toContain("workers: 3")
      expect(output).toContain("sessions: 6")
      expect(output).toContain("delayedSessions: 3")
      expect(output).toContain("blockedActivations: 2")
      expect(output).toContain("immediatePassed: 6")
      expect(output).toContain("delayedPassed: 3")
      expect(output).toContain("failed: 0")
    } finally {
      runAgentScenarioSoak.mockRestore()
    }
  })

  it("runs the live scenario-mixed-soak command through the CLI surface", async () => {
    const scenarioMixedSoakModule = await import("../src/agents/runtime/scenario-mixed-soak.js")
    const runAgentScenarioMixedSoak = vi
      .spyOn(scenarioMixedSoakModule, "runAgentScenarioMixedSoak")
      .mockResolvedValue({
        agentId: "pi-agent",
        outputPath: "/tmp/AGENT_SCENARIO_MIXED_SOAK.md",
        workers: 3,
        rounds: 2,
        immediateSessions: 2,
        delayedSessions: 2,
        approvalSessions: 2,
        customToolSessions: 2,
        interruptSessions: 2,
        blockedActivations: 4,
        immediatePassed: 2,
        delayedPassed: 2,
        approvalPassed: 2,
        customToolPassed: 2,
        interruptPassed: 2,
        failed: 0,
      })

    try {
      const { runCli } = await import("../src/index.js")
      stdoutWrite.mockClear()
      await expect(
        runCli([
          "agent",
          "scenario-mixed-soak",
          "--agent",
          "pi-agent",
          "--workers",
          "3",
          "--rounds",
          "2",
          "--immediate-sessions",
          "2",
          "--delayed-sessions",
          "2",
          "--approval-sessions",
          "2",
          "--custom-tool-sessions",
          "2",
          "--interrupt-sessions",
          "2",
          "--output",
          "AGENT_SCENARIO_MIXED_SOAK.md",
          "--model-timeout-ms",
          "45000",
        ]),
      ).resolves.toBeUndefined()
      expect(runAgentScenarioMixedSoak).toHaveBeenCalledWith(
        expect.stringContaining("openboa-company-"),
        {
          agentId: "pi-agent",
          workers: 3,
          rounds: 2,
          immediateSessions: 2,
          delayedSessions: 2,
          approvalSessions: 2,
          customToolSessions: 2,
          interruptSessions: 2,
          outputPath: "AGENT_SCENARIO_MIXED_SOAK.md",
          modelTimeoutMs: 45000,
        },
      )
      const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
      expect(output).toContain("scenario-mixed-soak: completed")
      expect(output).toContain("workers: 3")
      expect(output).toContain("rounds: 2")
      expect(output).toContain("immediateSessions: 2")
      expect(output).toContain("delayedSessions: 2")
      expect(output).toContain("approvalSessions: 2")
      expect(output).toContain("customToolSessions: 2")
      expect(output).toContain("interruptSessions: 2")
      expect(output).toContain("blockedActivations: 4")
      expect(output).toContain("approvalPassed: 2")
      expect(output).toContain("customToolPassed: 2")
      expect(output).toContain("interruptPassed: 2")
      expect(output).toContain("failed: 0")
    } finally {
      runAgentScenarioMixedSoak.mockRestore()
    }
  })

  it("prints wake-scoped event lines when watch mode runs with --log", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await options?.onActivity?.({
          cycle: 1,
          sessionId: "session_watch_2",
          activationClaimId: "claim_watch_2",
          wakeId: "wake_watch_2",
          stopReason: "idle",
          processedEventCount: 1,
          queuedWakeCount: 0,
          runnablePendingEventType: null,
          deferUntil: null,
          failureStreak: 0,
          pendingWakeCount: 0,
          nextQueuedWakeAt: null,
          requeue: null,
          queuedWakeSummaries: [],
          consumedInputs: ["user.message: Read your current AGENTS.md"],
          responsePreview: "You are pi-agent.",
          pendingToolConfirmation: null,
          pendingCustomTool: null,
          wakeEvents: [
            {
              id: "event-status-running",
              type: "session.status_changed",
              createdAt: "2026-04-12T00:00:00.000Z",
              processedAt: "2026-04-12T00:00:00.000Z",
              wakeId: "wake_watch_2",
              fromStatus: "idle",
              toStatus: "running",
              reason: "idle",
            },
            {
              id: "event-tool-read",
              type: "agent.tool_use",
              createdAt: "2026-04-12T00:00:00.100Z",
              processedAt: "2026-04-12T00:00:00.100Z",
              wakeId: "wake_watch_2",
              requestId: null,
              toolName: "memory_read",
              ownership: "managed",
              permissionPolicy: "always_allow",
              input: {},
              output: null,
            },
            {
              id: "event-agent-message",
              type: "agent.message",
              createdAt: "2026-04-12T00:00:00.200Z",
              processedAt: "2026-04-12T00:00:00.200Z",
              wakeId: "wake_watch_2",
              message: "You are pi-agent.",
              summary: "Explained AGENTS.md.",
            },
          ],
        })
        return {
          cycles: 1,
          executed: 1,
          stopReason: "idle_timeout",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--log",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "250",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("log: true")
    expect(output).toContain("event: 2026-04-12T00:00:00.100Z agent.tool_use memory_read")
    expect(output).toContain('event: 2026-04-12T00:00:00.200Z agent.message "You are pi-agent."')

    runAgentLoop.mockRestore()
  })

  it("prints skipped activation lines when watch mode runs with --log", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await options?.onSkip?.({
          cycle: 2,
          sessionId: "session_watch_skip_1",
          activationClaimId: "claim_watch_skip_1",
          activationKind: "pending_events",
          reason: "lease_contended",
          errorMessage: undefined,
          nextRetryAt: undefined,
          failureStreak: undefined,
          activeWakeLease: {
            owner: "orchestrator://other-worker",
            acquiredAt: "2026-04-12T00:00:00.000Z",
          },
        })
        return {
          cycles: 2,
          executed: 0,
          stopReason: "idle_timeout",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--log",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "250",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("orchestrator: skipped")
    expect(output).toContain("session: session_watch_skip_1")
    expect(output).toContain("activationClaimId: claim_watch_skip_1")
    expect(output).toContain("activationKind: pending_events")
    expect(output).toContain("reason: lease_contended")
    expect(output).toContain("error: none")
    expect(output).toContain("nextRetryAt: none")
    expect(output).toContain("retryStreak: 0")
    expect(output).toContain("activeWakeLeaseOwner: orchestrator://other-worker")
    expect(output).toContain("activeWakeLeaseAcquiredAt: 2026-04-12T00:00:00.000Z")

    runAgentLoop.mockRestore()
  })

  it("prints wake failure details in skipped lines when watch mode continues past a failed activation", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await options?.onSkip?.({
          cycle: 3,
          sessionId: "session_watch_skip_fail",
          activationClaimId: "claim_watch_skip_fail",
          activationKind: "queued_wake",
          reason: "wake_failed",
          errorMessage: "lease renew failed",
          nextRetryAt: "2026-04-12T00:05:00.000Z",
          failureStreak: 2,
          activeWakeLease: null,
        })
        return {
          cycles: 3,
          executed: 1,
          stopReason: "idle_timeout",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--log",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "250",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("orchestrator: skipped")
    expect(output).toContain("session: session_watch_skip_fail")
    expect(output).toContain("activationClaimId: claim_watch_skip_fail")
    expect(output).toContain("activationKind: queued_wake")
    expect(output).toContain("reason: wake_failed")
    expect(output).toContain("error: lease renew failed")
    expect(output).toContain("nextRetryAt: 2026-04-12T00:05:00.000Z")
    expect(output).toContain("retryStreak: 2")
    expect(output).toContain("activeWakeLeaseOwner: none")

    runAgentLoop.mockRestore()
  })

  it("prints explicit approval instructions when watch activity is waiting for tool confirmation", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await options?.onActivity?.({
          cycle: 4,
          sessionId: "session_watch_requires_action",
          activationClaimId: "claim_watch_requires_action",
          wakeId: "wake_requires_action",
          stopReason: "requires_action",
          processedEventCount: 1,
          queuedWakeCount: 0,
          runnablePendingEventType: "user.message",
          deferUntil: "2026-04-12T00:05:00.000Z",
          failureStreak: 2,
          pendingWakeCount: 1,
          nextQueuedWakeAt: "2026-04-12T00:10:00.000Z",
          requeue: {
            immediateRetryAt: "2026-04-12T00:05:00.000Z",
            nextQueuedWakeAt: "2026-04-12T00:10:00.000Z",
            queuedWakeIds: ["wake-approval-followup-1"],
          },
          queuedWakeSummaries: [],
          consumedInputs: ["user.message: add you are happy in soul.md"],
          responsePreview: "I can do that, but the write path is confirmation-gated.",
          pendingToolConfirmation: {
            id: "request_shell_run_1",
            toolName: "shell_run",
            permissionPolicy: "always_ask",
          },
          pendingCustomTool: null,
          wakeEvents: [],
        })
        return {
          cycles: 1,
          executed: 1,
          stopReason: "idle_timeout",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "250",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("approvalRequired: true")
    expect(output).toContain("activationClaimId: claim_watch_requires_action")
    expect(output).toContain("runnablePendingEvent: user.message")
    expect(output).toContain("nextRetryAt: 2026-04-12T00:05:00.000Z")
    expect(output).toContain("retryStreak: 2")
    expect(output).toContain("pendingQueuedWakes: 1")
    expect(output).toContain("nextQueuedWakeAt: 2026-04-12T00:10:00.000Z")
    expect(output).toContain("activationRequeued: true")
    expect(output).toContain("activationQueuedWakeIds: wake-approval-followup-1")
    expect(output).toContain("pendingTool: shell_run")
    expect(output).toContain("pendingToolRequestId: request_shell_run_1")
    expect(output).toContain("pendingToolPermission: always_ask")
    expect(output).toContain(
      "confirmAllow: pnpm openboa agent session confirm-tool --session session_watch_requires_action --request request_shell_run_1 --allowed true",
    )
    expect(output).toContain(
      "confirmDeny: pnpm openboa agent session confirm-tool --session session_watch_requires_action --request request_shell_run_1 --allowed false",
    )

    runAgentLoop.mockRestore()
  })

  it("prints explicit custom tool result instructions when watch activity is waiting for a custom tool", async () => {
    const runAgentLoop = vi
      .spyOn(AgentOrchestration.prototype, "runAgentLoop")
      .mockImplementation(async (_agentId, options) => {
        await options?.onActivity?.({
          cycle: 5,
          sessionId: "session_watch_custom_tool",
          activationClaimId: "claim_watch_custom_tool",
          wakeId: "wake_custom_tool",
          stopReason: "requires_action",
          processedEventCount: 1,
          queuedWakeCount: 0,
          runnablePendingEventType: null,
          deferUntil: null,
          failureStreak: 0,
          pendingWakeCount: 0,
          nextQueuedWakeAt: null,
          requeue: null,
          queuedWakeSummaries: [],
          consumedInputs: ["user.message: fetch the spec before continuing"],
          responsePreview: "Waiting on fetch_spec.",
          pendingToolConfirmation: null,
          pendingCustomTool: {
            id: "request_fetch_spec_watch",
            name: "fetch_spec",
            input: { path: "spec.md" },
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          wakeEvents: [],
        })
        return {
          cycles: 1,
          executed: 1,
          stopReason: "idle_timeout",
        }
      })

    const { runCli } = await import("../src/index.js")
    stdoutWrite.mockClear()
    await expect(
      runCli([
        "agent",
        "orchestrator",
        "--agent",
        "pi-agent",
        "--watch",
        "--poll-interval-ms",
        "50",
        "--idle-timeout-ms",
        "250",
      ]),
    ).resolves.toBeUndefined()
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(output).toContain("customToolRequired: true")
    expect(output).toContain("activationClaimId: claim_watch_custom_tool")
    expect(output).toContain("pendingCustomTool: fetch_spec")
    expect(output).toContain("pendingCustomToolRequestId: request_fetch_spec_watch")
    expect(output).toContain("pendingCustomToolRequestedAt: 2026-04-12T00:00:00.000Z")
    expect(output).toContain('pendingCustomToolInput: {"path":"spec.md"}')
    expect(output).toContain(
      "submitCustomToolResult: pnpm openboa agent session custom-tool-result --session session_watch_custom_tool --request request_fetch_spec_watch --output '<result>'",
    )

    runAgentLoop.mockRestore()
  })

  it("fails closed when auth is required but no provider auth is configured", async () => {
    const { runCli } = await import("../src/index.js")
    await expect(runCli(["agent", "spawn", "--name", "locked-agent"])).resolves.toBeUndefined()

    await runCli(["agent", "session", "create", "--name", "locked-agent"])
    const createOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    const sessionId = String(createOutput.match(/session:\s+([0-9a-f-]{36})/i)?.[1] ?? "")
    expect(sessionId).toHaveLength(36)

    stdoutWrite.mockClear()
    await runCli([
      "agent",
      "session",
      "send",
      "--session",
      sessionId,
      "--message",
      "Read your AGENTS.md and answer concretely.",
    ])

    stdoutWrite.mockClear()
    await expect(runCli(["agent", "wake", "--session", sessionId])).resolves.toBeUndefined()
    const wakeOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(wakeOutput).toContain("Wake failed:")
    expect(wakeOutput).toContain("Authentication is required for provider openai-codex")
    expect(wakeOutput).not.toContain("(offline)")

    stdoutWrite.mockClear()
    await runCli(["agent", "session", "status", "--session", sessionId])
    const statusOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(statusOutput).toContain("pendingEvents: 1")

    const agentConfigPath = join(cwd, ".openboa", "agents", "locked-agent", "agent.json")
    const agentConfig = JSON.parse(await readFile(agentConfigPath, "utf8")) as {
      auth?: { required?: boolean }
    }
    expect(agentConfig.auth?.required).toBe(true)

    agentConfig.auth ??= {}
    agentConfig.auth.required = false
    await writeFile(agentConfigPath, `${JSON.stringify(agentConfig, null, 2)}\n`, "utf8")

    stdoutWrite.mockClear()
    await expect(runCli(["agent", "wake", "--session", sessionId])).resolves.toBeUndefined()
    const retriedWakeOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join("")
    expect(retriedWakeOutput).toContain("[pi:locked-agent] (offline)")
    expect(retriedWakeOutput).toContain("wake: executed")
  })

  it("exposes canonical chat conversation, message, and event commands", async () => {
    const { runCli } = await import("../src/index.js")
    await expect(
      runCli(["chat", "conversation", "direct", "--participants", "alpha,beta", "--json"]),
    ).resolves.toBeUndefined()
    const directConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string; kind: string; participantIds: string[] }
    expect(directConversation.kind).toBe("group_dm")
    expect(directConversation.participantIds).toEqual(["local-actor", "alpha", "beta"])

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "conversation", "direct", "--participants", "beta,alpha", "--json"]),
    ).resolves.toBeUndefined()
    const reusedDirectConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string }
    expect(reusedDirectConversation.conversationId).toBe(directConversation.conversationId)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        directConversation.conversationId,
        "--message",
        "for alpha only",
        "--audience-id",
        "alpha",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const directedMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string; body: string; audience: { id: string } | null }
    expect(directedMessage.conversationId).toBe(directConversation.conversationId)
    expect(directedMessage.body).toBe("for alpha only")
    expect(directedMessage.audience?.id).toBe("alpha")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "create",
        "--slug",
        "signals",
        "--title",
        "signals",
        "--visibility",
        "private",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "invite",
        "--conversation",
        "signals",
        "--participant-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "signals",
        "--message",
        "beta is not visible yet",
        "--audience-id",
        "beta",
        "--json",
      ]),
    ).rejects.toThrow("Audience participant is not visible in the conversation scope")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "create",
        "--slug",
        "general",
        "--title",
        "general",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const createdConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string; slug: string | null; kind: string }
    expect(createdConversation.slug).toBe("general")
    expect(createdConversation.kind).toBe("channel")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "join",
        "--conversation",
        "general",
        "--participant-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const joinedConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { participantIds: string[] }
    expect(joinedConversation.participantIds).toContain("beta")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "leave",
        "--conversation",
        "general",
        "--participant-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const leftConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { participantIds: string[] }
    expect(leftConversation.participantIds).not.toContain("beta")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "join",
        "--conversation",
        "general",
        "--participant-id",
        "gamma",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "remove",
        "--conversation",
        "general",
        "--participant-id",
        "gamma",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const removedConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { participantIds: string[] }
    expect(removedConversation.participantIds).not.toContain("gamma")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "create",
        "--slug",
        "private-room",
        "--title",
        "private-room",
        "--visibility",
        "private",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "invite",
        "--conversation",
        "private-room",
        "--participant-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const inviteBinding = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { subjectId: string; roleId: string }
    expect(inviteBinding.subjectId).toBe("beta")
    expect(inviteBinding.roleId).toBe("participant")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "viewer",
        "--conversation",
        "private-room",
        "--participant-id",
        "watcher",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const viewerBinding = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { subjectId: string; roleId: string }
    expect(viewerBinding.subjectId).toBe("watcher")
    expect(viewerBinding.roleId).toBe("viewer")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "watch",
        "start",
        "--conversation",
        "private-room",
        "--actor-id",
        "watcher",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "conversation", "roster", "--conversation", "private-room", "--json"]),
    ).resolves.toBeUndefined()
    const privateRoomRoster = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{
      participantId: string
      inConversation: boolean
      membershipState: string | null
      conversationRoleIds: string[]
      watchAttached: boolean | null
    }>
    expect(privateRoomRoster).toEqual([
      expect.objectContaining({
        participantId: "local-actor",
        inConversation: true,
        membershipState: "joined",
        conversationRoleIds: ["room_manager"],
        watchAttached: null,
      }),
      expect.objectContaining({
        participantId: "beta",
        inConversation: false,
        membershipState: null,
        conversationRoleIds: ["participant"],
        watchAttached: null,
      }),
      expect.objectContaining({
        participantId: "watcher",
        inConversation: false,
        membershipState: null,
        conversationRoleIds: ["viewer"],
        watchAttached: true,
      }),
    ])

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "conversation", "grants", "--conversation", "private-room", "--json"]),
    ).resolves.toBeUndefined()
    const privateRoomGrants = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ bindingId: string; subjectId: string; roleId: string; bindingState: string }>
    expect(privateRoomGrants.map((binding) => [binding.subjectId, binding.roleId])).toEqual([
      ["local-actor", "room_manager"],
      ["beta", "participant"],
      ["watcher", "viewer"],
    ])
    const betaInviteBindingId = privateRoomGrants.find(
      (binding) => binding.subjectId === "beta",
    )?.bindingId
    expect(betaInviteBindingId).toBeTruthy()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "revoke",
        "--conversation",
        "private-room",
        "--binding",
        String(betaInviteBindingId),
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const revokedPrivateRoomBinding = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { bindingId: string; bindingState: string; subjectId: string }
    expect(revokedPrivateRoomBinding.bindingId).toBe(String(betaInviteBindingId))
    expect(revokedPrivateRoomBinding.bindingState).toBe("revoked")
    expect(revokedPrivateRoomBinding.subjectId).toBe("beta")

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "conversation", "grants", "--conversation", "private-room", "--json"]),
    ).resolves.toBeUndefined()
    const activePrivateRoomGrantsAfterRevoke = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ subjectId: string; roleId: string }>
    expect(
      activePrivateRoomGrantsAfterRevoke.map((binding) => [binding.subjectId, binding.roleId]),
    ).toEqual([
      ["local-actor", "room_manager"],
      ["watcher", "viewer"],
    ])

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "create",
        "--slug",
        "viewer-room",
        "--title",
        "viewer-room",
        "--created-by",
        "alpha",
        "--visibility",
        "private",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const viewerRoom = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string }

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "create",
        "--slug",
        "hidden-room",
        "--title",
        "hidden-room",
        "--created-by",
        "alpha",
        "--visibility",
        "private",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const hiddenRoom = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string }

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "viewer",
        "--conversation",
        "viewer-room",
        "--participant-id",
        "local-actor",
        "--actor-id",
        "alpha",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(runCli(["chat", "conversation", "list", "--json"])).resolves.toBeUndefined()
    const visibleConversations = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ conversationId: string }>
    expect(visibleConversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId: createdConversation.conversationId }),
        expect.objectContaining({ conversationId: viewerRoom.conversationId }),
      ]),
    )
    expect(
      visibleConversations.some(
        (conversation) => conversation.conversationId === hiddenRoom.conversationId,
      ),
    ).toBe(false)

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "conversation", "get", "--conversation", "viewer-room", "--json"]),
    ).resolves.toBeUndefined()
    const viewerRoomRecord = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string; slug: string }
    expect(viewerRoomRecord.conversationId).toBe(viewerRoom.conversationId)
    expect(viewerRoomRecord.slug).toBe("viewer-room")

    await expect(
      runCli(["chat", "conversation", "get", "--conversation", "hidden-room", "--json"]),
    ).rejects.toThrow("Private rooms require an explicit grant")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "watch",
        "start",
        "--conversation",
        "viewer-room",
        "--actor-id",
        "local-actor",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "viewer-room",
        "--message",
        "viewer room update",
        "--sender-id",
        "alpha",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "update",
        "--conversation",
        "general",
        "--title",
        "general-updated",
        "--topic",
        "Launch coordination",
        "--posting-policy",
        "restricted",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const updatedConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { title: string; topic: string | null; postingPolicy: string }
    expect(updatedConversation.title).toBe("general-updated")
    expect(updatedConversation.topic).toBe("Launch coordination")
    expect(updatedConversation.postingPolicy).toBe("restricted")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "conversation",
        "update",
        "--conversation",
        "general",
        "--posting-policy",
        "open",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "general",
        "--message",
        "hello from founder",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const postedMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { conversationId: string; body: string }
    expect(postedMessage.conversationId).toBe(createdConversation.conversationId)
    expect(postedMessage.body).toBe("hello from founder")

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "message", "read", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const messages = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ body: string; messageKind: string; systemEventKind: string | null }>
    expect(messages.some((message) => message.body === "hello from founder")).toBe(true)
    expect(messages.some((message) => message.messageKind === "system-event")).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "read",
        "--conversation",
        "general",
        "--kind",
        "system",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const systemMessages = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ messageKind: string; systemEventKind: string | null }>
    expect(systemMessages.length).toBeGreaterThan(0)
    expect(systemMessages.every((message) => message.messageKind === "system-event")).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "search",
        "--conversation",
        "general",
        "--query",
        "founder hello",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const searchResults = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ score: number; message: { messageId: string; body: string } }>
    expect(searchResults).toHaveLength(1)
    expect(searchResults[0]?.message.messageId).toBe(postedMessage.messageId)
    expect(searchResults[0]?.message.body).toBe("hello from founder")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "search",
        "--conversation",
        "general",
        "--query",
        "renamed general-updated",
        "--kind",
        "system",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const systemSearchResults = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ message: { systemEventKind: string | null } }>
    expect(systemSearchResults.length).toBeGreaterThan(0)
    expect(systemSearchResults[0]?.message.systemEventKind).toBe("room-renamed")

    await new ChatCommandService(cwd).joinConversation({
      conversationId: createdConversation.conversationId,
      participantId: "beta",
    })

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "general",
        "--message",
        "@local-actor hello from beta",
        "--sender-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const secondMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { messageId: string }

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        directConversation.conversationId,
        "--message",
        "direct ping from alpha",
        "--sender-id",
        "alpha",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "read",
        "--conversation",
        "general",
        "--author-id",
        "local-actor",
        "--limit",
        "1",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const filteredMessages = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ messageId: string; author: { id: string } }>
    expect(filteredMessages).toHaveLength(1)
    expect(filteredMessages[0]?.messageId).toBe(postedMessage.messageId)
    expect(filteredMessages[0]?.author.id).toBe("local-actor")

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "read",
        "--conversation",
        "general",
        "--before",
        secondMessage.messageId,
        "--author-id",
        "local-actor",
        "--limit",
        "1",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const beforeMessages = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ messageId: string }>
    expect(beforeMessages).toHaveLength(1)
    expect(beforeMessages[0]?.messageId).toBe(postedMessage.messageId)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "reaction",
        "add",
        "--conversation",
        "general",
        "--message",
        postedMessage.messageId,
        "--emoji",
        ":eyes:",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const reactedMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { reactions: Array<{ emoji: string; participantIds: string[]; count: number }> }
    expect(reactedMessage.reactions).toEqual([
      {
        emoji: ":eyes:",
        participantIds: ["local-actor"],
        count: 1,
      },
    ])

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "reaction",
        "remove",
        "--conversation",
        "general",
        "--message",
        postedMessage.messageId,
        "--emoji",
        ":eyes:",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const unreactedMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { reactions: Array<{ emoji: string; participantIds: string[]; count: number }> }
    expect(unreactedMessage.reactions).toEqual([])

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "edit",
        "--conversation",
        "general",
        "--message",
        postedMessage.messageId,
        "--body",
        "hello from founder, edited",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const editedMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { body: string; editedById: string | null; editedAt: string | null }
    expect(editedMessage.body).toBe("hello from founder, edited")
    expect(editedMessage.editedById).toBe("local-actor")
    expect(editedMessage.editedAt).not.toBeNull()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "redact",
        "--conversation",
        "general",
        "--message",
        postedMessage.messageId,
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const redactedMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { body: string; redactedById: string | null; redactedAt: string | null }
    expect(redactedMessage.body).toBe(CHAT_REDACTED_MESSAGE_BODY)
    expect(redactedMessage.redactedById).toBe("local-actor")
    expect(redactedMessage.redactedAt).not.toBeNull()

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "cursor", "get", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const initialCursor = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as {
      hasPersistedCursor: boolean
      lastObservedSequence: number
      lastObservedScopeSequence: number
    }
    expect(initialCursor.hasPersistedCursor).toBe(false)
    expect(initialCursor.lastObservedSequence).toBe(0)
    expect(initialCursor.lastObservedScopeSequence).toBe(0)

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "cursor", "mark-read", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const markedCursor = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as {
      hasPersistedCursor: boolean
      lastObservedSequence: number
      lastObservedScopeSequence: number
      lastObservedScopeRevision: number
    }
    expect(markedCursor.hasPersistedCursor).toBe(true)
    expect(markedCursor.lastObservedSequence).toBeGreaterThan(0)
    expect(markedCursor.lastObservedScopeSequence).toBeGreaterThan(0)
    expect(markedCursor.lastObservedScopeRevision).toBeGreaterThanOrEqual(
      markedCursor.lastObservedScopeSequence,
    )

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "general",
        "--message",
        "@local-actor follow-up mention",
        "--sender-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const unreadMentionMessage = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { messageId: string }

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "watch", "get", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const initialWatch = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { attached: boolean | null; hasPersistedAttachment: boolean; threadId: string | null }
    expect(initialWatch.threadId).toBeNull()
    expect(initialWatch.attached).toBeNull()
    expect(initialWatch.hasPersistedAttachment).toBe(false)

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "watch", "start", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const startedWatch = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { attached: boolean | null; hasPersistedAttachment: boolean }
    expect(startedWatch.attached).toBe(true)
    expect(startedWatch.hasPersistedAttachment).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "watch", "stop", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const stoppedWatch = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { attached: boolean | null; hasPersistedAttachment: boolean }
    expect(stoppedWatch.attached).toBe(false)
    expect(stoppedWatch.hasPersistedAttachment).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "general",
        "--message",
        "thread reply from founder",
        "--thread",
        postedMessage.messageId,
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "message",
        "post",
        "--conversation",
        "general",
        "--message",
        "thread reply from beta",
        "--thread",
        postedMessage.messageId,
        "--sender-id",
        "beta",
        "--json",
      ]),
    ).resolves.toBeUndefined()

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "thread",
        "get",
        "--conversation",
        "general",
        "--thread",
        postedMessage.messageId,
        "--author-id",
        "local-actor",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const initialThreadView = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as {
      rootMessage: { messageId: string }
      replies: Array<{ body: string }>
      followState: { attached: boolean | null; hasPersistedAttachment: boolean }
      cursorState: { lastObservedScopeSequence: number }
    }
    expect(initialThreadView.rootMessage.messageId).toBe(postedMessage.messageId)
    expect(initialThreadView.replies.map((message) => message.body)).toEqual([
      "thread reply from founder",
    ])
    expect(initialThreadView.followState.attached).toBeNull()
    expect(initialThreadView.followState.hasPersistedAttachment).toBe(false)
    expect(initialThreadView.cursorState.lastObservedScopeSequence).toBe(0)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "thread",
        "get",
        "--conversation",
        "general",
        "--thread",
        postedMessage.messageId,
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const initialThreadFollow = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as {
      followState: { attached: boolean | null; hasPersistedAttachment: boolean }
      replies: Array<{ body: string }>
    }
    expect(initialThreadFollow.followState.attached).toBeNull()
    expect(initialThreadFollow.followState.hasPersistedAttachment).toBe(false)
    expect(initialThreadFollow.replies.map((message) => message.body)).toEqual([
      "thread reply from founder",
      "thread reply from beta",
    ])

    stdoutWrite.mockClear()
    await expect(runCli(["chat", "inbox", "list", "--json"])).resolves.toBeUndefined()
    const inboxEntries = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ kind: string; conversationId: string; messageId: string | null }>
    expect(inboxEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "direct",
          conversationId: directConversation.conversationId,
        }),
        expect.objectContaining({
          kind: "mention",
          conversationId: createdConversation.conversationId,
          messageId: unreadMentionMessage.messageId,
        }),
      ]),
    )

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "search", "messages", "--query", "direct ping", "--json"]),
    ).resolves.toBeUndefined()
    const visibleSearchResults = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{
      openConversationId: string
      sourceConversationId: string
      openMode: "joined" | "viewer"
      preview: string
    }>
    expect(visibleSearchResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          openConversationId: directConversation.conversationId,
          sourceConversationId: directConversation.conversationId,
          openMode: "joined",
          preview: "direct ping from alpha",
        }),
      ]),
    )

    stdoutWrite.mockClear()
    await expect(runCli(["chat", "conversation", "summaries", "--json"])).resolves.toBeUndefined()
    const conversationSummaries = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ conversationId: string; unreadCount: number; mentionCount: number }>
    expect(conversationSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: createdConversation.conversationId,
          unreadCount: 1,
          mentionCount: 1,
        }),
        expect.objectContaining({
          conversationId: viewerRoom.conversationId,
          unreadCount: 0,
          mentionCount: 0,
        }),
      ]),
    )

    stdoutWrite.mockClear()
    await expect(runCli(["chat", "viewer", "recents", "--json"])).resolves.toBeUndefined()
    const viewerRecents = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ conversationId: string; title: string }>
    expect(viewerRecents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: viewerRoom.conversationId,
          title: "viewer-room",
        }),
      ]),
    )

    stdoutWrite.mockClear()
    await expect(runCli(["chat", "thread", "followed", "--json"])).resolves.toBeUndefined()
    const followedThreads = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{
      threadRootMessageId: string
      unreadReplyCount: number
      unreadMentionCount: number
    }>
    expect(followedThreads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadRootMessageId: postedMessage.messageId,
          unreadReplyCount: 1,
          unreadMentionCount: 0,
        }),
      ]),
    )

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "thread",
        "follow",
        "--conversation",
        "general",
        "--thread",
        postedMessage.messageId,
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const followedThread = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { attached: boolean | null; hasPersistedAttachment: boolean }
    expect(followedThread.attached).toBe(true)
    expect(followedThread.hasPersistedAttachment).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "thread",
        "unfollow",
        "--conversation",
        "general",
        "--thread",
        postedMessage.messageId,
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const unfollowedThread = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { attached: boolean | null; hasPersistedAttachment: boolean }
    expect(unfollowedThread.attached).toBe(false)
    expect(unfollowedThread.hasPersistedAttachment).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "events", "list", "--limit", "30", "--json"]),
    ).resolves.toBeUndefined()
    const events = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as Array<{ sequence: number; eventType: string; conversationId?: string | null }>
    expect(events.some((event) => event.eventType === "conversation.upserted")).toBe(true)
    expect(events.some((event) => event.eventType === "message.posted")).toBe(true)
    expect(
      events.some(
        (event) => "conversationId" in event && event.conversationId === hiddenRoom.conversationId,
      ),
    ).toBe(false)
    const latestListedSequence = events.at(-1)?.sequence ?? 0

    stdoutWrite.mockClear()
    await expect(
      runCli([
        "chat",
        "events",
        "poll",
        "--conversation",
        "general",
        "--after-sequence",
        "0",
        "--limit",
        "30",
        "--json",
      ]),
    ).resolves.toBeUndefined()
    const pollResult = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { afterSequence: number; nextSequence: number; events: Array<{ eventType: string }> }
    expect(pollResult.afterSequence).toBe(0)
    expect(pollResult.nextSequence).toBeGreaterThan(0)
    expect(pollResult.events.some((event) => event.eventType === "conversation.upserted")).toBe(
      true,
    )
    expect(pollResult.events.some((event) => event.eventType === "message.posted")).toBe(true)

    stdoutWrite.mockClear()
    const waitPromise = runCli([
      "chat",
      "events",
      "wait",
      "--conversation",
      "general",
      "--after-sequence",
      String(latestListedSequence),
      "--timeout-ms",
      "500",
      "--json",
    ])
    const delayedPostPromise = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        new ChatCommandService(cwd)
          .postMessage({
            conversationId: createdConversation.conversationId,
            senderId: "local-actor",
            body: "follow-up after wait",
          })
          .then(() => resolve())
          .catch(reject)
      }, 25)
    })
    await expect(waitPromise).resolves.toBeUndefined()
    await expect(delayedPostPromise).resolves.toBeUndefined()
    const waitResult = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as {
      afterSequence: number
      nextSequence: number
      timedOut: boolean
      events: Array<{ eventType: string }>
    }
    expect(waitResult.afterSequence).toBe(latestListedSequence)
    expect(waitResult.timedOut).toBe(false)
    expect(waitResult.nextSequence).toBeGreaterThan(waitResult.afterSequence)
    expect(waitResult.events.some((event) => event.eventType === "message.posted")).toBe(true)

    stdoutWrite.mockClear()
    await expect(
      runCli(["chat", "conversation", "archive", "--conversation", "general", "--json"]),
    ).resolves.toBeUndefined()
    const archivedConversation = JSON.parse(
      stdoutWrite.mock.calls.map((call) => String(call[0])).join(""),
    ) as { lifecycleState: string }
    expect(archivedConversation.lifecycleState).toBe("archived")
  })

  it("fails cleanly for removed legacy commands", async () => {
    const { runCli } = await import("../src/index.js")
    await expect(runCli(["agent", "activate", "--name", "pi-agent"])).rejects.toThrow(
      "agent requires one of: spawn, list, session, activation-events, wake, orchestrator, scenario-loop, scenario-soak, scenario-mixed-soak",
    )
    await expect(runCli(["agent", "chat", "--name", "pi-agent"])).rejects.toThrow(
      "agent requires one of: spawn, list, session, activation-events, wake, orchestrator, scenario-loop, scenario-soak, scenario-mixed-soak",
    )
    await expect(runCli(["chat", "--agent", "pi-agent", "--message", "hello"])).rejects.toThrow(
      "chat requires one of: conversation, inbox, viewer, search, message, reaction, cursor, watch, thread, events",
    )
    await expect(runCli(["chat", "conversation", "dm"])).rejects.toThrow(
      "chat conversation requires one of: create, direct, join, leave, remove, invite, viewer, roster, grants, revoke, update, archive, list, get, summaries",
    )
    await expect(runCli(["chat", "inbox", "open"])).rejects.toThrow(
      "chat inbox requires one of: list",
    )
    await expect(runCli(["chat", "viewer", "open"])).rejects.toThrow(
      "chat viewer requires one of: recents",
    )
    await expect(runCli(["chat", "search", "logs"])).rejects.toThrow(
      "chat search requires one of: messages",
    )
    await expect(runCli(["chat", "message", "update"])).rejects.toThrow(
      "chat message requires one of: post, read, search, edit, redact",
    )
    await expect(runCli(["chat", "events", "watch"])).rejects.toThrow(
      "chat events requires one of: list, poll, wait",
    )
    await expect(runCli(["chat", "watch", "follow"])).rejects.toThrow(
      "chat watch requires one of: get, start, stop",
    )
    await expect(runCli(["chat", "thread", "list"])).rejects.toThrow(
      "chat thread requires one of: followed, get, follow, unfollow",
    )
    await expect(runCli(["chat", "reaction", "toggle"])).rejects.toThrow(
      "chat reaction requires one of: add, remove",
    )
  })
})
