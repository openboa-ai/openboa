import { describe, expect, it } from "vitest"
import { ConversationService } from "../src/chat/core/conversation-service.js"
import { SharedChatLedger } from "../src/chat/core/ledger.js"
import { nowIsoString } from "../src/foundation/time.js"
import { createChatFixture } from "./helpers.js"

describe("ConversationService", () => {
  it("returns the existing message on an idempotent retry instead of marking it stale", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })
    const service = new ConversationService(ledger.scopeId(), ledger)

    const first = await service.contributeToConversation({
      scope: {
        conversationId: conversation.conversationId,
        threadId: null,
      },
      sessionId: "sess-1",
      idempotencyKey: "msg-1",
      basedOnRevision: 0,
      basedOnMessageId: null,
      author: { kind: "participant", id: "founder" },
      body: "hello",
      createdAt: nowIsoString(),
    })
    const second = await service.contributeToConversation({
      scope: {
        conversationId: conversation.conversationId,
        threadId: null,
      },
      sessionId: "sess-1",
      idempotencyKey: "msg-1",
      basedOnRevision: 0,
      basedOnMessageId: null,
      author: { kind: "participant", id: "founder" },
      body: "hello",
      createdAt: nowIsoString(),
    })

    expect(first.status).toBe("accepted")
    expect(second.status).toBe("accepted")
    if (first.status !== "accepted" || second.status !== "accepted") {
      throw new Error("Expected accepted contributions")
    }
    expect(second.message.messageId).toBe(first.message.messageId)
    expect(second.revision).toBe(first.revision)

    const replay = await ledger.replayConversationState(
      conversation.conversationId,
      ledger.scopeId(),
    )
    expect(replay.messages).toHaveLength(1)
  })

  it("deduplicates system events by idempotency key inside a scope", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })
    const service = new ConversationService(ledger.scopeId(), ledger)

    const first = await service.postSystemMessage({
      scope: {
        conversationId: conversation.conversationId,
        threadId: null,
      },
      sessionId: "join:alpha",
      idempotencyKey: "join:alpha",
      author: { kind: "system", id: "chat" },
      body: "alpha joined the room.",
      systemEventKind: "participant-added",
    })
    const second = await service.postSystemMessage({
      scope: {
        conversationId: conversation.conversationId,
        threadId: null,
      },
      sessionId: "join:alpha",
      idempotencyKey: "join:alpha",
      author: { kind: "system", id: "chat" },
      body: "alpha joined the room.",
      systemEventKind: "participant-added",
    })

    expect(second.messageId).toBe(first.messageId)
    const replay = await ledger.replayConversationState(
      conversation.conversationId,
      ledger.scopeId(),
    )
    expect(replay.messages).toHaveLength(1)
    expect(replay.messages[0]?.messageKind).toBe("system-event")
    expect(replay.scopes[0]?.latestScopeSequence).toBe(1)
  })

  it("rejects invalid thread scopes before reading or contributing", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      updatedAt: nowIsoString(),
    })
    const service = new ConversationService(ledger.scopeId(), ledger)

    await expect(
      service.observeConversation({
        conversationId: conversation.conversationId,
        threadId: "missing-root",
      }),
    ).rejects.toThrow(
      "Thread scope requires an existing top-level root message in the same conversation",
    )

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
      service.contributeToConversation({
        scope: {
          conversationId: conversation.conversationId,
          threadId: reply.messageId,
        },
        sessionId: "nested-thread",
        basedOnRevision: 0,
        basedOnMessageId: null,
        author: { kind: "participant", id: "founder" },
        body: "nested thread reply",
        createdAt: nowIsoString(),
      }),
    ).rejects.toThrow("Threads cannot be nested under replies")
  })

  it("separates room participants from attached participants in observations", async () => {
    const storageDir = await createChatFixture()
    const ledger = new SharedChatLedger(storageDir)
    const conversation = await ledger.ensureConversation({
      kind: "channel",
      slug: "general",
      title: "general",
      participantIds: ["founder"],
      updatedAt: nowIsoString(),
    })
    await ledger.upsertConversationAttachment({
      conversationId: conversation.conversationId,
      threadId: null,
      participantId: "watcher",
      attached: true,
      updatedAt: nowIsoString(),
    })

    const service = new ConversationService(ledger.scopeId(), ledger)
    const observation = await service.observeConversation({
      conversationId: conversation.conversationId,
      threadId: null,
    })

    expect(observation.roomParticipantIds).toEqual(["founder"])
    expect(observation.attachedParticipantIds).toEqual(["watcher"])
    expect(observation.visibleParticipantIds).toEqual(["founder", "watcher"])
  })

  it("advances thread observations when the root message is edited", async () => {
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
    await ledger.appendMessage({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
      sessionId: "reply",
      author: { kind: "participant", id: "alpha" },
      body: "reply",
      createdAt: nowIsoString(),
    })

    const service = new ConversationService(ledger.scopeId(), ledger)
    const beforeEdit = await service.observeConversation({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
    })

    await ledger.editMessage({
      messageId: root.messageId,
      editor: { kind: "participant", id: "founder" },
      body: "root updated",
      createdAt: nowIsoString(),
    })

    const afterEdit = await service.observeConversation({
      conversationId: conversation.conversationId,
      threadId: root.messageId,
    })

    expect(afterEdit.revision).toBeGreaterThan(beforeEdit.revision)
    expect(afterEdit.messages[0]?.body).toBe("root updated")
  })
})
