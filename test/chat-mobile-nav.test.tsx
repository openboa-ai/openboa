import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildChatFrameState } from "../src/shell/chat/index.js"
import { chatSeedSurface } from "../src/shell/web/chat-seed.js"
import { ChatMobileNav } from "../src/shell/web/components/chat/chat-mobile-nav.js"

describe("chat mobile nav", () => {
  it("renders mobile conversation pills for every chat sidebar section", () => {
    const frame = buildChatFrameState(chatSeedSurface, null)
    const html = renderToStaticMarkup(
      <ChatMobileNav
        actorId="founder"
        actorOptions={["founder", "alpha", "beta", "sam"]}
        frame={frame}
        activeItemId="general"
        participantOptions={["alpha", "beta", "sam"]}
        onSelectActor={() => {}}
        onSelectItem={() => {}}
        onCreateConversation={() => {}}
      />,
    )

    expect(html).toContain("Conversations")
    expect(html).toContain("New")
    expect(html).toContain("Inbox")
    expect(html).toContain("Followed Threads")
    expect(html).toContain("Channels")
    expect(html).toContain("Viewer Recents")
    expect(html).toContain("general")
    expect(html).toContain("finance-private")
  })

  it("keeps soft-resolved inbox entries visible with a seen status", () => {
    const frame = buildChatFrameState(
      {
        ...chatSeedSurface,
        sidebar: {
          ...chatSeedSurface.sidebar,
          inbox: chatSeedSurface.sidebar.inbox.map((entry) => ({
            ...entry,
            resolvedAt: "2026-04-10T12:00:00.000Z",
          })),
        },
      },
      null,
    )
    const html = renderToStaticMarkup(
      <ChatMobileNav
        actorId="founder"
        actorOptions={["founder", "alpha", "beta", "sam"]}
        frame={frame}
        activeItemId="general"
        participantOptions={["alpha", "beta", "sam"]}
        onSelectActor={() => {}}
        onSelectItem={() => {}}
        onCreateConversation={() => {}}
      />,
    )

    expect(html).toContain("Seen")
  })

  it("keeps empty transient sections visible with helper copy", () => {
    const frame = buildChatFrameState(
      {
        ...chatSeedSurface,
        sidebar: {
          ...chatSeedSurface.sidebar,
          followedThreads: [],
          viewerRecents: [],
        },
      },
      null,
    )
    const html = renderToStaticMarkup(
      <ChatMobileNav
        actorId="founder"
        actorOptions={["founder", "alpha", "beta", "sam"]}
        frame={frame}
        activeItemId="general"
        participantOptions={["alpha", "beta", "sam"]}
        onSelectActor={() => {}}
        onSelectItem={() => {}}
        onCreateConversation={() => {}}
      />,
    )

    expect(html).toContain("No followed threads")
    expect(html).toContain("No viewer rooms")
  })
})
