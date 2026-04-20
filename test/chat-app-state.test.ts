import { describe, expect, it } from "vitest"
import { CHAT_REDACTED_MESSAGE_BODY } from "../src/chat/core/model.js"
import { ChatCommandService } from "../src/chat/policy/command-service.js"
import { openViewerRecentConversation } from "../src/shell/chat/index.js"
import {
  addDesktopChatConversationParticipant,
  archiveDesktopChatConversation,
  editDesktopChatMessage,
  grantDesktopChatConversationAccess,
  joinDesktopChatConversation,
  leaveDesktopChatConversation,
  loadDesktopChatRuntimeSeed,
  markDesktopChatRead,
  pollDesktopChatEvents,
  postDesktopChatMessage,
  redactDesktopChatMessage,
  removeDesktopChatConversationParticipant,
  revokeDesktopChatConversationAccess,
  searchDesktopChatMessages,
  setDesktopChatMessageReaction,
  setDesktopChatThreadFollowState,
  updateDesktopChatConversationSettings,
} from "../src/shell/desktop/chat-runtime-gateway.js"
import {
  addChatConversationParticipant,
  appendChatMessage,
  archiveChatConversation,
  buildChatRuntimeState,
  chatSearchResultKey,
  createChatConversation,
  createChatDirectConversation,
  createChatShellRuntimeSeed,
  editChatMessage,
  grantChatConversationAccess,
  hideChatViewerConversation,
  joinChatConversation,
  leaveChatConversation,
  markChatConversationRead,
  markChatThreadRead,
  openChatSearchResult,
  openChatSidebarItem,
  redactChatMessage,
  removeChatConversationParticipant,
  resolveChatSearchSelection,
  resolveInitialChatSidebarItemId,
  restoreChatDraftPersistence,
  restoreChatShellRuntimeSeed,
  retargetChatShellRuntimeSeed,
  revokeChatConversationAccess,
  searchChatMessages,
  setChatThreadFollowState,
  setChatThreadOpenState,
  toggleChatConversationPostingPolicy,
  toggleChatMessageReaction,
  updateChatConversationDetails,
} from "../src/shell/web/chat-app-state.js"
import {
  addChatShellRuntimeConversationParticipant,
  archiveChatShellRuntimeConversation,
  editChatShellRuntimeMessage as editChatShellRuntimeMessageCommand,
  grantChatShellRuntimeConversationAccess,
  joinChatShellRuntimeConversation,
  leaveChatShellRuntimeConversation,
  loadChatShellRuntimeSeed,
  markChatShellRuntimeRead,
  pollChatShellRuntimeEvents,
  postChatShellRuntimeMessage,
  redactChatShellRuntimeMessage,
  removeChatShellRuntimeConversationParticipant,
  revokeChatShellRuntimeConversationAccess,
  searchChatShellRuntimeMessages,
  setChatShellRuntimeMessageReaction,
  setChatShellRuntimeThreadFollowState,
  updateChatShellRuntimeConversationSettings,
} from "../src/shell/web/chat-runtime-gateway.js"
import { makeConversationRecord, makeProjectedMessage } from "../src/shell/web/chat-seed.js"
import { createChatSingleFlightGate } from "../src/shell/web/chat-submit.js"
import { createChatFixture } from "./helpers.js"

function restoreWindow(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, "window", descriptor)
    return
  }
  Reflect.deleteProperty(globalThis, "window")
}

