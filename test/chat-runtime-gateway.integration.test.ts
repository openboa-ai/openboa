import { describe, expect, it } from "vitest"
import { ChatCommandService } from "../src/chat/policy/command-service.js"
import {
  joinDesktopChatConversation,
  loadDesktopChatRuntimeSeed,
  pollDesktopChatEvents,
  postDesktopChatMessage,
  searchDesktopChatMessages,
} from "../src/shell/desktop/chat-runtime-gateway.js"
import { createChatFixture } from "./helpers.js"

async function createFounderChannelFixture() {
  const companyDir = await createChatFixture()
  const app = new ChatCommandService(companyDir)
  await app.bootstrapChatAdmin({ subjectId: "founder" })
  const conversation = await app.createChannel({
    slug: "general",
    title: "general",
    visibility: "public",
    postingPolicy: "open",
    createdById: "founder",
  })
  await app.postMessage({
    conversationId: conversation.conversationId,
    senderId: "founder",
    body: "hello from founder",
    threadId: null,
    audience: null,
  })
  return {
    companyDir,
    app,
    conversation,
  }
}

describe("desktop chat runtime gateway integration", () => {
  it("hydrates live ledger-backed chat seed for joined conversations", async () => {
    const { companyDir, conversation } = await createFounderChannelFixture()

    const seed = await loadDesktopChatRuntimeSeed(companyDir, { actorId: "founder" })
    const channel = seed.baseChat.sidebar.channels.find(
      (entry) => entry.conversationId === conversation.conversationId,
    )

    expect(seed.defaultSidebarItemId).toBe(conversation.conversationId)
    expect(seed.eventWatermark).toBeGreaterThan(0)
    expect(channel).toMatchObject({
      conversationId: conversation.conversationId,
      title: "general",
    })
    expect(
      seed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.map(
        (message) => message.body,
      ),
    ).toContain("hello from founder")
  })

  it("persists runtime posts exactly once and exposes them after reload", async () => {
    const { companyDir, app, conversation } = await createFounderChannelFixture()

    await postDesktopChatMessage(companyDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      body: "안녕",
      threadId: null,
      audienceId: null,
    })

    const persistedMessages = await app.readConversationMessages({
      conversationId: conversation.conversationId,
      actorId: "founder",
    })
    const persistedBodies = persistedMessages.map((message) => message.body)
    const seed = await loadDesktopChatRuntimeSeed(companyDir, { actorId: "founder" })
    const transcriptBodies =
      seed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.map(
        (message) => message.body,
      ) ?? []

    expect(persistedBodies.filter((body) => body === "안녕")).toHaveLength(1)
    expect(transcriptBodies.filter((body) => body === "안녕")).toHaveLength(1)
  })

  it("reports live search hits and event polling after runtime writes", async () => {
    const { companyDir, conversation } = await createFounderChannelFixture()
    const baselineSeed = await loadDesktopChatRuntimeSeed(companyDir, { actorId: "founder" })

    await postDesktopChatMessage(companyDir, {
      actorId: "founder",
      conversationId: conversation.conversationId,
      body: "launch checkpoint",
      threadId: null,
      audienceId: null,
    })

    const searchResults = await searchDesktopChatMessages(companyDir, {
      actorId: "founder",
      query: "launch checkpoint",
      limit: 8,
    })
    const polled = await pollDesktopChatEvents(companyDir, {
      actorId: "founder",
      afterSequence: baselineSeed.eventWatermark,
      limit: 20,
    })

    expect(searchResults).toContainEqual(
      expect.objectContaining({
        resultKind: "message",
        conversationId: conversation.conversationId,
        preview: "launch checkpoint",
      }),
    )
    expect(polled.hasEvents).toBe(true)
    expect(polled.nextSequence).toBeGreaterThan(baselineSeed.eventWatermark)
  })

  it("materializes joined private rooms for invited participants", async () => {
    const companyDir = await createChatFixture()
    const app = new ChatCommandService(companyDir)
    await app.bootstrapChatAdmin({ subjectId: "founder" })
    const conversation = await app.createChannel({
      slug: "ops",
      title: "ops",
      visibility: "private",
      postingPolicy: "open",
      createdById: "founder",
    })

    await app.inviteParticipant({
      conversationId: conversation.conversationId,
      subjectId: "alpha",
      invitedById: "founder",
    })
    await joinDesktopChatConversation(companyDir, {
      actorId: "alpha",
      conversationId: conversation.conversationId,
    })

    const alphaSeed = await loadDesktopChatRuntimeSeed(companyDir, { actorId: "alpha" })

    expect(
      alphaSeed.baseChat.sidebar.channels.some(
        (entry) => entry.conversationId === conversation.conversationId,
      ),
    ).toBe(true)
    expect(
      alphaSeed.itemsBySidebarItemId[conversation.conversationId]?.conversation.participantIds,
    ).toContain("alpha")
  })
})
