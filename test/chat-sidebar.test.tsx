import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SidebarProvider } from "../src/components/ui/sidebar.js"
import type { ChatFrameState } from "../src/shell/chat/index.js"
import {
  buildDirectConversationSuggestions,
  resolveDirectConversationDraft,
} from "../src/shell/web/components/chat/chat-create-conversation-panel.js"
import { ChatSidebar } from "../src/shell/web/components/chat/chat-sidebar.js"
import {
  cycleSuggestionIndex,
  resolveSuggestionSelection,
} from "../src/shell/web/components/chat/presentation.js"

const frame: ChatFrameState = {
  activeItemId: "general",
  detailPane: null,
  sidebarSections: [
    {
      id: "channels",
      label: "Channels",
      badgeCount: 0,
      badgeTone: "default",
      items: [
        {
          id: "general",
          label: "general",
          icon: "hash",
          badgeCount: 0,
          badgeTone: "default",
          meta: null,
          subtitle: null,
        },
      ],
    },
  ],
}

describe("chat sidebar", () => {
  it("renders the current actor as a local participant summary", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <ChatSidebar
          actorId="release-manager"
          actorOptions={["release-manager", "alpha"]}
          frame={frame}
          activeItemId="general"
          participantOptions={["release-manager", "alpha"]}
          onSelectActor={() => {}}
          onSelectItem={() => {}}
          onCreateConversation={() => {}}
        />
      </SidebarProvider>,
    )

    expect(html).toContain("Release Manager")
    expect(html).toContain("release-manager")
    expect(html).toContain("Alpha")
    expect(html).toContain("Viewing as")
    expect(html).not.toContain("Founder")
    expect(html).not.toContain("Online")
  })

  it("filters direct conversation suggestions and hides already-selected participants", () => {
    expect(
      buildDirectConversationSuggestions(
        ["alpha", "beta", "sam", "release-manager"],
        ["beta"],
        "re",
      ),
    ).toEqual(["release-manager"])
  })

  it("resolves direct conversation drafts with explicit helper copy", () => {
    expect(
      resolveDirectConversationDraft({
        selectedParticipantIds: [],
        query: "",
      }),
    ).toEqual({
      participantIds: [],
      canSubmit: false,
      helperCopy: "Choose at least one participant to start a direct conversation.",
    })

    expect(
      resolveDirectConversationDraft({
        selectedParticipantIds: ["alpha"],
        query: "sam",
      }),
    ).toEqual({
      participantIds: ["alpha", "sam"],
      canSubmit: true,
      helperCopy: "Create will add Sam to this conversation.",
    })
  })

  it("keeps followed and viewer sections visible with empty-state copy", () => {
    const emptyFrame: ChatFrameState = {
      activeItemId: "general",
      detailPane: null,
      sidebarSections: [
        {
          id: "followed",
          label: "Followed Threads",
          items: [],
          emptyState: {
            title: "No followed threads",
            detail: "Follow a thread to keep it pinned here.",
            tone: "muted",
          },
        },
        {
          id: "viewer-recents",
          label: "Viewer Recents",
          items: [],
          emptyState: {
            title: "No viewer rooms",
            detail: "Read-only rooms will collect here when you open them.",
            tone: "muted",
          },
        },
      ],
    }

    const html = renderToStaticMarkup(
      <SidebarProvider>
        <ChatSidebar
          actorId="release-manager"
          actorOptions={["release-manager"]}
          frame={emptyFrame}
          activeItemId="general"
          participantOptions={["release-manager", "alpha"]}
          onSelectActor={() => {}}
          onSelectItem={() => {}}
          onCreateConversation={() => {}}
        />
      </SidebarProvider>,
    )

    expect(html).toContain("Followed Threads")
    expect(html).toContain("No followed threads")
    expect(html).toContain("Viewer Recents")
    expect(html).toContain("No viewer rooms")
  })

  it("cycles suggestion indexes and resolves the active selection", () => {
    expect(cycleSuggestionIndex(0, 1, 3)).toBe(1)
    expect(cycleSuggestionIndex(0, -1, 3)).toBe(2)
    expect(cycleSuggestionIndex(-1, 1, 3)).toBe(0)
    expect(resolveSuggestionSelection(["alpha", "beta"], 1)).toBe("beta")
    expect(resolveSuggestionSelection(["alpha", "beta"], 99)).toBe("alpha")
    expect(resolveSuggestionSelection([], 0)).toBeNull()
  })
})