describe("chat shell runtime state", () => {
  it("drops overlapping submit attempts while the first send is still in flight", async () => {
    const gate = createChatSingleFlightGate()
    let resolveFirst: (() => void) | null = null
    let runCount = 0

    const firstRun = gate(async () => {
      runCount += 1
      await new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
    })
    const secondRun = gate(async () => {
      runCount += 1
    })

    await expect(secondRun).resolves.toEqual({ started: false })
    expect(runCount).toBe(1)

    resolveFirst?.()
    await expect(firstRun).resolves.toEqual({ started: true, value: undefined })

    await expect(
      gate(async () => {
        runCount += 1
      }),
    ).resolves.toEqual({ started: true, value: undefined })
    expect(runCount).toBe(2)
  })

  it("prefers the desktop chat gateway when it is available", async () => {
    const gatewaySeed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        openboaChatGateway: {
          async loadSeed(input: { actorId: string }) {
            expect(input.actorId).toBe("alpha")
            return gatewaySeed
          },
        },
      },
    })

    try {
      await expect(
        loadChatShellRuntimeSeed({
          actorId: "alpha",
        }),
      ).resolves.toBe(gatewaySeed)
    } finally {
      restoreWindow(originalWindow)
    }
  })

  it("returns null when the desktop chat gateway is unavailable", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

    Reflect.deleteProperty(globalThis, "window")

    try {
      await expect(
        loadChatShellRuntimeSeed({
          actorId: "founder",
        }),
      ).resolves.toBeNull()
    } finally {
      restoreWindow(originalWindow)
    }
  })

  it("rejects when the desktop chat gateway fails", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        openboaChatGateway: {
          async loadSeed() {
            throw new Error("boom")
          },
        },
      },
    })

    try {
      await expect(
        loadChatShellRuntimeSeed({
          actorId: "founder",
        }),
      ).rejects.toThrow("boom")
    } finally {
      restoreWindow(originalWindow)
    }
  })

  it("routes message, attention, search, and room management commands through the available runtime gateway", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        openboaChatGateway: {
          async loadSeed() {
            return createChatShellRuntimeSeed()
          },
          async postMessage(input: unknown) {
            calls.push({ method: "postMessage", input })
          },
          async setMessageReaction(input: unknown) {
            calls.push({ method: "setMessageReaction", input })
          },
          async editMessage(input: unknown) {
            calls.push({ method: "editMessage", input })
          },
          async redactMessage(input: unknown) {
            calls.push({ method: "redactMessage", input })
          },
          async markRead(input: unknown) {
            calls.push({ method: "markRead", input })
          },
          async setThreadFollowState(input: unknown) {
            calls.push({ method: "setThreadFollowState", input })
          },
          async searchMessages(input: unknown) {
            calls.push({ method: "searchMessages", input })
            return []
          },
          async pollEvents(input: unknown) {
            calls.push({ method: "pollEvents", input })
            return { nextSequence: 12, hasEvents: true }
          },
          async joinConversation(input: unknown) {
            calls.push({ method: "joinConversation", input })
          },
          async leaveConversation(input: unknown) {
            calls.push({ method: "leaveConversation", input })
          },
          async addParticipant(input: unknown) {
            calls.push({ method: "addParticipant", input })
          },
          async removeParticipant(input: unknown) {
            calls.push({ method: "removeParticipant", input })
          },
          async grantAccess(input: unknown) {
            calls.push({ method: "grantAccess", input })
          },
          async revokeAccess(input: unknown) {
            calls.push({ method: "revokeAccess", input })
          },
          async updateConversationSettings(input: unknown) {
            calls.push({ method: "updateConversationSettings", input })
          },
          async archiveConversation(input: unknown) {
            calls.push({ method: "archiveConversation", input })
          },
        },
      },
    })

    try {
      await expect(
        postChatShellRuntimeMessage({
          actorId: "founder",
          conversationId: "general",
          body: "hello",
          threadId: null,
          audienceId: "alpha",
        }),
      ).resolves.toBe(true)
      await expect(
        setChatShellRuntimeMessageReaction({
          actorId: "founder",
          conversationId: "general",
          messageId: "message-1",
          emoji: "🙂",
          active: true,
        }),
      ).resolves.toBe(true)
      await expect(
        editChatShellRuntimeMessageCommand({
          actorId: "founder",
          conversationId: "general",
          messageId: "message-1",
          body: "edited",
        }),
      ).resolves.toBe(true)
      await expect(
        redactChatShellRuntimeMessage({
          actorId: "founder",
          conversationId: "general",
          messageId: "message-1",
        }),
      ).resolves.toBe(true)
      await expect(
        markChatShellRuntimeRead({
          actorId: "founder",
          conversationId: "general",
          threadId: "thread-1",
        }),
      ).resolves.toBe(true)
      await expect(
        setChatShellRuntimeThreadFollowState({
          actorId: "founder",
          conversationId: "general",
          threadId: "thread-1",
          followed: true,
        }),
      ).resolves.toBe(true)
      await expect(
        searchChatShellRuntimeMessages({
          actorId: "founder",
          query: "launch",
          limit: 8,
        }),
      ).resolves.toEqual([])
      await expect(
        pollChatShellRuntimeEvents({
          actorId: "founder",
          afterSequence: 4,
          limit: 8,
        }),
      ).resolves.toEqual({
        nextSequence: 12,
        hasEvents: true,
      })
      await expect(
        joinChatShellRuntimeConversation({
          actorId: "founder",
          conversationId: "general",
        }),
      ).resolves.toBe(true)
      await expect(
        leaveChatShellRuntimeConversation({
          actorId: "founder",
          conversationId: "general",
        }),
      ).resolves.toBe(true)
      await expect(
        addChatShellRuntimeConversationParticipant({
          actorId: "founder",
          conversationId: "general",
          participantId: "alpha",
        }),
      ).resolves.toBe(true)
      await expect(
        removeChatShellRuntimeConversationParticipant({
          actorId: "founder",
          conversationId: "general",
          participantId: "alpha",
        }),
      ).resolves.toBe(true)
      await expect(
        grantChatShellRuntimeConversationAccess({
          actorId: "founder",
          conversationId: "general",
          participantId: "alpha",
          roleId: "viewer",
        }),
      ).resolves.toBe(true)
      await expect(
        revokeChatShellRuntimeConversationAccess({
          actorId: "founder",
          conversationId: "general",
          bindingId: "binding-1",
        }),
      ).resolves.toBe(true)
      await expect(
        updateChatShellRuntimeConversationSettings({
          actorId: "founder",
          conversationId: "general",
          title: "Launch",
          topic: "Final owners",
          visibility: "private",
          postingPolicy: "restricted",
        }),
      ).resolves.toBe(true)
      await expect(
        archiveChatShellRuntimeConversation({
          actorId: "founder",
          conversationId: "general",
        }),
      ).resolves.toBe(true)

      expect(calls).toEqual([
        {
          method: "postMessage",
          input: {
            actorId: "founder",
            conversationId: "general",
            body: "hello",
            threadId: null,
            audienceId: "alpha",
          },
        },
        {
          method: "setMessageReaction",
          input: {
            actorId: "founder",
            conversationId: "general",
            messageId: "message-1",
            emoji: "🙂",
            active: true,
          },
        },
        {
          method: "editMessage",
          input: {
            actorId: "founder",
            conversationId: "general",
            messageId: "message-1",
            body: "edited",
          },
        },
        {
          method: "redactMessage",
          input: {
            actorId: "founder",
            conversationId: "general",
            messageId: "message-1",
          },
        },
        {
          method: "markRead",
          input: {
            actorId: "founder",
            conversationId: "general",
            threadId: "thread-1",
          },
        },
        {
          method: "setThreadFollowState",
          input: {
            actorId: "founder",
            conversationId: "general",
            threadId: "thread-1",
            followed: true,
          },
        },
        {
          method: "searchMessages",
          input: {
            actorId: "founder",
            query: "launch",
            limit: 8,
          },
        },
        {
          method: "pollEvents",
          input: {
            actorId: "founder",
            afterSequence: 4,
            limit: 8,
          },
        },
        {
          method: "joinConversation",
          input: {
            actorId: "founder",
            conversationId: "general",
          },
        },
        {
          method: "leaveConversation",
          input: {
            actorId: "founder",
            conversationId: "general",
          },
        },
        {
          method: "addParticipant",
          input: {
            actorId: "founder",
            conversationId: "general",
            participantId: "alpha",
          },
        },
        {
          method: "removeParticipant",
          input: {
            actorId: "founder",
            conversationId: "general",
            participantId: "alpha",
          },
        },
        {
          method: "grantAccess",
          input: {
            actorId: "founder",
            conversationId: "general",
            participantId: "alpha",
            roleId: "viewer",
          },
        },
        {
          method: "revokeAccess",
          input: {
            actorId: "founder",
            conversationId: "general",
            bindingId: "binding-1",
          },
        },
        {
          method: "updateConversationSettings",
          input: {
            actorId: "founder",
            conversationId: "general",
            title: "Launch",
            topic: "Final owners",
            visibility: "private",
            postingPolicy: "restricted",
          },
        },
        {
          method: "archiveConversation",
          input: {
            actorId: "founder",
            conversationId: "general",
          },
        },
      ])
    } finally {
      restoreWindow(originalWindow)
    }
  })

  it("applies desktop message mutations and rehydrates the updated ledger seed", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })

    await postDesktopChatMessage(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      body: "Launch note ready for review.",
    })
    const postedMessage =
      (
        await app.readConversationMessages({
          conversationId: conversation.conversationId,
          actorId: "founder",
        })
      ).at(-1) ?? null
    expect(postedMessage).not.toBeNull()
    if (!postedMessage) {
      return
    }

    await setDesktopChatMessageReaction(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      messageId: postedMessage.messageId,
      emoji: "🙂",
      active: true,
    })
    await editDesktopChatMessage(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      messageId: postedMessage.messageId,
      body: "Edited launch note ready for review.",
    })

    let seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    const watermarkAfterEdit = seed.eventWatermark
    let transcriptMessage =
      seed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.at(-1) ??
      null

    expect(transcriptMessage).toMatchObject({
      messageId: postedMessage.messageId,
      body: "Edited launch note ready for review.",
      editedAt: expect.any(String),
      reactions: [
        expect.objectContaining({
          emoji: "🙂",
          participantIds: ["founder"],
        }),
      ],
    })

    await redactDesktopChatMessage(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      messageId: postedMessage.messageId,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    expect(seed.eventWatermark).toBeGreaterThan(watermarkAfterEdit)
    transcriptMessage =
      seed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.at(-1) ??
      null

    expect(transcriptMessage).toMatchObject({
      messageId: postedMessage.messageId,
      body: CHAT_REDACTED_MESSAGE_BODY,
      redactedAt: expect.any(String),
    })
  })

  it("polls desktop chat events from the current watermark", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })

    const initialSeed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    const initialPoll = await pollDesktopChatEvents(storageDir, {
      actorId: "founder",
      afterSequence: initialSeed.eventWatermark,
      limit: 8,
    })
    expect(initialPoll).toEqual({
      nextSequence: initialSeed.eventWatermark,
      hasEvents: false,
    })

    await postDesktopChatMessage(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      body: "incremental refresh probe",
    })

    const nextPoll = await pollDesktopChatEvents(storageDir, {
      actorId: "founder",
      afterSequence: initialSeed.eventWatermark,
      limit: 8,
    })
    expect(nextPoll.hasEvents).toBe(true)
    expect(nextPoll.nextSequence).toBeGreaterThan(initialSeed.eventWatermark)
  })

  it("applies desktop attention mutations and rehydrates read and follow state", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    await app.inviteParticipant({
      conversationId: conversation.conversationId,
      subjectId: "alpha",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: conversation.conversationId,
      participantId: "alpha",
    })

    const threadRoot = await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "alpha",
      body: "@founder check the launch thread.",
    })
    await app.postMessage({
      conversationId: conversation.conversationId,
      senderId: "alpha",
      threadId: threadRoot.messageId,
      body: "thread follow-up",
    })
    await setDesktopChatThreadFollowState(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      threadId: threadRoot.messageId,
      followed: true,
    })

    let seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    expect(seed.baseChat.sidebar.inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: conversation.conversationId,
          kind: "mention",
        }),
      ]),
    )
    expect(seed.baseChat.sidebar.followedThreads).toEqual([
      expect.objectContaining({
        conversationId: conversation.conversationId,
        threadRootMessageId: threadRoot.messageId,
        unreadReplyCount: 1,
      }),
    ])

    await markDesktopChatRead(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      threadId: threadRoot.messageId,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    expect(seed.baseChat.sidebar.followedThreads).toEqual([
      expect.objectContaining({
        conversationId: conversation.conversationId,
        threadRootMessageId: threadRoot.messageId,
        unreadReplyCount: 0,
      }),
    ])

    await markDesktopChatRead(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      threadId: null,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    expect(seed.baseChat.sidebar.inbox).toEqual([])

    await setDesktopChatThreadFollowState(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      threadId: threadRoot.messageId,
      followed: false,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    expect(seed.baseChat.sidebar.followedThreads).toEqual([])
  })

  it("applies desktop join and leave mutations and rehydrates viewer state", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "founder",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: conversation.conversationId,
      subjectId: "alpha",
      grantedById: "founder",
    })
    await app.inviteParticipant({
      conversationId: conversation.conversationId,
      subjectId: "alpha",
      invitedById: "founder",
    })
    await app.setConversationWatchState({
      conversationId: conversation.conversationId,
      actorId: "alpha",
      attached: true,
    })

    let seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "alpha",
    })
    expect(seed.baseChat.sidebar.viewerRecents).toEqual([
      expect.objectContaining({
        conversationId: conversation.conversationId,
      }),
    ])
    expect(seed.itemsBySidebarItemId[conversation.conversationId]?.openIntent.openMode).toBe(
      "viewer",
    )

    await joinDesktopChatConversation(storageDir, {
      actorId: "alpha",
      conversationId: conversation.conversationId,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "alpha",
    })
    expect(seed.baseChat.sidebar.channels).toEqual([
      expect.objectContaining({
        conversationId: conversation.conversationId,
      }),
    ])
    expect(seed.baseChat.sidebar.viewerRecents).toEqual([])
    expect(seed.itemsBySidebarItemId[conversation.conversationId]?.openIntent.openMode).toBe(
      "joined",
    )

    await leaveDesktopChatConversation(storageDir, {
      actorId: "alpha",
      conversationId: conversation.conversationId,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "alpha",
    })
    expect(seed.baseChat.sidebar.channels).toEqual([])
    expect(seed.baseChat.sidebar.viewerRecents).toEqual([
      expect.objectContaining({
        conversationId: conversation.conversationId,
      }),
    ])
    expect(seed.itemsBySidebarItemId[conversation.conversationId]?.openIntent.openMode).toBe(
      "viewer",
    )
  })

  it("applies desktop room management mutations and rehydrates roster, grants, settings, and archive state", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const conversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })

    await addDesktopChatConversationParticipant(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      participantId: "alpha",
    })
    await grantDesktopChatConversationAccess(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      participantId: "alpha",
      roleId: "room_manager",
    })
    await grantDesktopChatConversationAccess(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      participantId: "beta",
      roleId: "viewer",
    })
    await grantDesktopChatConversationAccess(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      participantId: "gamma",
      roleId: "participant",
    })

    let seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    let item = seed.itemsBySidebarItemId[conversation.conversationId]
    expect(item?.conversation.participantIds).toEqual(expect.arrayContaining(["founder", "alpha"]))
    expect(item?.accessGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectId: "alpha",
          roleId: "room_manager",
        }),
        expect.objectContaining({
          subjectId: "beta",
          roleId: "viewer",
        }),
        expect.objectContaining({
          subjectId: "gamma",
          roleId: "participant",
        }),
      ]),
    )

    const viewerGrantBindingId = item?.accessGrants?.find(
      (grant) => grant.subjectId === "beta" && grant.roleId === "viewer",
    )?.bindingId
    expect(viewerGrantBindingId).toBeTruthy()

    await updateDesktopChatConversationSettings(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      title: "Launch Readiness",
      topic: "Final release owners",
      visibility: "private",
      postingPolicy: "restricted",
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    item = seed.itemsBySidebarItemId[conversation.conversationId]
    expect(item?.conversation).toMatchObject({
      title: "Launch Readiness",
      topic: "Final release owners",
      visibility: "private",
      postingPolicy: "restricted",
    })

    await removeDesktopChatConversationParticipant(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      participantId: "alpha",
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    item = seed.itemsBySidebarItemId[conversation.conversationId]
    expect(item?.conversation.participantIds).not.toContain("alpha")
    expect(
      item?.accessGrants?.some(
        (grant) => grant.subjectId === "alpha" && grant.roleId === "room_manager",
      ),
    ).toBe(false)

    await revokeDesktopChatConversationAccess(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      bindingId: viewerGrantBindingId ?? "",
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    item = seed.itemsBySidebarItemId[conversation.conversationId]
    expect(
      item?.accessGrants?.some((grant) => grant.subjectId === "beta" && grant.roleId === "viewer"),
    ).toBe(false)

    await archiveDesktopChatConversation(storageDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
    })

    seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    item = seed.itemsBySidebarItemId[conversation.conversationId]
    expect(item?.conversation.lifecycleState).toBe("archived")
    expect(item?.projection.mainTranscript.at(-1)).toMatchObject({
      systemEventKind: "room-archived",
      body: "Room archived.",
    })
  })

  it("searches through command service results and can open hidden viewer hits", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const joinedConversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
      ],
      title: "alpha",
    })
    const hiddenViewerConversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      createdById: "alpha",
      visibility: "private",
    })
    await app.grantViewerAccess({
      conversationId: hiddenViewerConversation.conversationId,
      subjectId: "founder",
      grantedById: "alpha",
    })
    await app.postMessage({
      conversationId: joinedConversation.conversationId,
      senderId: "alpha",
      body: "launch plan is ready",
    })
    const hiddenViewerMessage = await app.postMessage({
      conversationId: hiddenViewerConversation.conversationId,
      senderId: "alpha",
      body: "incident update",
    })

    const seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })
    const results = await searchDesktopChatMessages(storageDir, {
      actorId: "founder",
      query: "incident",
      limit: 8,
    })
    const firstResult = results[0]
    if (!firstResult) {
      throw new Error("Expected at least one desktop search result")
    }

    expect(firstResult).toMatchObject({
      sidebarItemId: hiddenViewerConversation.conversationId,
      conversationId: hiddenViewerConversation.conversationId,
      messageId: hiddenViewerMessage.messageId,
      openMode: "viewer",
    })
    expect(
      seed.itemsBySidebarItemId[`viewer:${hiddenViewerConversation.conversationId}`],
    ).toBeUndefined()

    const nextSeed = openChatSearchResult(seed, firstResult)
    const runtime = buildChatRuntimeState(firstResult.sidebarItemId, {
      seed: nextSeed,
      threadDrawerOpenOverrides: {
        [firstResult.sidebarItemId]: !!firstResult.threadId,
      },
    })

    expect(runtime.selectedSidebarItemId).toBe(hiddenViewerConversation.conversationId)
    expect(runtime.chat.activeConversationId).toBe(hiddenViewerConversation.conversationId)
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.focusMessageId).toBe(hiddenViewerMessage.messageId)
    expect(
      runtime.chat.sidebar.viewerRecents.some(
        (entry) => entry.conversationId === hiddenViewerConversation.conversationId,
      ),
    ).toBe(true)
  })

  it("loads desktop chat hydration from ledger state without treating viewer rooms as joined", async () => {
    const storageDir = await createChatFixture()
    const app = new ChatCommandService(storageDir)
    const generalConversation = await app.createChannel({
      slug: "general",
      title: "general",
      createdById: "founder",
    })
    await app.inviteParticipant({
      conversationId: generalConversation.conversationId,
      subjectId: "alpha",
      invitedById: "founder",
    })
    await app.joinConversation({
      conversationId: generalConversation.conversationId,
      participantId: "alpha",
    })
    const threadRoot = await app.postMessage({
      conversationId: generalConversation.conversationId,
      senderId: "alpha",
      body: "@founder can you check the launch checklist?",
    })
    await app.postMessage({
      conversationId: generalConversation.conversationId,
      senderId: "founder",
      threadId: threadRoot.messageId,
      body: "Watching the launch thread.",
    })
    await app.setThreadFollowState({
      conversationId: generalConversation.conversationId,
      actorId: "founder",
      threadId: threadRoot.messageId,
      attached: true,
    })

    const directConversation = await app.ensureDirectConversation({
      participants: [
        { kind: "participant", id: "founder" },
        { kind: "participant", id: "alpha" },
      ],
    })
    await app.postMessage({
      conversationId: directConversation.conversationId,
      senderId: "alpha",
      body: "Direct update for founder.",
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
    await app.setConversationWatchState({
      conversationId: viewerConversation.conversationId,
      actorId: "founder",
      attached: true,
    })
    await app.postMessage({
      conversationId: viewerConversation.conversationId,
      senderId: "alpha",
      body: "Viewer room update.",
    })

    const seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })

    expect(seed.baseChat.sidebar.channels).toEqual([
      expect.objectContaining({
        conversationId: generalConversation.conversationId,
        title: "general",
      }),
    ])
    expect(seed.baseChat.sidebar.viewerRecents).toEqual([
      expect.objectContaining({
        conversationId: viewerConversation.conversationId,
        title: "ops",
      }),
    ])
    expect(seed.baseChat.sidebar.inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "mention",
          conversationId: generalConversation.conversationId,
        }),
        expect.objectContaining({
          kind: "direct",
          conversationId: directConversation.conversationId,
        }),
      ]),
    )
    expect(seed.baseChat.sidebar.followedThreads).toEqual([
      expect.objectContaining({
        conversationId: generalConversation.conversationId,
        threadRootMessageId: threadRoot.messageId,
      }),
    ])
    expect(seed.itemsBySidebarItemId[directConversation.conversationId]?.conversation.title).toBe(
      "Alpha",
    )
    expect(seed.itemsBySidebarItemId[generalConversation.conversationId]?.openIntent.openMode).toBe(
      "joined",
    )
    expect(seed.itemsBySidebarItemId[viewerConversation.conversationId]?.openIntent.openMode).toBe(
      "viewer",
    )
  })

  it("defaults to the viewer recent row when viewer access is the only available chat entry", async () => {
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
      body: "Viewer-only room update.",
    })

    const seed = await loadDesktopChatRuntimeSeed(storageDir, {
      actorId: "founder",
    })

    expect(seed.defaultSidebarItemId).toBe(`viewer:${viewerConversation.conversationId}`)
    expect(seed.baseChat.sidebar.channels).toEqual([])
    expect(seed.baseChat.sidebar.viewerRecents).toEqual([
      expect.objectContaining({
        entryId: `viewer:${viewerConversation.conversationId}`,
      }),
    ])
  })

  it("accepts only known sidebar selections", () => {
    expect(resolveInitialChatSidebarItemId("ops")).toBe("ops")
    expect(resolveInitialChatSidebarItemId("mention:general-second")).toBe("mention:general-second")
    expect(resolveInitialChatSidebarItemId("missing-item")).toBe("general")
  })

  it("switches to a restricted conversation with no thread drawer", () => {
    const runtime = buildChatRuntimeState("ops")

    expect(runtime.selectedSidebarItemId).toBe("ops")
    expect(runtime.chat.activeConversationId).toBe("ops")
    expect(runtime.transcriptView.conversationId).toBe("ops")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.transcriptView.composer.disabledReason).toBeNull()
    expect(runtime.detailPane).toBeNull()
  })

  it("opens inbox entries into their target conversation without changing the selected row id", () => {
    const runtime = buildChatRuntimeState("mention:general-second")

    expect(runtime.selectedSidebarItemId).toBe("mention:general-second")
    expect(runtime.chat.activeConversationId).toBe("general")
    expect(runtime.transcriptView.focusMessageId).toBe("general-second")
    expect(runtime.transcriptView.threadDrawer.open).toBe(false)
  })

  it("opens followed thread sidebar rows directly into the thread drawer", () => {
    const runtime = buildChatRuntimeState("thread:general:general-root")

    expect(runtime.selectedSidebarItemId).toBe("thread:general:general-root")
    expect(runtime.chat.activeConversationId).toBe("general")
    expect(runtime.detailPane).toEqual({
      kind: "thread",
      title: "general",
    })
    expect(runtime.transcriptView.threadDrawer.open).toBe(true)
    expect(runtime.transcriptView.threadDrawer.rootMessage?.messageId).toBe("general-root")
  })

  it("opens viewer recent sidebar rows in explicit viewer mode", () => {
    const runtime = buildChatRuntimeState("viewer:finance-private")

    expect(runtime.selectedSidebarItemId).toBe("viewer:finance-private")
    expect(runtime.chat.activeConversationId).toBe("finance-private")
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
  })

  it("normalizes seeded direct conversation titles relative to the active actor", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const runtime = buildChatRuntimeState("dm-alpha", { seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      conversationId: "dm-alpha",
      title: "Founder",
      dmGroup: "with-viewer",
    })
  })

  it("builds seed inbox and viewer recents relative to the active actor", () => {
    const founderSeed = createChatShellRuntimeSeed()
    const alphaSeed = createChatShellRuntimeSeed({ actorId: "alpha" })

    expect(founderSeed.baseChat.sidebar.inbox).toEqual([
      expect.objectContaining({
        entryId: "mention:general-second",
        conversationId: "general",
      }),
    ])
    expect(founderSeed.baseChat.sidebar.viewerRecents).toEqual([
      expect.objectContaining({
        entryId: "viewer:finance-private",
        conversationId: "finance-private",
      }),
    ])
    expect(alphaSeed.baseChat.sidebar.inbox).toEqual([])
    expect(alphaSeed.baseChat.sidebar.viewerRecents).toEqual([])
    expect(alphaSeed.itemsBySidebarItemId["viewer:finance-private"]).toBeUndefined()
    expect(alphaSeed.itemsBySidebarItemId["mention:general-second"]).toBeUndefined()
  })

  it("deduplicates followed thread entries for the same conversation thread", () => {
    const seed = createChatShellRuntimeSeed()

    expect(
      seed.baseChat.sidebar.followedThreads.filter(
        (entry) =>
          entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
      ),
    ).toHaveLength(1)
  })

  it("restores persisted chat seeds and re-synchronizes derived sidebar state", () => {
    const seed = createChatShellRuntimeSeed()
    const restored = restoreChatShellRuntimeSeed(JSON.stringify(seed))

    expect(restored.actorId).toBe(seed.actorId)
    expect(
      restored.baseChat.sidebar.followedThreads.filter(
        (entry) =>
          entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
      ),
    ).toHaveLength(1)
    expect(restored.itemsBySidebarItemId["thread:general:general-root"]).toBeDefined()
  })

  it("falls back to a fresh default seed when persisted chat state is invalid", () => {
    const restored = restoreChatShellRuntimeSeed("{not-json")

    expect(restored.actorId).toBe("founder")
    expect(restored.defaultSidebarItemId).toBe("general")
  })

  it("restores persisted chat drafts and audience selections", () => {
    expect(
      restoreChatDraftPersistence(
        JSON.stringify({
          conversationDrafts: { general: "Need to follow up" },
          threadDrafts: { "general:general-root": "Reply draft" },
          conversationAudienceSelections: { general: "alpha" },
          threadAudienceSelections: { "general:general-root": "beta" },
        }),
      ),
    ).toEqual({
      conversationDrafts: { general: "Need to follow up" },
      threadDrafts: { "general:general-root": "Reply draft" },
      conversationAudienceSelections: { general: "alpha" },
      threadAudienceSelections: { "general:general-root": "beta" },
    })
    expect(restoreChatDraftPersistence("{bad-json")).toEqual({
      conversationDrafts: {},
      threadDrafts: {},
      conversationAudienceSelections: {},
      threadAudienceSelections: {},
    })
  })

  it("retargets an existing seed to another actor without resetting chat state", () => {
    const founderSeed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed: founderSeed,
      sidebarItemId: "ops",
      body: "Founder, can you check the deploy queue?",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })

    const alphaSeed = retargetChatShellRuntimeSeed(nextSeed, "alpha")
    const alphaRuntime = buildChatRuntimeState("general", { seed: alphaSeed })

    expect(alphaSeed.actorId).toBe("alpha")
    expect(alphaRuntime.chat.sidebar.inbox).toEqual([])
    expect(alphaRuntime.chat.sidebar.viewerRecents).toEqual([])
    expect(
      alphaRuntime.chat.sidebar.dmGroups
        .flatMap((group) => group.conversations)
        .find((conversation) => conversation.conversationId === "dm-alpha"),
    ).toMatchObject({
      title: "Founder",
      dmGroup: "with-viewer",
    })
    expect(
      alphaRuntime.chat.sidebar.channels.find(
        (conversation) => conversation.conversationId === "ops",
      ),
    ).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      latestMessagePreview: "Founder, can you check the deploy queue?",
    })
  })

  it("hides viewer conversations from recents and falls back to the default room", () => {
    const seed = createChatShellRuntimeSeed()
    const hidden = hideChatViewerConversation(seed, "viewer:finance-private")
    const runtime = buildChatRuntimeState(hidden.nextSidebarItemId, { seed: hidden.seed })

    expect(hidden.seed.baseChat.sidebar.viewerRecents).toEqual([])
    expect(hidden.seed.itemsBySidebarItemId["viewer:finance-private"]).toBeUndefined()
    expect(hidden.nextSidebarItemId).toBe("general")
    expect(runtime.chat.activeConversationId).toBe("general")
  })

  it("creates a new channel conversation and opens it as the active room", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatConversation({
      seed,
      title: "Release Notes",
      creatorId: "founder",
    })

    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(created.sidebarItemId).toBe("release-notes")
    expect(runtime.chat.activeConversationId).toBe("release-notes")
    expect(runtime.chat.activeConversation?.title).toBe("Release Notes")
    expect(runtime.chat.sidebar.channels[0]?.conversationId).toBe("release-notes")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.transcriptView.chrome.canManageParticipants).toBe(true)
    expect(runtime.transcriptView.transcript).toEqual([])
  })

  it("uniquifies created channel identifiers when the slug already exists", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatConversation({
      seed,
      title: "general",
      creatorId: "founder",
    })

    expect(created.sidebarItemId).toBe("general-2")
    expect(created.seed.itemsBySidebarItemId["general-2"]?.conversation.slug).toBe("general-2")
  })

  it("creates private channels with private visibility", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatConversation({
      seed,
      title: "Leadership",
      creatorId: "founder",
      visibility: "private",
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation?.visibility).toBe("private")
    expect(created.seed.itemsBySidebarItemId.leadership?.conversation.visibility).toBe("private")
  })

  it("creates direct conversations and opens them in the dm groups", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha"],
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Alpha",
      visibility: "private",
      participantIds: ["founder", "alpha"],
    })
    expect(runtime.chat.sidebar.dmGroups.flatMap((group) => group.conversations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: created.sidebarItemId,
          kind: "dm",
          title: "Alpha",
        }),
      ]),
    )
  })

  it("creates group direct conversations when multiple participants are provided", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "group_dm",
      title: "Alpha, Beta",
      visibility: "private",
      participantIds: ["founder", "alpha", "beta"],
    })
  })

  it("creates direct conversation titles relative to the active actor", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const created = createChatDirectConversation({
      seed,
      creatorId: "alpha",
      participantIds: ["beta"],
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Beta",
      participantIds: ["alpha", "beta"],
    })
  })

  it("reuses an existing direct conversation for the same participant set", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha"],
    })

    expect(created.sidebarItemId).toBe("dm-alpha")
    expect(created.seed).toBe(seed)
  })

  it("normalizes group direct conversations to a dm when only two remote participants remain", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const next = leaveChatConversation(created.seed, created.sidebarItemId, "founder")
    const runtime = buildChatRuntimeState(next.nextSidebarItemId, { seed: next.seed })

    expect(next.nextSidebarItemId).toBe(created.sidebarItemId)
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Alpha + Beta",
      dmGroup: "without-viewer",
      participantIds: ["alpha", "beta"],
    })
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Founder left the room.")
  })

  it("adds new participants to joined rooms and appends a room event", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = addChatConversationParticipant({
      seed,
      sidebarItemId: "general",
      participantId: "gamma",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.participantIds).toContain("gamma")
    expect(runtime.transcriptView.transcript.at(-1)).toMatchObject({
      author: { kind: "system" },
      body: "Gamma joined the room.",
    })
  })

  it("grants viewer access in joined rooms and records a room grant event", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = grantChatConversationAccess({
      seed,
      sidebarItemId: "general",
      participantId: "sam",
      roleId: "viewer",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.accessGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectId: "sam",
          roleId: "viewer",
        }),
      ]),
    )
    expect(runtime.transcriptView.transcript.at(-1)).toMatchObject({
      author: { kind: "system" },
      systemEventKind: "room-grant-added",
      body: "Sam can now view the room.",
    })
  })

  it("revokes existing room access grants and records the revoke event", () => {
    const seed = createChatShellRuntimeSeed()
    const granted = grantChatConversationAccess({
      seed,
      sidebarItemId: "general",
      participantId: "sam",
      roleId: "room_manager",
    })
    const bindingId = buildChatRuntimeState("general", {
      seed: granted,
    }).transcriptView.accessGrants.find(
      (grant) => grant.subjectId === "sam" && grant.roleId === "room_manager",
    )?.bindingId

    expect(bindingId).toBeTruthy()

    const nextSeed = revokeChatConversationAccess({
      seed: granted,
      sidebarItemId: "general",
      bindingId: bindingId ?? "",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(
      runtime.transcriptView.accessGrants.some(
        (grant) => grant.subjectId === "sam" && grant.roleId === "room_manager",
      ),
    ).toBe(false)
    expect(runtime.transcriptView.transcript.at(-1)).toMatchObject({
      author: { kind: "system" },
      systemEventKind: "room-grant-revoked",
      body: "Room manager access for Sam was revoked.",
    })
  })

  it("adds participants to group direct conversations without duplicating existing ids", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const expandedSeed = addChatConversationParticipant({
      seed: created.seed,
      sidebarItemId: created.sidebarItemId,
      participantId: "gamma",
    })
    const duplicateAttempt = addChatConversationParticipant({
      seed: expandedSeed,
      sidebarItemId: created.sidebarItemId,
      participantId: "gamma",
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: duplicateAttempt })

    expect(runtime.chat.activeConversation?.participantIds).toEqual([
      "founder",
      "alpha",
      "beta",
      "gamma",
    ])
    expect(
      runtime.transcriptView.transcript.filter(
        (message) => message.body === "Gamma joined the room.",
      ),
    ).toHaveLength(1)
  })

  it("can close the active thread drawer without losing the selected conversation", () => {
    const runtime = buildChatRuntimeState("general", {
      threadDrawerOpenOverrides: { general: false },
    })

    expect(runtime.selectedSidebarItemId).toBe("general")
    expect(runtime.chat.activeConversationId).toBe("general")
    expect(runtime.transcriptView.threadDrawer.open).toBe(false)
    expect(runtime.detailPane).toBeNull()
  })

  it("appends mainline messages into the active transcript and refreshes sidebar preview", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "Closing the launch checklist now.",
      senderId: "founder",
      threadId: null,
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Closing the launch checklist now.")
    expect(runtime.chat.activeConversation?.latestMessagePreview).toBe(
      "Closing the launch checklist now.",
    )
    expect(runtime.chat.activeConversation?.unreadCount).toBe(0)
    expect(runtime.chat.sidebar.inbox).toEqual([])
  })

  it("raises unread and inbox attention for external mainline messages in inactive rooms", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Founder, can you check the deploy queue?",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const opsConversation = runtime.chat.sidebar.channels.find(
      (conversation) => conversation.conversationId === "ops",
    )
    const mentionEntry = runtime.chat.sidebar.inbox.find(
      (entry) => entry.conversationId === "ops" && entry.kind === "mention",
    )

    expect(opsConversation).toMatchObject({
      unreadCount: 1,
      mentionCount: 1,
      latestMessagePreview: "Founder, can you check the deploy queue?",
    })
    expect(mentionEntry).toMatchObject({
      preview: "Founder, can you check the deploy queue?",
      messageId: expect.stringContaining("ops-msg-"),
    })
  })

  it("routes mention attention to the active actor instead of the default founder", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Alpha, check the deploy queue.",
      senderId: "founder",
      threadId: null,
      audienceId: "alpha",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const opsConversation = runtime.chat.sidebar.channels.find(
      (conversation) => conversation.conversationId === "ops",
    )
    const mentionEntry = runtime.chat.sidebar.inbox.find(
      (entry) => entry.conversationId === "ops" && entry.kind === "mention",
    )

    expect(opsConversation).toMatchObject({
      unreadCount: 1,
      mentionCount: 1,
      latestMessagePreview: "Alpha, check the deploy queue.",
    })
    expect(mentionEntry).toMatchObject({
      preview: "Alpha, check the deploy queue.",
      messageId: expect.stringContaining("ops-msg-"),
    })
  })

  it("opens dynamically created inbox rows without clearing room attention", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Founder, can you check the deploy queue?",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const mentionEntry = runtime.chat.sidebar.inbox.find(
      (entry) => entry.conversationId === "ops" && entry.kind === "mention",
    )
    if (!mentionEntry) {
      throw new Error("Expected generated inbox entry")
    }

    const openedSeed = openChatSidebarItem(nextSeed, mentionEntry.entryId)
    const openedRuntime = buildChatRuntimeState(mentionEntry.entryId, { seed: openedSeed })

    expect(openedRuntime.selectedSidebarItemId).toBe(mentionEntry.entryId)
    expect(openedRuntime.chat.activeConversationId).toBe("ops")
    expect(openedRuntime.chat.activeConversation).toMatchObject({
      unreadCount: 1,
      mentionCount: 1,
    })
    expect(
      openedRuntime.chat.sidebar.inbox.find(
        (entry) => entry.conversationId === "ops" && entry.kind === "mention",
      ),
    ).toEqual(expect.objectContaining({ resolvedAt: null }))
  })

  it("does not raise unread attention for external messages in the actively open room", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "Founder, this stays quiet because the room is open.",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      latestMessagePreview: "Founder, this stays quiet because the room is open.",
    })
    expect(
      runtime.chat.sidebar.inbox.some(
        (entry) =>
          entry.conversationId === "general" &&
          entry.preview === "Founder, this stays quiet because the room is open.",
      ),
    ).toBe(false)
  })

  it("reorders channels by latest activity after new mainline messages", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Ops now owns the hottest room in the sidebar.",
      senderId: "founder",
      threadId: null,
    })
    const runtime = buildChatRuntimeState("ops", { seed: nextSeed })

    expect(runtime.chat.sidebar.channels[0]?.conversationId).toBe("ops")
    expect(runtime.chat.activeConversation?.latestMessagePreview).toBe(
      "Ops now owns the hottest room in the sidebar.",
    )
  })

  it("preserves addressed audience on newly posted messages", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "Alpha, please close the launch doc.",
      senderId: "founder",
      threadId: null,
      audienceId: "alpha",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe(
      "Alpha, please close the launch doc.",
    )
    expect(runtime.transcriptView.transcript.at(-1)?.audience).toEqual({
      kind: "participant",
      id: "alpha",
    })
  })

  it("appends thread replies and refreshes thread metadata in place", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "I closed the reliability pass.",
      senderId: "founder",
      threadId: "general-root",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.threadDrawer.open).toBe(true)
    expect(runtime.transcriptView.threadDrawer.messages.at(-1)?.body).toBe(
      "I closed the reliability pass.",
    )
    expect(runtime.transcriptView.transcript[0]?.threadReplyCount).toBe(2)
    expect(runtime.transcriptView.transcript[0]?.threadPreview).toBe(
      "I closed the reliability pass.",
    )
  })

  it("clears unread state and soft-resolves inbox entries when a conversation is marked read", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = markChatConversationRead(seed, "general")

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.unreadCount).toBe(0)
    expect(runtime.chat.activeConversation?.mentionCount).toBe(0)
    expect(runtime.chat.sidebar.inbox).toEqual([
      expect.objectContaining({
        conversationId: "general",
        resolvedAt: expect.any(String),
      }),
    ])
  })

  it("toggles thread follow state on the active thread drawer", () => {
    const seed = createChatShellRuntimeSeed()
    const unfollowedSeed = setChatThreadFollowState(seed, "general", "general-root", false)
    const unfollowedRuntime = buildChatRuntimeState("general", { seed: unfollowedSeed })

    expect(unfollowedRuntime.transcriptView.threadDrawer.followed).toBe(false)

    const followedSeed = setChatThreadFollowState(unfollowedSeed, "general", "general-root", true)
    const followedRuntime = buildChatRuntimeState("general", { seed: followedSeed })

    expect(followedRuntime.transcriptView.threadDrawer.followed).toBe(true)
  })

  it("tracks followed thread attention for external replies and clears it when opened", () => {
    const seed = createChatShellRuntimeSeed()
    const unfollowedSeed = setChatThreadFollowState(seed, "general", "general-root", false)
    const followedSeed = setChatThreadFollowState(unfollowedSeed, "general", "general-root", true)
    const idleSeed = setChatThreadOpenState(followedSeed, "general", null)
    const nextSeed = appendChatMessage({
      seed: idleSeed,
      sidebarItemId: "general",
      body: "Founder, can you sanity-check this thread?",
      senderId: "alpha",
      threadId: "general-root",
      audienceId: "founder",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const followedEntry = runtime.chat.sidebar.followedThreads.find(
      (entry) => entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
    )

    expect(followedEntry).toMatchObject({
      unreadReplyCount: 1,
      unreadMentionCount: 1,
      preview: "Founder, can you sanity-check this thread?",
    })

    const clearedSeed = setChatThreadOpenState(nextSeed, "general", "general-root")
    const clearedRuntime = buildChatRuntimeState("general", { seed: clearedSeed })
    const clearedEntry = clearedRuntime.chat.sidebar.followedThreads.find(
      (entry) => entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
    )

    expect(clearedEntry).toMatchObject({
      unreadReplyCount: 0,
      unreadMentionCount: 0,
    })
  })

  it("marks followed thread attention read without reopening the thread", () => {
    const seed = createChatShellRuntimeSeed()
    const idleSeed = setChatThreadOpenState(seed, "general", null)
    const nextSeed = appendChatMessage({
      seed: idleSeed,
      sidebarItemId: "general",
      body: "Founder, review this follow-up when you can.",
      senderId: "alpha",
      threadId: "general-root",
      audienceId: "founder",
    })
    const threadEntryId = "thread:general:general-root"
    const unreadRuntime = buildChatRuntimeState(threadEntryId, { seed: nextSeed })

    expect(unreadRuntime.transcriptView.threadDrawer.unreadReplyCount).toBeGreaterThan(0)
    expect(unreadRuntime.transcriptView.threadDrawer.unreadMentionCount).toBe(1)

    const clearedSeed = markChatThreadRead(nextSeed, threadEntryId, "general-root")
    const clearedRuntime = buildChatRuntimeState(threadEntryId, { seed: clearedSeed })

    expect(clearedRuntime.transcriptView.threadDrawer.unreadReplyCount).toBe(0)
    expect(clearedRuntime.transcriptView.threadDrawer.unreadMentionCount).toBe(0)
  })

  it("toggles quick reactions on participant messages", () => {
    const seed = createChatShellRuntimeSeed()
    const likedSeed = toggleChatMessageReaction({
      seed,
      sidebarItemId: "general",
      messageId: "general-root",
      emoji: "👍",
      participantId: "founder",
    })
    const likedRuntime = buildChatRuntimeState("general", { seed: likedSeed })

    expect(likedRuntime.transcriptView.transcript[0]?.reactions).toEqual([
      {
        emoji: "👍",
        participantIds: ["founder"],
        count: 1,
      },
    ])

    const unlikedSeed = toggleChatMessageReaction({
      seed: likedSeed,
      sidebarItemId: "general",
      messageId: "general-root",
      emoji: "👍",
      participantId: "founder",
    })
    const unlikedRuntime = buildChatRuntimeState("general", { seed: unlikedSeed })

    expect(unlikedRuntime.transcriptView.transcript[0]?.reactions).toEqual([])
  })

  it("edits messages in place and refreshes preview-linked surfaces", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = editChatMessage({
      seed,
      sidebarItemId: "general",
      messageId: "general-second",
      body: "Final release checklist is locked.",
      actorId: "founder",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.transcript[1]?.body).toBe("Final release checklist is locked.")
    expect(runtime.transcriptView.transcript[1]?.editedAt).toBeTruthy()
    expect(runtime.chat.activeConversation?.latestMessagePreview).toBe(
      "I can take the reliability thread.",
    )
    expect(runtime.chat.sidebar.inbox[0]?.preview).toBe("Final release checklist is locked.")
  })

  it("redacts thread replies and updates thread preview metadata", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = redactChatMessage({
      seed,
      sidebarItemId: "general",
      messageId: "general-thread-reply",
      actorId: "alpha",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.threadDrawer.messages[0]?.body).toBe("[message redacted]")
    expect(runtime.transcriptView.threadDrawer.messages[0]?.redactedAt).toBeTruthy()
    expect(runtime.transcriptView.transcript[0]?.threadPreview).toBe("[message redacted]")
  })

  it("allows room managers to redact other participant messages", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = redactChatMessage({
      seed,
      sidebarItemId: "general",
      messageId: "general-thread-reply",
      actorId: "founder",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.threadDrawer.messages[0]?.body).toBe("[message redacted]")
    expect(runtime.transcriptView.threadDrawer.messages[0]?.redactedById).toBe("founder")
  })

  it("toggles posting policy and appends a system event to the transcript", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = toggleChatConversationPostingPolicy({
      seed,
      sidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.postingPolicy).toBe("restricted")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.transcriptView.composer.disabledReason).toBeNull()
    expect(runtime.transcriptView.transcript.at(-1)?.messageKind).toBe("system-event")
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe(
      "Room posting policy changed to restricted.",
    )
  })

  it("keeps restricted room posting disabled for joined non-managers", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const restrictedSeed = toggleChatConversationPostingPolicy({
      seed,
      sidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: restrictedSeed })

    expect(runtime.chat.activeConversation?.postingPolicy).toBe("restricted")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(runtime.transcriptView.composer.disabledReason).toBe("Posting is restricted")
  })

  it("archives conversations and disables posting through transcript state", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = archiveChatConversation({
      seed,
      sidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.lifecycleState).toBe("archived")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(runtime.transcriptView.composer.disabledReason).toBe(
      "Archived conversations cannot accept new messages",
    )
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Room archived.")
  })

  it("updates conversation title/topic and appends system events to the transcript", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = updateChatConversationDetails({
      seed,
      sidebarItemId: "general",
      title: "Launch Readiness",
      topic: "Final release owners",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.title).toBe("Launch Readiness")
    expect(runtime.chat.activeConversation?.topic).toBe("Final release owners")
    expect(runtime.transcriptView.transcript.at(-2)?.body).toBe(
      'Room renamed to "Launch Readiness".',
    )
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe(
      'Room topic set to "Final release owners".',
    )
  })

  it("updates room visibility through the same metadata surface", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = updateChatConversationDetails({
      seed,
      sidebarItemId: "general",
      visibility: "private",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.visibility).toBe("private")
    expect(nextSeed.itemsBySidebarItemId.general?.conversation.visibility).toBe("private")
  })

  it("clears room topic through the same metadata update surface", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = updateChatConversationDetails({
      seed,
      sidebarItemId: "general",
      topic: "",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.topic).toBeNull()
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Room topic cleared.")
  })

  it("searches messages and opens thread hits into the right conversation focus", () => {
    const seed = createChatShellRuntimeSeed()
    const results = searchChatMessages(seed, "reliability")

    expect(results[0]).toMatchObject({
      resultKind: "message",
      sidebarItemId: "general",
      conversationId: "general",
      messageId: "general-thread-reply",
      threadId: "general-root",
    })
    const firstResult = results[0]
    if (!firstResult) {
      throw new Error("Expected at least one search result")
    }

    const nextSeed = openChatSearchResult(seed, firstResult)
    const runtime = buildChatRuntimeState("general", {
      seed: nextSeed,
      threadDrawerOpenOverrides: { general: true },
    })

    expect(runtime.transcriptView.focusMessageId).toBe("general-thread-reply")
    expect(runtime.transcriptView.threadDrawer.open).toBe(true)
    expect(runtime.transcriptView.threadDrawer.rootMessage?.messageId).toBe("general-root")
  })

  it("searches viewer rooms through their viewer-recent entry when no joined room exists", () => {
    const seed = createChatShellRuntimeSeed()
    const results = searchChatMessages(seed, "quiet")

    expect(results[0]).toMatchObject({
      resultKind: "message",
      sidebarItemId: "viewer:finance-private",
      conversationId: "finance-private",
      openMode: "viewer",
      preview: "quiet viewer room",
    })
  })

  it("searches room metadata when title or topic matches without requiring a message hit", () => {
    const seed = createChatShellRuntimeSeed()
    const results = searchChatMessages(seed, "finance-private")

    expect(results[0]).toMatchObject({
      resultKind: "conversation",
      sidebarItemId: "viewer:finance-private",
      conversationId: "finance-private",
      messageId: null,
      threadId: null,
      preview: "Quarterly budget review",
    })
  })

  it("preserves the active search selection when results re-sort but the same hit remains", () => {
    const originalResults = [
      {
        resultKind: "message" as const,
        sidebarItemId: "general",
        conversationId: "general",
        conversationTitle: "general",
        messageId: "general-second",
        threadId: null,
        openMode: "joined" as const,
        preview: "General update",
        createdAt: "2026-04-10T09:00:00.000Z",
      },
      {
        resultKind: "conversation" as const,
        sidebarItemId: "ops",
        conversationId: "ops",
        conversationTitle: "ops",
        messageId: null,
        threadId: null,
        openMode: "joined" as const,
        preview: "Ops room",
        createdAt: "2026-04-10T08:00:00.000Z",
      },
    ]
    const activeKey = chatSearchResultKey(originalResults[1])

    const resortedResults = [originalResults[1], originalResults[0]]
    expect(resolveChatSearchSelection(resortedResults, activeKey)).toEqual({
      activeKey,
      activeIndex: 0,
    })
  })

  it("promotes viewer mode into joined mode when the local participant joins", () => {
    const seed = createChatShellRuntimeSeed()
    const viewerConversation = makeConversationRecord({
      conversationId: "viewer-room",
      title: "viewer-room",
      visibility: "private",
      participantIds: ["alpha"],
    })
    const viewerProjection = {
      conversationMessages: [
        makeProjectedMessage({
          messageId: "viewer-room-root",
          conversationId: "viewer-room",
          author: { kind: "participant", id: "alpha" },
          body: "Viewer-only room",
        }),
      ],
      mainTranscript: [
        makeProjectedMessage({
          messageId: "viewer-room-root",
          conversationId: "viewer-room",
          author: { kind: "participant", id: "alpha" },
          body: "Viewer-only room",
        }),
      ],
      activeThreadRoot: null,
      activeThreadMessages: [],
    }
    const viewerSeed = {
      ...seed,
      baseChat: {
        ...seed.baseChat,
        activeConversationId: "viewer-room",
        activeConversation: {
          conversationId: "viewer-room",
          kind: "channel" as const,
          slug: "viewer-room",
          title: "viewer-room",
          topic: null,
          visibility: "private" as const,
          postingPolicy: "open" as const,
          lifecycleState: "active" as const,
          section: "channels" as const,
          dmGroup: null,
          participantIds: ["alpha"],
          predecessorConversationId: null,
          lineageRootConversationId: "viewer-room",
          historyMode: "native" as const,
          unreadCount: 0,
          mentionCount: 0,
          latestActivityAt: "2026-04-06T10:00:00.000Z",
          latestMessagePreview: "Viewer-only room",
          messageCount: 1,
        },
        sidebar: {
          ...seed.baseChat.sidebar,
          channels: [
            ...seed.baseChat.sidebar.channels,
            {
              conversationId: "viewer-room",
              kind: "channel" as const,
              slug: "viewer-room",
              title: "viewer-room",
              topic: null,
              visibility: "private" as const,
              postingPolicy: "open" as const,
              lifecycleState: "active" as const,
              section: "channels" as const,
              dmGroup: null,
              participantIds: ["alpha"],
              predecessorConversationId: null,
              lineageRootConversationId: "viewer-room",
              historyMode: "native" as const,
              unreadCount: 0,
              mentionCount: 0,
              latestActivityAt: "2026-04-06T10:00:00.000Z",
              latestMessagePreview: "Viewer-only room",
              messageCount: 1,
            },
          ],
        },
      },
      itemsBySidebarItemId: {
        ...seed.itemsBySidebarItemId,
        "viewer-room": {
          conversation: viewerConversation,
          projection: viewerProjection,
          openIntent: openViewerRecentConversation({
            conversationId: "viewer-room",
            title: "viewer-room",
            kind: "channel",
            observedAt: "2026-04-06T10:01:00.000Z",
            latestActivityAt: "2026-04-06T10:00:00.000Z",
            latestMessagePreview: "Viewer-only room",
          }),
          canPostMessage: false,
          followedThreadIds: [],
        },
      },
    }

    const joinedSeed = joinChatConversation(viewerSeed, "viewer-room", "founder")
    const runtime = buildChatRuntimeState("viewer-room", { seed: joinedSeed })

    expect(runtime.transcriptView.openMode).toBe("joined")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.chat.activeConversation?.participantIds).toContain("founder")
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Founder joined the room.")
  })

  it("demotes joined channels into viewer recents when the local participant leaves", () => {
    const seed = createChatShellRuntimeSeed()
    const next = leaveChatConversation(seed, "general", "founder")
    const runtime = buildChatRuntimeState(next.nextSidebarItemId, { seed: next.seed })

    expect(next.nextSidebarItemId).toBe("viewer:general")
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(
      runtime.chat.sidebar.channels.some(
        (conversation) => conversation.conversationId === "general",
      ),
    ).toBe(false)
    expect(
      runtime.chat.sidebar.viewerRecents.some(
        (conversation) => conversation.conversationId === "general",
      ),
    ).toBe(true)
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Founder left the room.")
  })

  it("removes participants from joined rooms and appends a system event", () => {
    const seed = createChatShellRuntimeSeed()
    const joinedSeed = joinChatConversation(seed, "viewer:finance-private", "founder")
    const nextSeed = removeChatConversationParticipant({
      seed: joinedSeed,
      sidebarItemId: "finance-private",
      participantId: "alpha",
    })
    const runtime = buildChatRuntimeState("finance-private", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.participantIds).toEqual(["founder"])
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Removed Alpha from the room.")
  })

  it("normalizes group direct conversations when a participant is removed", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const nextSeed = removeChatConversationParticipant({
      seed: created.seed,
      sidebarItemId: created.sidebarItemId,
      participantId: "beta",
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: nextSeed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Alpha",
      participantIds: ["founder", "alpha"],
      dmGroup: "with-viewer",
    })
  })
})
