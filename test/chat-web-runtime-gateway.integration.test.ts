import { describe, expect, it } from "vitest"
import { ChatCommandService } from "../src/chat/policy/command-service.js"
import {
  loadDesktopChatRuntimeSeed,
  searchDesktopChatMessages,
} from "../src/shell/desktop/chat-runtime-gateway.js"
import { invokeChatGatewayMethod } from "../vite.config.js"
import { createChatFixture } from "./helpers.js"

async function invokeGateway<T>(
  companyDir: string,
  method: string,
  input: Record<string, unknown>,
): Promise<T> {
  return (await invokeChatGatewayMethod(companyDir, method, input)) as T
}

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

describe.sequential("web chat runtime gateway integration", () => {
  it("serves live shell hydration and persists web-posted messages through the web gateway", async () => {
    const { companyDir, app, conversation } = await createFounderChannelFixture()

    const initialSeed = await invokeGateway<{
      defaultSidebarItemId: string
      itemsBySidebarItemId: Record<
        string,
        {
          projection: {
            mainTranscript: Array<{ body: string }>
          }
        }
      >
    }>(companyDir, "loadSeed", { actorId: "founder" })

    expect(initialSeed.defaultSidebarItemId).toBe(conversation.conversationId)
    expect(
      initialSeed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.map(
        (message) => message.body,
      ),
    ).toContain("hello from founder")

    await invokeGateway<void>(companyDir, "postMessage", {
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
    const reloadedSeed = await invokeGateway<{
      itemsBySidebarItemId: Record<
        string,
        {
          projection: {
            mainTranscript: Array<{ body: string }>
          }
        }
      >
    }>(companyDir, "loadSeed", { actorId: "founder" })

    expect(
      persistedMessages.map((message) => message.body).filter((body) => body === "안녕"),
    ).toHaveLength(1)
    expect(
      reloadedSeed.itemsBySidebarItemId[
        conversation.conversationId
      ]?.projection.mainTranscript.filter((message) => message.body === "안녕"),
    ).toHaveLength(1)
  })

  it("exposes live search and event polling over the web gateway", async () => {
    const { companyDir, conversation } = await createFounderChannelFixture()

    const baselineSeed = await invokeGateway<{ eventWatermark: number }>(companyDir, "loadSeed", {
      actorId: "founder",
    })

    await invokeGateway<void>(companyDir, "postMessage", {
      actorId: "founder",
      conversationId: conversation.conversationId,
      body: "launch checkpoint",
      threadId: null,
      audienceId: null,
    })

    const searchResults = await invokeGateway<
      Array<{
        resultKind: string
        conversationId: string
        preview: string
      }>
    >(companyDir, "searchMessages", {
      actorId: "founder",
      query: "launch checkpoint",
      limit: 8,
    })
    const polled = await invokeGateway<{ hasEvents: boolean; nextSequence: number }>(
      companyDir,
      "pollEvents",
      {
        actorId: "founder",
        afterSequence: baselineSeed.eventWatermark,
        limit: 20,
      },
    )

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

  it("returns the same live seed and search truth as the desktop runtime gateway", async () => {
    const { companyDir, conversation } = await createFounderChannelFixture()

    await invokeGateway<void>(companyDir, "postMessage", {
      actorId: "founder",
      conversationId: conversation.conversationId,
      body: "shared parity check",
      threadId: null,
      audienceId: null,
    })

    const [desktopSeed, webSeed, desktopSearchResults, webSearchResults] = await Promise.all([
      loadDesktopChatRuntimeSeed(companyDir, { actorId: "founder" }),
      invokeGateway<{
        defaultSidebarItemId: string
        eventWatermark: number
        itemsBySidebarItemId: Record<
          string,
          {
            projection: {
              mainTranscript: Array<{ body: string }>
            }
          }
        >
      }>(companyDir, "loadSeed", { actorId: "founder" }),
      searchDesktopChatMessages(companyDir, {
        actorId: "founder",
        query: "shared parity check",
        limit: 8,
      }),
      invokeGateway<
        Array<{
          resultKind: string
          conversationId: string
          preview: string
        }>
      >(companyDir, "searchMessages", {
        actorId: "founder",
        query: "shared parity check",
        limit: 8,
      }),
    ])

    expect(webSeed.defaultSidebarItemId).toBe(desktopSeed.defaultSidebarItemId)
    expect(webSeed.eventWatermark).toBe(desktopSeed.eventWatermark)
    expect(
      webSeed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.map(
        (message) => message.body,
      ),
    ).toEqual(
      desktopSeed.itemsBySidebarItemId[conversation.conversationId]?.projection.mainTranscript.map(
        (message) => message.body,
      ),
    )
    expect(
      webSearchResults.map((result) => ({
        resultKind: result.resultKind,
        conversationId: result.conversationId,
        preview: result.preview,
      })),
    ).toEqual(
      desktopSearchResults.map((result) => ({
        resultKind: result.resultKind,
        conversationId: result.conversationId,
        preview: result.preview,
      })),
    )
  })
})
