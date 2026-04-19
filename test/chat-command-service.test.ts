import { describe, expect, it } from "vitest"
import { SharedChatLedger } from "../src/chat/core/ledger.js"
import type {
  ChatConversationRecord,
  ChatGrantBindingRecord,
  ChatRoomMembershipRecord,
} from "../src/chat/core/model.js"
import { CHAT_REDACTED_MESSAGE_BODY } from "../src/chat/core/model.js"
import {
  CHAT_ROLE_DEFINITIONS,
  evaluateChatAction,
  evaluateConversationAction,
  resolveScopedRoleIds,
} from "../src/chat/policy/authorization.js"
import { ChatCommandService } from "../src/chat/policy/command-service.js"
import { createChatFixture } from "./helpers.js"

function makeConversation(overrides: Partial<ChatConversationRecord> = {}): ChatConversationRecord {
  return {
    eventType: "conversation.upserted",
    scopeId: "chat",
    eventId: "conversation-event",
    sequence: 1,
    conversationId: "conversation-1",
    kind: "channel",
    section: "channels",
    slug: "ops",
    title: "ops",
    topic: null,
    visibility: "private",
    postingPolicy: "open",
    lifecycleState: "active",
    participantIds: ["alpha"],
    predecessorConversationId: null,
    lineageRootConversationId: "conversation-1",
    historyMode: "native",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    ...overrides,
  }
}

function makeGrantBinding(overrides: Partial<ChatGrantBindingRecord> = {}): ChatGrantBindingRecord {
  return {
    eventType: "authorization.grant-binding.upserted",
    scopeId: "chat",
    eventId: "grant-event",
    sequence: 1,
    bindingId: "grant-1",
    subjectId: "alpha",
    roleId: "participant",
    scopeKind: "conversation",
    conversationId: "conversation-1",
    bindingState: "active",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    ...overrides,
  }
}

function makeMembership(
  overrides: Partial<ChatRoomMembershipRecord> = {},
): ChatRoomMembershipRecord {
  return {
    eventType: "conversation.membership.upserted",
    scopeId: "chat",
    eventId: "membership-event",
    sequence: 1,
    conversationId: "conversation-1",
    participantId: "alpha",
    membershipState: "joined",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    ...overrides,
  }
}

