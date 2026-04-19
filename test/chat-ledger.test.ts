import { existsSync, renameSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SharedChatLedger } from "../src/chat/core/ledger.js"
import { CHAT_REDACTED_MESSAGE_BODY } from "../src/chat/core/model.js"
import { nowIsoString } from "../src/foundation/time.js"
import { createChatFixture } from "./helpers.js"

describe("SharedChatLedger", () => {
  it("applies core room defaults when creating a channel", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const record = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    expect(record.visibility).toBe("public")
    expect(record.postingPolicy).toBe("open")
    expect(record.lifecycleState).toBe("active")
    expect(record.predecessorConversationId).toBeNull()
    expect(record.lineageRootConversationId).toBe(record.conversationId)
    expect(record.historyMode).toBe("native")
  })

  it("migrates legacy ledger filenames to the chat-ledger path", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const currentPath = ledger.filePath()
    const legacyPath = join(storageDir, ".openboa", "runtime", "company-ledger.jsonl")

    await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    renameSync(currentPath, legacyPath)
    expect(existsSync(currentPath)).toBe(false)
    expect(existsSync(legacyPath)).toBe(true)

    const migratedLedger = new SharedChatLedger(storageDir)
    const events = await migratedLedger.listEvents(migratedLedger.scopeId())

    expect(migratedLedger.filePath()).toBe(currentPath)
    expect(existsSync(currentPath)).toBe(true)
    expect(existsSync(legacyPath)).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe("conversation.upserted")
  })

  it("deduplicates direct rooms by exact participant set regardless of input order", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const directRoom = await ledger.ensureConversation({
      kind: "dm",
      title: "founder + alpha",
      participantIds: ["founder", "alpha"],
      updatedAt: nowIsoString(),
    })
    const sameDirectRoom = await ledger.ensureConversation({
      kind: "dm",
      title: "alpha + founder",
      participantIds: ["alpha", "founder"],
      updatedAt: nowIsoString(),
    })
    const groupRoom = await ledger.ensureConversation({
      kind: "group_dm",
      title: "founder + alpha + beta",
      participantIds: ["founder", "alpha", "beta"],
      updatedAt: nowIsoString(),
    })
    const sameGroupRoom = await ledger.ensureConversation({
      kind: "group_dm",
      title: "beta + founder + alpha",
      participantIds: ["beta", "founder", "alpha"],
      updatedAt: nowIsoString(),
    })

    expect(sameDirectRoom.conversationId).toBe(directRoom.conversationId)
    expect(sameGroupRoom.conversationId).toBe(groupRoom.conversationId)
    expect(groupRoom.conversationId).not.toBe(directRoom.conversationId)
  })

  it("rejects invalid top-level room shapes before persisting them", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    await expect(
      ledger.ensureConversation({
        kind: "channel",
        title: "general",
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Channels require a slug")

    await expect(
      ledger.ensureConversation({
        kind: "dm",
        slug: "alpha",
        title: "founder + alpha",
        participantIds: ["founder", "alpha"],
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Direct rooms do not support slugs")

    await expect(
      ledger.ensureConversation({
        kind: "dm",
        title: "founder only",
        participantIds: ["founder"],
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("DM rooms require exactly 2 unique participants")

    await expect(
      ledger.ensureConversation({
        kind: "group_dm",
        title: "founder + alpha",
        participantIds: ["founder", "alpha"],
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Group DM rooms require at least 3 unique participants")
  })

  it("stores lineage when a direct room expands to a new participant set", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const directRoom = await ledger.ensureConversation({
      kind: "dm",
      title: "alpha",
      participantIds: ["founder", "alpha"],
      updatedAt: nowIsoString(),
    })

    const expandedRoom = await ledger.ensureConversation({
      kind: "group_dm",
      title: "alpha + beta",
      participantIds: ["founder", "alpha", "beta"],
      predecessorConversationId: directRoom.conversationId,
      lineageRootConversationId: directRoom.lineageRootConversationId,
      updatedAt: nowIsoString(),
    })

    expect(expandedRoom.visibility).toBe("private")
    expect(expandedRoom.predecessorConversationId).toBe(directRoom.conversationId)
    expect(expandedRoom.lineageRootConversationId).toBe(directRoom.lineageRootConversationId)
    expect(expandedRoom.historyMode).toBe("inherit_full")
  })

  it("rejects direct-room lineage when the predecessor is not a strict participant subset", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const directRoom = await ledger.ensureConversation({
      kind: "dm",
      title: "alpha",
      participantIds: ["founder", "alpha"],
      updatedAt: nowIsoString(),
    })

    await expect(
      ledger.ensureConversation({
        kind: "group_dm",
        title: "beta + gamma",
        participantIds: ["founder", "beta", "gamma"],
        predecessorConversationId: directRoom.conversationId,
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Direct-room lineage requires a strict participant superset")
  })

  it("keeps direct-room participant sets immutable after creation", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const directRoom = await ledger.ensureConversation({
      kind: "group_dm",
      title: "alpha + beta",
      participantIds: ["founder", "alpha", "beta"],
      updatedAt: nowIsoString(),
    })

    await expect(
      ledger.updateConversation(directRoom.conversationId, {
        kind: "group_dm",
        title: "alpha + beta + gamma",
        participantIds: ["founder", "alpha", "beta", "gamma"],
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Direct room participant set is immutable")
  })

  it("requires a predecessor before a room can inherit history", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    await expect(
      ledger.ensureConversation({
        kind: "group_dm",
        title: "founder + alpha + beta",
        participantIds: ["founder", "alpha", "beta"],
        historyMode: "inherit_full",
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Inherited history requires a predecessor conversation")
  })

  it("records append-only membership facts when room participant sets change", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "launch-ops",
      title: "launch-ops",
      participantIds: ["founder"],
      updatedAt: nowIsoString(),
    })

    let memberships = await ledger.listRoomMembershipRecords(ledger.scopeId(), {
      conversationId: conversation.conversationId,
    })
    expect(
      memberships.map((membership) => ({
        participantId: membership.participantId,
        membershipState: membership.membershipState,
      })),
    ).toEqual([{ participantId: "founder", membershipState: "joined" }])

    await ledger.updateConversation(conversation.conversationId, {
      scopeId: ledger.scopeId(),
      kind: "channel",
      slug: "launch-ops",
      title: "launch-ops",
      participantIds: ["founder", "beta"],
      updatedAt: nowIsoString(),
    })
    await ledger.updateConversation(conversation.conversationId, {
      scopeId: ledger.scopeId(),
      kind: "channel",
      slug: "launch-ops",
      title: "launch-ops",
      participantIds: ["founder"],
      updatedAt: nowIsoString(),
    })

    memberships = await ledger.listRoomMembershipRecords(ledger.scopeId(), {
      conversationId: conversation.conversationId,
    })
    expect(
      memberships.map((membership) => ({
        participantId: membership.participantId,
        membershipState: membership.membershipState,
      })),
    ).toEqual([
      { participantId: "founder", membershipState: "joined" },
      { participantId: "beta", membershipState: "left" },
    ])
  })

  it("keeps room kind immutable across updates", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const room = await ledger.ensureConversation({
      kind: "channel",
      slug: "ops",
      title: "ops",
      participantIds: ["founder"],
      updatedAt: nowIsoString(),
    })

    await expect(
      ledger.updateConversation(room.conversationId, {
        kind: "dm",
        title: "founder + alpha",
        participantIds: ["founder", "alpha"],
        updatedAt: nowIsoString(),
      }),
    ).rejects.toThrow("Room kind is immutable")
  })

  it("stores the latest durable cursor per participant and scope", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })
    const threadRoot = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "thread-root",
      author: { kind: "participant", id: "founder" },
      body: "thread root",
      createdAt: nowIsoString(),
    })

    await ledger.upsertCursor({
      participantId: "founder",
      conversationId: conversation.conversationId,
      threadId: null,
      lastObservedSequence: 2,
      lastObservedScopeSequence: 2,
      lastObservedScopeRevision: 2,
      updatedAt: nowIsoString(),
    })
    await ledger.upsertCursor({
      participantId: "founder",
      conversationId: conversation.conversationId,
      threadId: null,
      lastObservedSequence: 5,
      lastObservedScopeSequence: 4,
      lastObservedScopeRevision: 4,
      lastContributedSequence: 5,
      updatedAt: nowIsoString(),
    })
    await ledger.upsertCursor({
      participantId: "founder",
      conversationId: conversation.conversationId,
      threadId: threadRoot.messageId,
      lastObservedSequence: 7,
      lastObservedScopeSequence: 3,
      lastObservedScopeRevision: 3,
      updatedAt: nowIsoString(),
    })

    const rootCursor = await ledger.listCursorRecords(ledger.scopeId(), {
      conversationId: conversation.conversationId,
      threadId: null,
      participantId: "founder",
    })
    expect(rootCursor).toHaveLength(1)
    expect(rootCursor[0]?.lastObservedSequence).toBe(5)
    expect(rootCursor[0]?.lastObservedScopeSequence).toBe(4)
    expect(rootCursor[0]?.lastObservedScopeRevision).toBe(4)
    expect(rootCursor[0]?.lastContributedSequence).toBe(5)

    const threadCursor = await ledger.listCursorRecords(ledger.scopeId(), {
      conversationId: conversation.conversationId,
      threadId: threadRoot.messageId,
      participantId: "founder",
    })
    expect(threadCursor).toHaveLength(1)
    expect(threadCursor[0]?.lastObservedSequence).toBe(7)
    expect(threadCursor[0]?.lastObservedScopeSequence).toBe(3)
    expect(threadCursor[0]?.threadId).toBe(threadRoot.messageId)
  })

  it("folds reaction events into message views and removes reactions when unset", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })
    const message = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root",
      author: { kind: "participant", id: "founder" },
      body: "status update",
      createdAt: nowIsoString(),
    })

    await ledger.setMessageReaction({
      messageId: message.messageId,
      emoji: ":eyes:",
      participant: { kind: "participant", id: "alpha" },
      active: true,
      createdAt: nowIsoString(),
    })
    await ledger.setMessageReaction({
      messageId: message.messageId,
      emoji: ":eyes:",
      participant: { kind: "participant", id: "beta" },
      active: true,
      createdAt: nowIsoString(),
    })
    await ledger.setMessageReaction({
      messageId: message.messageId,
      emoji: ":eyes:",
      participant: { kind: "participant", id: "alpha" },
      active: false,
      createdAt: nowIsoString(),
    })

    const messages = await ledger.listMessages(ledger.scopeId(), conversation.conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.reactions).toEqual([
      {
        emoji: ":eyes:",
        participantIds: ["beta"],
        count: 1,
      },
    ])
  })

  it("folds message edits and redactions into the latest transcript view", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })
    const root = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root",
      author: { kind: "participant", id: "founder" },
      body: "initial status",
      createdAt: nowIsoString(),
    })
    const followUp = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "follow-up",
      author: { kind: "participant", id: "alpha" },
      body: "second update",
      createdAt: nowIsoString(),
    })

    await ledger.editMessage({
      messageId: root.messageId,
      editor: { kind: "participant", id: "founder" },
      body: "edited status",
      createdAt: nowIsoString(),
    })
    await ledger.redactMessage({
      messageId: root.messageId,
      redactor: { kind: "participant", id: "alpha" },
      createdAt: nowIsoString(),
    })

    const messages = await ledger.listMessages(ledger.scopeId(), conversation.conversationId)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      messageId: root.messageId,
      body: CHAT_REDACTED_MESSAGE_BODY,
      content: CHAT_REDACTED_MESSAGE_BODY,
      editedById: "founder",
      redactedById: "alpha",
    })
    expect(messages[0]?.editedAt).not.toBeNull()
    expect(messages[0]?.redactedAt).not.toBeNull()
    expect(messages[0]?.revision).toBeGreaterThan(followUp.revision)
  })

  it("assigns scope-local sequence independently for room mainline and thread scopes", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    const root = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root-1",
      author: { kind: "participant", id: "founder" },
      body: "root",
      createdAt: nowIsoString(),
    })
    const mainReply = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root-2",
      author: { kind: "participant", id: "founder" },
      body: "main follow-up",
      createdAt: nowIsoString(),
    })
    const threadReply1 = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      sessionId: "thread-1",
      author: { kind: "participant", id: "alpha" },
      body: "thread reply 1",
      createdAt: nowIsoString(),
    })
    const threadReply2 = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      sessionId: "thread-2",
      author: { kind: "participant", id: "beta" },
      body: "thread reply 2",
      createdAt: nowIsoString(),
    })

    expect(root.scopeSequence).toBe(1)
    expect(mainReply.scopeSequence).toBe(2)
    expect(threadReply1.scopeSequence).toBe(1)
    expect(threadReply2.scopeSequence).toBe(2)

    const mainScope = await ledger.listScopeMessages(ledger.scopeId(), {
      conversationId: conversation.conversationId,
      threadId: null,
    })
    const threadScope = await ledger.listScopeMessages(ledger.scopeId(), {
      conversationId: conversation.conversationId,
      threadId: root.messageId,
    })

    expect(mainScope.map((message) => message.messageId)).toEqual([
      root.messageId,
      mainReply.messageId,
    ])
    expect(threadScope.map((message) => message.messageId)).toEqual([
      root.messageId,
      threadReply1.messageId,
      threadReply2.messageId,
    ])
  })

  it("rejects thread scope writes when the root message does not exist or is itself a reply", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    const root = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root",
      author: { kind: "participant", id: "founder" },
      body: "root",
      createdAt: nowIsoString(),
    })
    const reply = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      sessionId: "reply",
      author: { kind: "participant", id: "alpha" },
      body: "reply",
      createdAt: nowIsoString(),
    })

    await expect(
      ledger.appendMessage({
        conversationId: conversation.conversationId,
        threadId: "missing-root",
        sessionId: "missing",
        author: { kind: "participant", id: "founder" },
        body: "no root",
        createdAt: nowIsoString(),
      }),
    ).rejects.toThrow(
      "Thread scope requires an existing top-level root message in the same conversation",
    )

    await expect(
      ledger.appendMessage({
        conversationId: conversation.conversationId,
        threadId: reply.messageId,
        sessionId: "nested",
        author: { kind: "participant", id: "founder" },
        body: "nested",
        createdAt: nowIsoString(),
      }),
    ).rejects.toThrow("Threads cannot be nested under replies")
  })

  it("hydrates current participants from membership records instead of stale room snapshots", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)

    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "ops",
      title: "ops",
      participantIds: ["founder", "alpha"],
      updatedAt: nowIsoString(),
    })

    await ledger.upsertRoomMembership({
      conversationId: conversation.conversationId,
      participantId: "alpha",
      membershipState: "left",
      updatedAt: nowIsoString(),
    })
    await ledger.upsertRoomMembership({
      conversationId: conversation.conversationId,
      participantId: "beta",
      membershipState: "joined",
      updatedAt: nowIsoString(),
    })

    const hydrated = await ledger.getConversationById(conversation.conversationId, ledger.scopeId())

    expect(hydrated?.participantIds).toEqual(["founder", "beta"])
  })

  it("replays conversation state from the append-only ledger", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      participantIds: ["founder", "alpha"],
      updatedAt: nowIsoString(),
    })
    const root = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root",
      author: { kind: "participant", id: "founder" },
      body: "root",
      createdAt: nowIsoString(),
    })
    await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      sessionId: "thread",
      author: { kind: "participant", id: "alpha" },
      body: "reply",
      createdAt: nowIsoString(),
    })
    await ledger.upsertCursor({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      participantId: "alpha",
      lastObservedSequence: 4,
      lastObservedScopeSequence: 1,
      lastObservedScopeRevision: 1,
      updatedAt: nowIsoString(),
    })

    const replay = await ledger.replayConversationState(
      conversation.conversationId,
      ledger.scopeId(),
    )

    expect(replay.participantIds).toEqual(["founder", "alpha"])
    expect(replay.messages).toHaveLength(2)
    expect(replay.scopes.map((scope) => [scope.threadId, scope.latestScopeSequence])).toEqual([
      [null, 1],
      [root.messageId, 1],
    ])
    expect(replay.scopes[1]?.cursors[0]?.participantId).toBe("alpha")
    expect(replay.scopes[1]?.cursors[0]?.lastObservedScopeSequence).toBe(1)
  })

  it("builds participant-neutral transcript records from conversation messages", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "dm",
      title: "founder + alpha",
      participantIds: ["founder", "alpha"],
      updatedAt: nowIsoString(),
    })

    await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "sess-1",
      author: { kind: "participant", id: "founder" },
      audience: { kind: "participant", id: "alpha" },
      body: "hello",
      createdAt: nowIsoString(),
    })
    await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "sess-1",
      author: { kind: "participant", id: "alpha" },
      audience: { kind: "participant", id: "founder" },
      body: "hi",
      createdAt: nowIsoString(),
    })

    const transcript = await ledger.listTranscript(ledger.scopeId(), conversation.conversationId)

    expect(transcript).toHaveLength(2)
    expect(transcript[0]).toMatchObject({
      sender: { kind: "participant", id: "founder" },
      recipient: { kind: "participant", id: "alpha" },
      message: "hello",
    })
    expect(transcript[1]).toMatchObject({
      sender: { kind: "participant", id: "alpha" },
      recipient: { kind: "participant", id: "founder" },
      message: "hi",
    })
    expect(transcript[0]).not.toHaveProperty("agentId")
    expect(transcript[0]).not.toHaveProperty("direction")
  })

  it("deduplicates message appends by idempotency key within a scope", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    const first = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "sess-1",
      idempotencyKey: "msg-1",
      author: { kind: "participant", id: "founder" },
      body: "hello",
      createdAt: nowIsoString(),
    })
    const second = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "sess-1",
      idempotencyKey: "msg-1",
      author: { kind: "participant", id: "founder" },
      body: "hello",
      createdAt: nowIsoString(),
    })

    expect(second.messageId).toBe(first.messageId)
    const messages = await ledger.listMessages(ledger.scopeId(), conversation.conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.idempotencyKey).toBe("msg-1")
  })

  it("rejects invalid system-event message shapes before append", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    await expect(
      ledger.appendMessage({
        conversationId: conversation.conversationId,
        threadId: null,
        sessionId: "system-without-kind",
        author: { kind: "system", id: "chat" },
        body: "alpha joined the room.",
        createdAt: nowIsoString(),
        messageKind: "system-event",
      }),
    ).rejects.toThrow("System events require an explicit chat-native systemEventKind")

    await expect(
      ledger.appendMessage({
        conversationId: conversation.conversationId,
        threadId: null,
        sessionId: "participant-with-kind",
        author: { kind: "participant", id: "founder" },
        body: "hello",
        createdAt: nowIsoString(),
        systemEventKind: "participant-added",
      }),
    ).rejects.toThrow("Participant messages cannot set a systemEventKind")

    await expect(
      ledger.appendMessage({
        conversationId: conversation.conversationId,
        threadId: null,
        sessionId: "legacy-kind",
        author: { kind: "system", id: "chat" },
        body: "tracking update",
        createdAt: nowIsoString(),
        messageKind: "system-event",
        systemEventKind: "business-tracking" as never,
      }),
    ).rejects.toThrow("System events must use a chat-native room reality kind")
  })

  it("treats idempotency keys as scope-local instead of conversation-global", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })

    const root = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "root",
      author: { kind: "participant", id: "founder" },
      body: "root",
      createdAt: nowIsoString(),
    })
    const mainline = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: null,
      sessionId: "main",
      idempotencyKey: "same-key",
      author: { kind: "participant", id: "founder" },
      body: "mainline message",
      createdAt: nowIsoString(),
    })
    const threadReply = await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      sessionId: "thread",
      idempotencyKey: "same-key",
      author: { kind: "participant", id: "alpha" },
      body: "thread message",
      createdAt: nowIsoString(),
    })

    expect(threadReply.messageId).not.toBe(mainline.messageId)
    expect(mainline.scopeSequence).toBe(2)
    expect(threadReply.scopeSequence).toBe(1)

    const replay = await ledger.replayConversationState(
      conversation.conversationId,
      ledger.scopeId(),
    )
    expect(replay.messages.map((message) => message.messageId)).toEqual([
      root.messageId,
      mainline.messageId,
      threadReply.messageId,
    ])
  })
})
