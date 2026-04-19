import { describe, expect, it } from "vitest"
import { resolveInboxStatusLabel } from "../src/shell/chat/frame-state.js"
import { buildChatFrameState } from "../src/shell/chat/index.js"
import { chatSeedSurface } from "../src/shell/web/chat-seed.js"

describe("chat shell frame", () => {
  it("builds chat sidebar sections and thread detail from chat-only state", () => {
    const frame = buildChatFrameState(chatSeedSurface, {
      kind: "thread",
      title: "Quality-pass thread",
    })

    expect(frame.sidebarSections.map((section) => section.label)).toEqual([
      "Inbox",
      "Followed Threads",
      "Channels",
      "With You",
      "Others",
      "Viewer Recents",
    ])
    expect(frame.detailPane).toEqual({
      kind: "thread",
      title: "Quality-pass thread",
    })
    expect(frame.sidebarSections[2]?.items[0]).toMatchObject({
      id: "general",
      badgeTone: "attention",
    })
    expect(frame.sidebarSections[0]).toMatchObject({
      id: "inbox",
      badgeCount: 1,
      badgeTone: "attention",
    })
    expect(frame.sidebarSections[1]).toMatchObject({
      id: "followed",
      badgeCount: 2,
      badgeTone: "default",
    })
    expect(frame.sidebarSections[2]).toMatchObject({
      id: "channels",
      badgeCount: 4,
      badgeTone: "attention",
    })
    expect(frame.sidebarSections[1]?.items[0]).toMatchObject({
      id: "thread:general:general-root",
      badgeTone: "default",
    })
  })

  it("keeps soft-resolved inbox rows visible but removes them from unread badges", () => {
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

    expect(frame.sidebarSections[0]).toMatchObject({
      id: "inbox",
      badgeCount: 0,
    })
    expect(frame.sidebarSections[0]?.items[0]).toMatchObject({
      muted: true,
      statusLabel: "Seen",
      statusTone: "muted",
    })
  })

  it("distinguishes recently resolved inbox entries from older resolved entries", () => {
    const recentResolvedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const olderResolvedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    expect(resolveInboxStatusLabel(recentResolvedAt, Date.now())).toBe("Seen now")
    expect(resolveInboxStatusLabel(olderResolvedAt, Date.now())).toBe("Seen")
  })
})