describe("chat policy authorization", () => {
  it("defines built-in roles as explicit action bundles", () => {
    const actionsByRole = new Map(
      CHAT_ROLE_DEFINITIONS.map((definition) => [definition.roleId, definition.actions]),
    )

    expect(actionsByRole.get("viewer")).toEqual(["room.read"])
    expect(actionsByRole.get("participant")).toEqual([
      "room.read",
      "room.join",
      "room.leave",
      "message.create",
      "message.edit",
      "message.redact",
      "message.react",
    ])
    expect(actionsByRole.get("room_manager")).toEqual([
      "room.read",
      "room.join",
      "room.leave",
      "message.create",
      "message.edit",
      "message.redact",
      "message.react",
      "message.mass_mention",
      "room.settings.update",
      "room.archive",
      "room.membership.manage",
      "room.grant.manage",
    ])
    expect(actionsByRole.get("chat_admin")).toEqual([
      "chat.grant.manage",
      "room.read",
      "room.join",
      "room.leave",
      "message.create",
      "message.edit",
      "message.redact",
      "message.react",
      "message.mass_mention",
      "room.settings.update",
      "room.archive",
      "room.membership.manage",
      "room.grant.manage",
    ])
  })

  it("resolves grants by chat and conversation scope", () => {
    const bindings = [
      makeGrantBinding({
        bindingId: "chat-admin",
        roleId: "chat_admin",
        scopeKind: "chat",
        conversationId: null,
      }),
      makeGrantBinding({
        bindingId: "room-manager",
        roleId: "room_manager",
        conversationId: "conversation-1",
      }),
      makeGrantBinding({
        bindingId: "room-viewer",
        roleId: "viewer",
        conversationId: "conversation-2",
      }),
    ]

    expect(resolveScopedRoleIds(bindings, { scopeKind: "chat" })).toEqual(["chat_admin"])
    expect(
      resolveScopedRoleIds(bindings, {
        scopeKind: "conversation",
        conversationId: "conversation-1",
      }).sort(),
    ).toEqual(["chat_admin", "room_manager"])
    expect(
      resolveScopedRoleIds(bindings, {
        scopeKind: "conversation",
        conversationId: "conversation-2",
      }).sort(),
    ).toEqual(["chat_admin", "viewer"])
  })

  it("requires chat-scoped authority for chat grant management", () => {
    expect(
      evaluateChatAction({
        actorId: "alpha",
        bindings: [
          makeGrantBinding({
            roleId: "room_manager",
            conversationId: "conversation-1",
          }),
        ],
        action: "chat.grant.manage",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "No active role grants chat.grant.manage",
    })

    expect(
      evaluateChatAction({
        actorId: "founder",
        bindings: [
          makeGrantBinding({
            roleId: "chat_admin",
            scopeKind: "chat",
            conversationId: null,
          }),
        ],
        action: "chat.grant.manage",
      }),
    ).toMatchObject({
      allowed: true,
      roleIds: ["chat_admin"],
    })
  })

  it("lets chat-scoped admins govern room grants without a room-local role", () => {
    const decision = evaluateConversationAction({
      room: makeConversation(),
      actorId: "founder",
      bindings: [
        makeGrantBinding({
          roleId: "chat_admin",
          scopeKind: "chat",
          conversationId: null,
        }),
      ],
      membership: null,
      action: "room.grant.manage",
    })

    expect(decision).toMatchObject({
      allowed: true,
      roleIds: ["chat_admin"],
      isJoined: false,
    })
  })

  it("keeps viewer access read-only even when the actor is joined", () => {
    const decision = evaluateConversationAction({
      room: makeConversation(),
      actorId: "watcher",
      bindings: [
        makeGrantBinding({
          roleId: "viewer",
          subjectId: "watcher",
        }),
      ],
      membership: makeMembership({
        participantId: "watcher",
      }),
      action: "message.create",
    })

    expect(decision).toMatchObject({
      allowed: false,
      reason: "No active role grants message.create",
      roleIds: ["viewer"],
      isJoined: true,
    })

    const reactionDecision = evaluateConversationAction({
      room: makeConversation(),
      actorId: "watcher",
      bindings: [
        makeGrantBinding({
          roleId: "viewer",
          subjectId: "watcher",
        }),
      ],
      membership: makeMembership({
        participantId: "watcher",
      }),
      action: "message.react",
    })

    expect(reactionDecision).toMatchObject({
      allowed: false,
      reason: "No active role grants message.react",
      roleIds: ["viewer"],
      isJoined: true,
    })
  })
})

describe("ChatCommandService", () => {
  it("bootstraps chat_admin only once per chat scope", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)

    const first = await app.bootstrapChatAdmin({ subjectId: "founder" })
    const second = await app.bootstrapChatAdmin({ subjectId: "founder" })

    expect(second.bindingId).toBe(first.bindingId)
    await expect(app.bootstrapChatAdmin({ subjectId: "beta" })).rejects.toThrow(
      "Chat admin has already been bootstrapped",
    )
  })

  it("allows joined participants to post without prior registration", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
      ],
    })

    await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "alpha",
      body: "hello from alpha",
    })

    const transcript = await app.readConversationMessages({
      conversationId: conversation.conversationId,
      actorId: "founder",
    })

    expect(transcript.map((message) => message.body)).toEqual(["hello from alpha"])
  })

  it("supports bounded message reads with author and before filters", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
      ],
    })

    const first = await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "founder",
      body: "first founder note",
    })
    await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "alpha",
      body: "alpha update",
    })
    const third = await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "founder",
      body: "third founder note",
    })

    const founderOnly = await app.readConversationMessages({
      conversationId: conversation.conversationId,
      actorId: "founder",
      authorId: "founder",
      limit: 5,
    })
    expect(founderOnly.map((message) => message.messageId)).toEqual([
      first.messageId,
      third.messageId,
    ])

    const beforeThird = await app.readConversationMessages({
      conversationId: conversation.conversationId,
      actorId: "founder",
      beforeMessageId: third.messageId,
      limit: 2,
    })
    expect(beforeThird.map((message) => message.body)).toEqual([
      "first founder note",
      "alpha update",
    ])
  })

  it("builds inbox entries from unread direct messages and mentions", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "alpha",
    })
    const dm = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
      ],
    })

    const directUnread = await app.postMessage({
      conversationId: dm.conversationId,
      senderId: "alpha",
      body: "direct ping",
    })
    const mentionUnread = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "alpha",
      body: "@founder need a call on this",
    })

    const inbox = await app.readInbox({
      actorId: "founder",
    })

    expect(inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "direct",
          conversationId: dm.conversationId,
          messageId: directUnread.messageId,
        }),
        expect.objectContaining({
          kind: "mention",
          conversationId: room.conversationId,
          messageId: mentionUnread.messageId,
        }),
      ]),
    )
  })

  it("builds followed thread summaries from joined thread activity", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "alpha",
    })

    const root = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "thread root",
    })
    await app.postMessage({
      conversationId: room.conversationId,
      senderId: "alpha",
      threadId: root.messageId,
      body: "@founder thread follow-up",
    })

    const followedThreads = await app.readFollowedThreads({
      actorId: "founder",
    })

    expect(followedThreads).toEqual([
      expect.objectContaining({
        conversationId: room.conversationId,
        threadRootMessageId: root.messageId,
        unreadReplyCount: 1,
        unreadMentionCount: 1,
      }),
    ])
  })

  it("builds conversation summaries only for readable conversations", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const joinedConversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    await app.joinConversation({
      conversationId: joinedConversation.conversationId,
      participantId: "alpha",
    })
    const viewerConversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
      visibility: "private",
    })
    const hiddenConversation = await app.createChannel({
      slug: "secret",
      title: "secret",
      createdById: "alpha",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: viewerConversation.conversationId,
      subjectId: "founder",
      grantedById: "alpha",
    })
    await app.postMessage({
      conversationId: joinedConversation.conversationId,
      senderId: "alpha",
      body: "@founder mainline mention",
    })
    await app.postMessage({
      conversationId: viewerConversation.conversationId,
      senderId: "alpha",
      body: "viewer room update",
    })
    await app.postMessage({
      conversationId: hiddenConversation.conversationId,
      senderId: "alpha",
      body: "hidden room update",
    })

    const summaries = await app.readConversationSummaries({
      actorId: "founder",
    })

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: joinedConversation.conversationId,
          unreadCount: 1,
          mentionCount: 1,
        }),
        expect.objectContaining({
          conversationId: viewerConversation.conversationId,
          unreadCount: 0,
          mentionCount: 0,
        }),
      ]),
    )
    expect(
      summaries.some(
        (conversation) => conversation.conversationId === hiddenConversation.conversationId,
      ),
    ).toBe(false)
  })

  it("builds viewer recents from attached readable viewer rooms", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const viewerConversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: viewerConversation.conversationId,
      subjectId: "founder",
      grantedById: "alpha",
    })
    await app.setConversationWatchState({
      conversationId: viewerConversation.conversationId,
      actorId: "founder",
      attached: true,
    })
    await app.postMessage({
      conversationId: viewerConversation.conversationId,
      senderId: "alpha",
      body: "viewer room update",
    })

    const recents = await app.readViewerRecents({
      actorId: "founder",
    })

    expect(recents).toEqual([
      expect.objectContaining({
        conversationId: viewerConversation.conversationId,
        title: "ops",
      }),
    ])
  })

  it("lists only conversations the viewer can read", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const joinedConversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    const viewerConversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
      visibility: "private",
    })
    const hiddenConversation = await app.createChannel({
      slug: "secret",
      title: "secret",
      createdById: "alpha",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: viewerConversation.conversationId,
      subjectId: "founder",
      grantedById: "alpha",
    })

    const conversations = await app.readVisibleConversations({
      actorId: "founder",
    })

    expect(conversations.map((conversation) => conversation.conversationId)).toEqual(
      expect.arrayContaining([
        joinedConversation.conversationId,
        viewerConversation.conversationId,
      ]),
    )
    expect(
      conversations.some(
        (conversation) => conversation.conversationId === hiddenConversation.conversationId,
      ),
    ).toBe(false)
  })

  it("rejects reading a private conversation without access", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const hiddenConversation = await app.createChannel({
      slug: "secret",
      title: "secret",
      createdById: "alpha",
      visibility: "private",
    })

    await expect(
      app.readConversation({
        conversationId: hiddenConversation.conversationId,
        actorId: "founder",
      }),
    ).rejects.toThrow("Private rooms require an explicit grant")
  })

  it("resolves conversation refs by slug and id through the service boundary", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
    })

    await expect(
      app.resolveConversationRef({
        conversationRef: "ops",
      }),
    ).resolves.toMatchObject({
      conversationId: conversation.conversationId,
      slug: "ops",
    })

    await expect(
      app.resolveConversationRef({
        conversationRef: conversation.conversationId,
      }),
    ).resolves.toMatchObject({
      conversationId: conversation.conversationId,
      slug: "ops",
    })
  })

  it("lists only conversation-scoped events from readable conversations", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const joinedConversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    const viewerConversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
      visibility: "private",
    })
    const hiddenConversation = await app.createChannel({
      slug: "secret",
      title: "secret",
      createdById: "alpha",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: viewerConversation.conversationId,
      subjectId: "founder",
      grantedById: "alpha",
    })
    await app.postMessage({
      conversationId: viewerConversation.conversationId,
      senderId: "alpha",
      body: "viewer room update",
    })
    await app.postMessage({
      conversationId: hiddenConversation.conversationId,
      senderId: "alpha",
      body: "hidden room update",
    })

    const events = await app.readChatEvents({
      actorId: "founder",
    })

    expect(events.some((event) => event.conversationId === joinedConversation.conversationId)).toBe(
      true,
    )
    expect(events.some((event) => event.conversationId === viewerConversation.conversationId)).toBe(
      true,
    )
    expect(events.some((event) => event.conversationId === hiddenConversation.conversationId)).toBe(
      false,
    )
  })

  it("searches visible messages across joined and viewer-open conversations", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const joinedConversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
      ],
      title: "alpha",
    })
    const viewerConversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: viewerConversation.conversationId,
      subjectId: "founder",
      grantedById: "alpha",
    })

    const joinedMessage = await app.postMessage({
      conversationId: joinedConversation.conversationId,
      senderId: "alpha",
      body: "launch plan is ready",
    })
    const viewerMessage = await app.postMessage({
      conversationId: viewerConversation.conversationId,
      senderId: "alpha",
      body: "incident update",
    })

    const results = await app.searchVisibleMessages({
      actorId: "founder",
      query: "launch incident",
      limit: 5,
    })

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: joinedMessage.messageId,
          sourceConversationId: joinedConversation.conversationId,
          openConversationId: joinedConversation.conversationId,
          openMode: "joined",
        }),
        expect.objectContaining({
          messageId: viewerMessage.messageId,
          sourceConversationId: viewerConversation.conversationId,
          openConversationId: viewerConversation.conversationId,
          openMode: "viewer",
        }),
      ]),
    )
  })

  it("registers participants with chat metadata and reuses participant grants", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const participant = await app.registerParticipant({
      participantId: "alpha",
      displayName: "Alpha",
    })

    expect(participant).toMatchObject({
      participantId: "alpha",
      capabilities: ["chat-participant"],
      displayName: "Alpha",
    })

    const room = await app.createChannel({
      slug: "signals",
      title: "signals",
      createdById: "founder",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "alpha",
      grantedById: "founder",
    })

    const ledger = new SharedChatLedger(storageDir)
    expect(await ledger.getParticipantRecord("alpha", ledger.scopeId())).toMatchObject({
      participantId: "alpha",
      capabilities: ["chat-participant"],
      displayName: "Alpha",
    })
  })

  it("supports direct rooms across arbitrary participant ids without special participant kinds", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
        { kind: "participant", id: "remote-acp" },
      ],
    })

    expect(conversation.kind).toBe("group_dm")
    expect(conversation.participantIds).toEqual(["founder", "alpha", "remote-acp"])

    await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "alpha",
      senderKind: "participant",
      body: "local ready",
    })
    await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "remote-acp",
      senderKind: "participant",
      body: "external ready",
    })

    const transcript = await app.readConversationMessages({
      conversationId: conversation.conversationId,
      actorId: "founder",
    })

    expect(transcript.map((message) => message.body)).toEqual(["local ready", "external ready"])
  })

  it("allows addressed messages only to participants visible in the conversation scope", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "signals",
      title: "signals",
      createdById: "founder",
      visibility: "private",
    })

    await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })
    await app.setConversationWatchState({
      conversationId: room.conversationId,
      actorId: "watcher",
      attached: true,
    })

    const addressed = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "watcher can see this",
      audience: { kind: "participant", id: "watcher" },
    })
    expect(addressed.audience).toMatchObject({ id: "watcher", kind: "participant" })

    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })

    await expect(
      app.postMessage({
        conversationId: room.conversationId,
        senderId: "founder",
        body: "beta cannot see this yet",
        audience: { kind: "participant", id: "beta" },
      }),
    ).rejects.toThrow("Audience participant is not visible in the conversation scope")
  })

  it("supports private room participant invite followed by explicit join", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    const invite = await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })

    expect(invite.roleId).toBe("participant")
    expect(
      await app.readConversationMessages({
        conversationId: room.conversationId,
        actorId: "beta",
      }),
    ).toEqual([
      expect.objectContaining({
        messageKind: "system-event",
        systemEventKind: "room-grant-added",
        body: "beta was invited to the room.",
      }),
    ])

    const joined = await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })

    expect(joined.participantIds).toEqual(["founder", "beta"])
  })

  it("lets room managers remove another participant from the room", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })

    const updated = await app.removeConversationParticipant({
      conversationId: room.conversationId,
      actorId: "founder",
      participantId: "beta",
    })

    expect(updated.participantIds).toEqual(["founder"])
    const roster = await app.readConversationRoster({
      conversationId: room.conversationId,
      actorId: "founder",
    })
    expect(roster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: "founder",
          inConversation: true,
        }),
      ]),
    )
  })

  it("records room lifecycle changes as chat-native system messages", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    const viewerGrant = await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "sam",
      grantedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })
    await app.updateConversationSettings({
      conversationId: room.conversationId,
      updatedById: "founder",
      title: "ops-2",
      topic: "Launch room",
      postingPolicy: "restricted",
    })
    await app.removeConversationParticipant({
      conversationId: room.conversationId,
      actorId: "founder",
      participantId: "beta",
    })
    await app.revokeConversationGrantBinding({
      conversationId: room.conversationId,
      bindingId: viewerGrant.bindingId,
      actorId: "founder",
    })
    await app.archiveConversation({
      conversationId: room.conversationId,
      archivedById: "founder",
    })

    const transcript = await app.readConversationMessages({
      conversationId: room.conversationId,
      actorId: "founder",
    })
    const systemMessages = transcript.filter((message) => message.messageKind === "system-event")
    expect(systemMessages.map((message) => message.systemEventKind)).toEqual([
      "room-grant-added",
      "room-grant-added",
      "participant-added",
      "room-renamed",
      "room-topic-changed",
      "room-posting-policy-changed",
      "participant-left",
      "room-grant-revoked",
      "room-archived",
    ])
    expect(systemMessages.map((message) => message.body)).toEqual([
      "beta was invited to the room.",
      "sam can now view the room.",
      "beta joined the room.",
      'Room renamed to "ops-2".',
      'Room topic set to "Launch room".',
      "Room posting policy changed to restricted.",
      "beta was removed from the room.",
      "Viewer access for sam was revoked.",
      "Room archived.",
    ])

    const systemOnly = await app.readConversationMessages({
      conversationId: room.conversationId,
      actorId: "founder",
      messageKind: "system-event",
      limit: 10,
    })
    expect(systemOnly.map((message) => message.systemEventKind)).toEqual([
      "room-grant-added",
      "room-grant-added",
      "participant-added",
      "room-renamed",
      "room-topic-changed",
      "room-posting-policy-changed",
      "participant-left",
      "room-grant-revoked",
      "room-archived",
    ])

    const renamedOnly = await app.searchConversationMessages({
      conversationId: room.conversationId,
      actorId: "founder",
      query: "renamed ops-2",
      messageKind: "system-event",
      limit: 5,
    })
    expect(renamedOnly).toHaveLength(1)
    expect(renamedOnly[0]?.message.systemEventKind).toBe("room-renamed")
  })

  it("reads a conversation roster with membership, grants, and watch state", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    await app.registerParticipant({
      participantId: "beta",
      displayName: "Beta",
    })
    await app.registerParticipant({
      participantId: "watcher",
      displayName: "Watcher",
    })
    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })
    await app.setConversationWatchState({
      conversationId: room.conversationId,
      actorId: "watcher",
      attached: true,
    })

    const roster = await app.readConversationRoster({
      conversationId: room.conversationId,
      actorId: "founder",
    })

    expect(roster).toEqual([
      expect.objectContaining({
        participantId: "founder",
        inConversation: true,
        membershipState: "joined",
        conversationRoleIds: ["room_manager"],
        chatRoleIds: [],
        watchAttached: null,
      }),
      expect.objectContaining({
        participantId: "beta",
        displayName: "Beta",
        inConversation: false,
        membershipState: null,
        conversationRoleIds: ["participant"],
        watchAttached: null,
      }),
      expect.objectContaining({
        participantId: "watcher",
        displayName: "Watcher",
        inConversation: false,
        membershipState: null,
        conversationRoleIds: ["viewer"],
        watchAttached: true,
      }),
    ])
  })

  it("lists and revokes conversation grant bindings through the room manager surface", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    const invite = await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })

    const activeBindings = await app.readConversationGrantBindings({
      conversationId: room.conversationId,
      actorId: "founder",
    })
    expect(activeBindings.map((binding) => [binding.subjectId, binding.roleId])).toEqual([
      ["founder", "room_manager"],
      ["beta", "participant"],
      ["watcher", "viewer"],
    ])

    const revoked = await app.revokeConversationGrantBinding({
      conversationId: room.conversationId,
      bindingId: invite.bindingId,
      actorId: "founder",
    })
    expect(revoked.bindingState).toBe("revoked")

    const remainingActiveBindings = await app.readConversationGrantBindings({
      conversationId: room.conversationId,
      actorId: "founder",
    })
    expect(remainingActiveBindings.map((binding) => [binding.subjectId, binding.roleId])).toEqual([
      ["founder", "room_manager"],
      ["watcher", "viewer"],
    ])
  })

  it("treats viewer as read-only access without membership and supports revoke", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "signals",
      title: "signals",
      createdById: "founder",
      visibility: "private",
    })

    const viewerGrant = await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })

    expect(
      await app.readConversationMessages({
        conversationId: room.conversationId,
        actorId: "watcher",
      }),
    ).toEqual([
      expect.objectContaining({
        messageKind: "system-event",
        systemEventKind: "room-grant-added",
        body: "watcher can now view the room.",
      }),
    ])

    await expect(
      app.joinConversation({
        conversationId: room.conversationId,
        participantId: "watcher",
      }),
    ).rejects.toThrow("Joining a private room requires participant access")

    await expect(
      app.postMessage({
        conversationId: room.conversationId,
        senderId: "watcher",
        body: "hello",
      }),
    ).rejects.toThrow("No active role grants message.create")

    await app.revokeGrantBinding(viewerGrant.bindingId, "founder")

    await expect(
      app.readConversationMessages({
        conversationId: room.conversationId,
        actorId: "watcher",
      }),
    ).rejects.toThrow("Private rooms require an explicit grant")
  })

  it("lets chat admins manage room grants without room-local manager grants", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    await app.bootstrapChatAdmin({ subjectId: "founder" })

    const room = await app.createChannel({
      slug: "roadmap",
      title: "roadmap",
      createdById: "alpha",
      visibility: "private",
    })

    const viewerGrant = await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })

    expect(viewerGrant.roleId).toBe("viewer")
    expect(
      await app.readConversationMessages({
        conversationId: room.conversationId,
        actorId: "watcher",
      }),
    ).toEqual([
      expect.objectContaining({
        messageKind: "system-event",
        systemEventKind: "room-grant-added",
        body: "watcher can now view the room.",
      }),
    ])
  })

  it("grants DM participants default room_manager authority", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "beta" },
      ],
    })

    const viewerGrant = await app.grantViewerAccess({
      conversationId: conversation.conversationId,
      subjectId: "watcher",
      grantedById: "beta",
    })

    expect(viewerGrant.roleId).toBe("viewer")

    const ledger = new SharedChatLedger(storageDir)
    const betaBindings = await ledger.listGrantBindings(ledger.scopeId(), {
      subjectId: "beta",
      conversationId: conversation.conversationId,
    })

    expect(
      betaBindings
        .filter((binding) => binding.bindingState === "active")
        .map((binding) => binding.roleId)
        .sort(),
    ).toEqual(["participant", "room_manager"])
  })

  it("revokes private-room participant access after leave", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })

    const left = await app.leaveConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })

    expect(left.participantIds).toEqual(["founder"])
    await expect(
      app.readConversationMessages({
        conversationId: room.conversationId,
        actorId: "beta",
      }),
    ).rejects.toThrow("Private rooms require an explicit grant")
    await expect(
      app.joinConversation({
        conversationId: room.conversationId,
        participantId: "beta",
      }),
    ).rejects.toThrow("Joining a private room requires participant access")
  })

  it("prevents the last room_manager from leaving while other joined participants remain", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "signals",
      title: "signals",
      createdById: "founder",
      visibility: "private",
    })

    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })

    await expect(
      app.leaveConversation({
        conversationId: room.conversationId,
        participantId: "founder",
      }),
    ).rejects.toThrow("Cannot leave the room as the last room_manager")
  })

  it("allows room_manager handoff before leaving a private room", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "handoff",
      title: "handoff",
      createdById: "founder",
      visibility: "private",
    })

    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })
    await app.grantConversationRole({
      conversationId: room.conversationId,
      subjectId: "beta",
      roleId: "room_manager",
      grantedById: "founder",
    })

    const afterLeave = await app.leaveConversation({
      conversationId: room.conversationId,
      participantId: "founder",
    })

    expect(afterLeave.participantIds).toEqual(["beta"])
    const updated = await app.updateConversationSettings({
      conversationId: room.conversationId,
      updatedById: "beta",
      topic: "new owner",
    })
    expect(updated.topic).toBe("new owner")
  })

  it("allows room_manager mass mention only in the room mainline", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "announcements",
      title: "announcements",
      createdById: "founder",
    })

    const root = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "@channel launch in ten minutes",
    })

    expect(root.body).toBe("@channel launch in ten minutes")
    await expect(
      app.postMessage({
        conversationId: room.conversationId,
        senderId: "founder",
        threadId: root.messageId,
        body: "@channel follow-up details",
      }),
    ).rejects.toThrow("Mass mention is only allowed in room mainline")
  })

  it("blocks room managers from granting chat_admin without chat authority", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })

    await expect(
      app.grantChatRole({
        subjectId: "beta",
        roleId: "chat_admin",
        grantedById: "founder",
      }),
    ).rejects.toThrow("No active role grants chat.grant.manage")
  })

  it("normalizes cursor state and persists mark-read without duplicate cursor writes", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
      visibility: "private",
    })

    const threadRoot = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "thread root",
    })
    const mainlineFollowUp = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "mainline follow-up",
    })
    const threadReply = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      threadId: threadRoot.messageId,
      body: "thread reply",
    })

    const initialThreadCursor = await app.readConversationCursor({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
    })
    expect(initialThreadCursor).toMatchObject({
      participantId: "founder",
      conversationId: room.conversationId,
      threadId: threadRoot.messageId,
      hasPersistedCursor: false,
      lastObservedSequence: 0,
      lastObservedScopeSequence: 0,
      lastObservedScopeRevision: 0,
    })

    const mainlineCursor = await app.markConversationRead({
      conversationId: room.conversationId,
      actorId: "founder",
    })
    expect(mainlineCursor).toMatchObject({
      participantId: "founder",
      conversationId: room.conversationId,
      threadId: null,
      hasPersistedCursor: true,
      lastObservedSequence: mainlineFollowUp.sequence,
      lastObservedScopeSequence: mainlineFollowUp.scopeSequence,
      lastObservedScopeRevision: mainlineFollowUp.revision,
    })

    const repeatedMainlineCursor = await app.markConversationRead({
      conversationId: room.conversationId,
      actorId: "founder",
    })
    expect(repeatedMainlineCursor.updatedAt).toBe(mainlineCursor.updatedAt)

    const threadCursor = await app.markConversationRead({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
    })
    expect(threadCursor).toMatchObject({
      participantId: "founder",
      conversationId: room.conversationId,
      threadId: threadRoot.messageId,
      hasPersistedCursor: true,
      lastObservedSequence: threadReply.sequence,
      lastObservedScopeSequence: threadReply.scopeSequence,
      lastObservedScopeRevision: threadReply.revision,
    })

    const ledger = new SharedChatLedger(storageDir)
    const cursorEvents = (await ledger.listEvents()).filter(
      (event) => event.eventType === "conversation.cursor.updated",
    )
    expect(cursorEvents).toHaveLength(2)
  })

  it("normalizes thread follow state and deduplicates explicit follow updates", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "signals",
      title: "signals",
      createdById: "founder",
      visibility: "private",
    })
    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })
    const threadRoot = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "thread root",
    })

    const initial = await app.readThreadFollowState({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
    })
    expect(initial).toMatchObject({
      participantId: "founder",
      conversationId: room.conversationId,
      threadId: threadRoot.messageId,
      attached: null,
      hasPersistedAttachment: false,
    })

    const followed = await app.setThreadFollowState({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
      attached: true,
    })
    expect(followed).toMatchObject({
      attached: true,
      hasPersistedAttachment: true,
    })

    const repeatedFollow = await app.setThreadFollowState({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
      attached: true,
    })
    expect(repeatedFollow.updatedAt).toBe(followed.updatedAt)

    const unfollowed = await app.setThreadFollowState({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
      attached: false,
    })
    expect(unfollowed).toMatchObject({
      attached: false,
      hasPersistedAttachment: true,
    })

    const ledger = new SharedChatLedger(storageDir)
    const attachmentEvents = (await ledger.listEvents()).filter(
      (event) => event.eventType === "conversation.attachment.upserted",
    )
    expect(attachmentEvents).toHaveLength(2)
  })

  it("reads a thread view with root, replies, follow state, and cursor state", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "signals",
      title: "signals",
      createdById: "founder",
      visibility: "private",
    })
    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })
    const threadRoot = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "thread root",
    })
    await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      threadId: threadRoot.messageId,
      body: "reply one",
    })
    await app.postMessage({
      conversationId: room.conversationId,
      senderId: "beta",
      threadId: threadRoot.messageId,
      body: "reply two",
    })
    await app.setThreadFollowState({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
      attached: true,
    })
    await app.markConversationRead({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
    })

    const threadView = await app.readConversationThread({
      conversationId: room.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
      authorId: "founder",
      limit: 10,
    })

    expect(threadView.rootMessage.messageId).toBe(threadRoot.messageId)
    expect(threadView.replies.map((message) => message.body)).toEqual(["reply one"])
    expect(threadView.followState.attached).toBe(true)
    expect(threadView.cursorState.lastObservedScopeSequence).toBeGreaterThan(0)
  })

  it("normalizes room watch state and deduplicates explicit viewer updates", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "finance",
      title: "finance",
      createdById: "founder",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })

    const initial = await app.readConversationWatchState({
      conversationId: room.conversationId,
      actorId: "watcher",
    })
    expect(initial).toMatchObject({
      participantId: "watcher",
      conversationId: room.conversationId,
      threadId: null,
      attached: null,
      hasPersistedAttachment: false,
    })

    const watching = await app.setConversationWatchState({
      conversationId: room.conversationId,
      actorId: "watcher",
      attached: true,
    })
    expect(watching).toMatchObject({
      attached: true,
      hasPersistedAttachment: true,
    })

    const repeatedWatching = await app.setConversationWatchState({
      conversationId: room.conversationId,
      actorId: "watcher",
      attached: true,
    })
    expect(repeatedWatching.updatedAt).toBe(watching.updatedAt)

    const stopped = await app.setConversationWatchState({
      conversationId: room.conversationId,
      actorId: "watcher",
      attached: false,
    })
    expect(stopped).toMatchObject({
      attached: false,
      hasPersistedAttachment: true,
    })

    const ledger = new SharedChatLedger(storageDir)
    const attachmentEvents = (await ledger.listEvents()).filter(
      (event) => event.eventType === "conversation.attachment.upserted",
    )
    expect(attachmentEvents).toHaveLength(2)
  })

  it("toggles message reactions for joined participants and keeps viewer access read-only", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })
    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })
    await app.grantViewerAccess({
      conversationId: room.conversationId,
      subjectId: "watcher",
      grantedById: "founder",
    })

    const message = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "Launch status",
    })

    const reacted = await app.setMessageReaction({
      conversationId: room.conversationId,
      actorId: "beta",
      messageId: message.messageId,
      emoji: ":eyes:",
      active: true,
    })
    expect(reacted.reactions).toEqual([
      {
        emoji: ":eyes:",
        participantIds: ["beta"],
        count: 1,
      },
    ])

    const repeated = await app.setMessageReaction({
      conversationId: room.conversationId,
      actorId: "beta",
      messageId: message.messageId,
      emoji: ":eyes:",
      active: true,
    })
    expect(repeated.reactions).toEqual(reacted.reactions)

    const removed = await app.setMessageReaction({
      conversationId: room.conversationId,
      actorId: "beta",
      messageId: message.messageId,
      emoji: ":eyes:",
      active: false,
    })
    expect(removed.reactions).toEqual([])

    await expect(
      app.setMessageReaction({
        conversationId: room.conversationId,
        actorId: "watcher",
        messageId: message.messageId,
        emoji: ":eyes:",
        active: true,
      }),
    ).rejects.toThrow("No active role grants message.react")
  })

  it("searches readable conversation messages and supports author filters", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "search",
      title: "search",
      createdById: "founder",
      visibility: "private",
    })
    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })
    await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "Launch risk needs review",
    })
    await app.postMessage({
      conversationId: room.conversationId,
      senderId: "beta",
      body: "Review the launch checklist today",
    })

    const results = await app.searchConversationMessages({
      conversationId: room.conversationId,
      actorId: "founder",
      query: "launch review",
    })
    expect(results).toHaveLength(2)
    expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0)

    const founderOnly = await app.searchConversationMessages({
      conversationId: room.conversationId,
      actorId: "founder",
      query: "launch",
      authorId: "founder",
    })
    expect(founderOnly).toHaveLength(1)
    expect(founderOnly[0]?.message.author.id).toBe("founder")
  })

  it("edits author messages, redacts with manager authority, and blocks mutation after redaction", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const room = await app.createChannel({
      slug: "launch",
      title: "launch",
      createdById: "founder",
      visibility: "private",
    })
    await app.inviteParticipant({
      conversationId: room.conversationId,
      subjectId: "beta",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: room.conversationId,
      participantId: "beta",
    })

    const message = await app.postMessage({
      conversationId: room.conversationId,
      senderId: "founder",
      body: "Initial launch status",
    })

    const edited = await app.editMessage({
      conversationId: room.conversationId,
      actorId: "founder",
      messageId: message.messageId,
      body: "Updated launch status",
    })
    expect(edited.body).toBe("Updated launch status")
    expect(edited.editedById).toBe("founder")
    expect(edited.editedAt).not.toBeNull()

    const repeatedEdit = await app.editMessage({
      conversationId: room.conversationId,
      actorId: "founder",
      messageId: message.messageId,
      body: "Updated launch status",
    })
    expect(repeatedEdit.editedAt).toBe(edited.editedAt)

    await expect(
      app.editMessage({
        conversationId: room.conversationId,
        actorId: "beta",
        messageId: message.messageId,
        body: "beta override",
      }),
    ).rejects.toThrow("Only the original author can edit this message")

    await expect(
      app.redactMessage({
        conversationId: room.conversationId,
        actorId: "beta",
        messageId: message.messageId,
      }),
    ).rejects.toThrow("Only the author or a room manager can redact this message")

    await app.grantConversationRole({
      conversationId: room.conversationId,
      subjectId: "beta",
      roleId: "room_manager",
      grantedById: "founder",
    })

    const redacted = await app.redactMessage({
      conversationId: room.conversationId,
      actorId: "beta",
      messageId: message.messageId,
    })
    expect(redacted.body).toBe(CHAT_REDACTED_MESSAGE_BODY)
    expect(redacted.redactedById).toBe("beta")
    expect(redacted.redactedAt).not.toBeNull()
    expect(redacted.reactions).toEqual([])

    const repeatedRedaction = await app.redactMessage({
      conversationId: room.conversationId,
      actorId: "beta",
      messageId: message.messageId,
    })
    expect(repeatedRedaction.redactedAt).toBe(redacted.redactedAt)

    await expect(
      app.editMessage({
        conversationId: room.conversationId,
        actorId: "founder",
        messageId: message.messageId,
        body: "after redaction",
      }),
    ).rejects.toThrow("Redacted messages cannot be edited")

    await expect(
      app.setMessageReaction({
        conversationId: room.conversationId,
        actorId: "founder",
        messageId: message.messageId,
        emoji: ":eyes:",
        active: true,
      }),
    ).rejects.toThrow("Redacted messages cannot be mutated")

    const ledger = new SharedChatLedger(storageDir)
    const mutationEvents = (await ledger.listEvents()).filter(
      (event) => event.eventType === "message.edited" || event.eventType === "message.redacted",
    )
    expect(mutationEvents).toHaveLength(2)
  })
})
