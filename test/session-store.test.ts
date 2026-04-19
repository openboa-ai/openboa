import { describe, expect, it } from "vitest"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { makeUuidV7 } from "../src/foundation/ids.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("SessionStore resume ingress", () => {
  it("rejects stale tool confirmations when there is no pending confirmation request", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await expect(
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.tool_confirmation",
        createdAt: "2026-04-12T00:00:00.000Z",
        processedAt: null,
        requestId: "confirm-shell-1",
        toolName: "shell_run",
        allowed: true,
        note: null,
      }),
    ).rejects.toThrow(
      `Session ${session.id} does not have a pending tool confirmation request for shell_run`,
    )

    expect(await store.listSessionJournalEvents("alpha", session.id)).toEqual([])
  })

  it("rejects duplicate tool confirmations even under concurrent ingress", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.updateSession(session.id, (current) => ({
      ...current,
      stopReason: "requires_action",
      pendingToolConfirmationRequest: {
        id: "confirm-shell-1",
        toolName: "shell_run",
        ownership: "managed",
        permissionPolicy: "always_ask",
        input: { command: "echo ready" },
        requestedAt: "2026-04-12T00:00:00.000Z",
      },
    }))

    const [first, second] = await Promise.allSettled([
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.tool_confirmation",
        createdAt: "2026-04-12T00:00:01.000Z",
        processedAt: null,
        requestId: "confirm-shell-1",
        toolName: "shell_run",
        allowed: true,
        note: "first approval",
      }),
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.tool_confirmation",
        createdAt: "2026-04-12T00:00:01.100Z",
        processedAt: null,
        requestId: "confirm-shell-1",
        toolName: "shell_run",
        allowed: true,
        note: "duplicate approval",
      }),
    ])

    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"])
    const events = await store.listSessionJournalEvents("alpha", session.id)
    const confirmations = events.filter((event) => event.type === "user.tool_confirmation")
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]?.requestId).toBe("confirm-shell-1")
  })

  it("rejects stale custom tool results when the pending request does not match", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.updateSession(session.id, (current) => ({
      ...current,
      stopReason: "requires_action",
      pendingCustomToolRequest: {
        id: "fetch-spec-1",
        name: "fetch_spec",
        input: { path: "spec.md" },
        requestedAt: "2026-04-12T00:00:00.000Z",
      },
    }))

    await expect(
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.custom_tool_result",
        createdAt: "2026-04-12T00:00:02.000Z",
        processedAt: null,
        requestId: "fetch-spec-2",
        toolName: "fetch_spec",
        output: "spec content",
      }),
    ).rejects.toThrow(
      `Session ${session.id} pending custom tool request does not match fetch-spec-2/fetch_spec`,
    )

    expect(await store.listSessionJournalEvents("alpha", session.id)).toEqual([])
  })

  it("rejects duplicate custom tool results even under concurrent ingress", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.updateSession(session.id, (current) => ({
      ...current,
      stopReason: "requires_action",
      pendingCustomToolRequest: {
        id: "fetch-spec-1",
        name: "fetch_spec",
        input: { path: "spec.md" },
        requestedAt: "2026-04-12T00:00:00.000Z",
      },
    }))

    const [first, second] = await Promise.allSettled([
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.custom_tool_result",
        createdAt: "2026-04-12T00:00:03.000Z",
        processedAt: null,
        requestId: "fetch-spec-1",
        toolName: "fetch_spec",
        output: "spec content A",
      }),
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.custom_tool_result",
        createdAt: "2026-04-12T00:00:03.100Z",
        processedAt: null,
        requestId: "fetch-spec-1",
        toolName: "fetch_spec",
        output: "spec content B",
      }),
    ])

    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"])
    const events = await store.listSessionJournalEvents("alpha", session.id)
    const results = events.filter((event) => event.type === "user.custom_tool_result")
    expect(results).toHaveLength(1)
    expect(results[0]?.requestId).toBe("fetch-spec-1")
  })

  it("serializes updateSession and emitEvent so concurrent mutations do not lose state", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await Promise.all([
      store.updateSession(session.id, (current) => ({
        ...current,
        metadata: {
          ...current.metadata,
          lastModel: "race-model",
        },
      })),
      store.emitEvent(session.id, {
        id: makeUuidV7(),
        type: "user.message",
        createdAt: "2026-04-12T00:00:04.000Z",
        processedAt: null,
        message: "concurrent ingress",
      }),
    ])

    const snapshot = await store.getSession(session.id)
    expect(snapshot.session.metadata?.lastModel).toBe("race-model")
    expect(snapshot.session.status).toBe("rescheduling")
    expect(snapshot.session.stopReason).toBe("rescheduling")
    expect(await store.listRunnableSessionIds("alpha")).toEqual([session.id])
    expect(
      snapshot.events.some(
        (event) => event.type === "user.message" && event.message === "concurrent ingress",
      ),
    ).toBe(true)
  })

  it("keeps the runnable index when markProcessed races with a new inbound event", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await store.emitEvent(session.id, {
      id: "event-old",
      type: "user.message",
      createdAt: "2026-04-12T00:00:05.000Z",
      processedAt: null,
      message: "old pending work",
    })

    await Promise.all([
      store.markProcessed(session.id, ["event-old"], "2026-04-12T00:00:06.000Z"),
      store.emitEvent(session.id, {
        id: "event-new",
        type: "user.message",
        createdAt: "2026-04-12T00:00:06.100Z",
        processedAt: null,
        message: "new pending work",
      }),
    ])

    const snapshot = await store.getSession(session.id)
    expect(await store.listRunnableSessionIds("alpha")).toEqual([session.id])
    const oldEvent = snapshot.events.find((event) => event.id === "event-old")
    const newEvent = snapshot.events.find((event) => event.id === "event-new")
    expect(oldEvent?.processedAt).toBe("2026-04-12T00:00:06.000Z")
    expect(newEvent?.processedAt).toBeNull()
    expect(snapshot.session.status).toBe("rescheduling")
  })

  it("preserves runnable entries when different sessions append concurrently", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const [first, second, third] = await Promise.all([
      store.createSession({ agentId: "alpha" }),
      store.createSession({ agentId: "alpha" }),
      store.createSession({ agentId: "alpha" }),
    ])

    await Promise.all([
      store.emitEvent(first.id, {
        id: makeUuidV7(),
        type: "user.message",
        createdAt: "2026-04-12T00:00:07.000Z",
        processedAt: null,
        message: "first concurrent ingress",
      }),
      store.emitEvent(second.id, {
        id: makeUuidV7(),
        type: "user.message",
        createdAt: "2026-04-12T00:00:07.000Z",
        processedAt: null,
        message: "second concurrent ingress",
      }),
      store.emitEvent(third.id, {
        id: makeUuidV7(),
        type: "user.message",
        createdAt: "2026-04-12T00:00:07.000Z",
        processedAt: null,
        message: "third concurrent ingress",
      }),
    ])

    expect(await store.listRunnableSessionIds("alpha")).toEqual(
      [first.id, second.id, third.id].sort(),
    )
  })
})
