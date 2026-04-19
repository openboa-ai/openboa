import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { GlobalBar } from "../src/shell/web/components/chrome/global-bar.js"

describe("chat global bar", () => {
  it("renders search result metadata for thread and viewer hits", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalBar, {
        actorId: "release-manager",
        searchQuery: "quiet",
        activeSearchResultIndex: 0,
        searchResults: [
          {
            resultKind: "message",
            sidebarItemId: "viewer:finance-private",
            conversationId: "finance-private",
            conversationTitle: "finance-private",
            messageId: "finance-private-root",
            threadId: null,
            openMode: "viewer",
            preview: "quiet viewer room",
            createdAt: "2026-04-06T09:24:00.000Z",
          },
          {
            resultKind: "message",
            sidebarItemId: "general",
            conversationId: "general",
            conversationTitle: "general",
            messageId: "general-thread-reply",
            threadId: "general-root",
            openMode: "joined",
            preview: "I can take the reliability thread.",
            createdAt: "2026-04-06T09:18:00.000Z",
          },
        ],
      }),
    )

    expect(html).toContain('aria-keyshortcuts="Meta+K"')
    expect(html).toContain("Search rooms and messages...")
    expect(html).toContain("Viewer")
    expect(html).toContain("Thread")
    expect(html).toContain("quiet viewer room")
    expect(html).toContain("I can take the reliability thread.")
    expect(html).toContain("Release Manager")
    expect(html).not.toContain("Founder")
  })

  it("renders room search badges for conversation matches", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalBar, {
        actorId: "release-manager",
        searchQuery: "budget",
        activeSearchResultIndex: 0,
        searchResults: [
          {
            resultKind: "conversation",
            sidebarItemId: "ops",
            conversationId: "ops",
            conversationTitle: "ops",
            messageId: null,
            threadId: null,
            openMode: "joined",
            preview: "Quarterly budget review",
            createdAt: "2026-04-06T09:13:00.000Z",
          },
        ],
      }),
    )

    expect(html).toContain("Room")
    expect(html).toContain("Quarterly budget review")
  })

  it("renders a richer empty state when no search matches exist", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalBar, {
        actorId: "release-manager",
        searchQuery: "missing",
        activeSearchResultIndex: 0,
        searchResults: [],
      }),
    )

    expect(html).toContain("No matches yet")
    expect(html).toContain("Search room names, topics, and message text.")
    expect(html).toContain("Esc to clear")
  })

  it("keeps the global bar free of desktop titlebar chrome", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalBar, {
        actorId: "release-manager",
        searchQuery: "",
        searchResults: [],
      }),
    )

    expect(html).toContain("openboa")
    expect(html).toContain("All clear")
    expect(html).not.toContain('data-slot="chat-desktop-titlebar"')
    expect(html).not.toContain("-webkit-app-region")
  })

  it("uses a wrapped top-bar layout instead of a rigid three-column grid", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalBar, {
        actorId: "release-manager",
        searchQuery: "",
        searchResults: [],
      }),
    )

    expect(html).toContain("flex flex-wrap items-center")
    expect(html).toContain("order-3 w-full")
    expect(html).toContain("ml-auto flex flex-wrap items-center")
  })

  it("shows search footer guidance when results are present", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalBar, {
        actorId: "release-manager",
        searchQuery: "budget",
        activeSearchResultIndex: 0,
        searchResults: [
          {
            resultKind: "conversation",
            sidebarItemId: "ops",
            conversationId: "ops",
            conversationTitle: "ops",
            messageId: null,
            threadId: null,
            openMode: "joined",
            preview: "Quarterly budget review",
            createdAt: "2026-04-06T09:13:00.000Z",
          },
        ],
      }),
    )

    expect(html).toContain("1 result")
    expect(html).toContain("Enter to jump")
  })
})
