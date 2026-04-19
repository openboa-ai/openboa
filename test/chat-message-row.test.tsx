import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageRow } from "../src/shell/web/components/chat/message-row.js"

describe("chat message row", () => {
  it("renders reaction chips alongside edited state", () => {
    const html = renderToStaticMarkup(
      <MessageRow
        authorLabel="Founder"
        authorKind="participant"
        audienceLabel="Alpha"
        body="Ship the release note today."
        createdAt="2026-04-06T09:18:00.000Z"
        editedAt="2026-04-06T09:20:00.000Z"
        reactions={[
          { emoji: "👍", participantIds: ["founder", "alpha"], count: 2 },
          { emoji: "✅", participantIds: ["beta"], count: 1 },
        ]}
      />,
    )

    expect(html).toContain("Edited")
    expect(html).toContain("To Alpha")
    expect(html).toContain("👍")
    expect(html).toContain("✅")
    expect(html).toContain(">2<")
    expect(html).toContain(">1<")
  })

  it("renders inline mutation controls and edit mode when enabled", () => {
    const html = renderToStaticMarkup(
      <MessageRow
        authorLabel="Founder"
        authorKind="participant"
        body="Ship the release note today."
        createdAt="2026-04-06T09:18:00.000Z"
        activeReactionEmojis={["👍"]}
        onToggleReaction={() => {}}
        canEdit
        editing
        editDraft="Rewrite the release note headline."
        onEditDraftChange={() => {}}
        onCancelEdit={() => {}}
        onSaveEdit={() => {}}
        canRedact
        onRedact={() => {}}
      />,
    )

    expect(html).toContain("Cancel")
    expect(html).toContain("Save")
    expect(html).toContain("Rewrite the release note headline.")
    expect(html).not.toContain("React")
    expect(html).not.toContain("Redact")
  })

  it("renders a floating reaction toolbar when mutation controls are available", () => {
    const html = renderToStaticMarkup(
      <MessageRow
        authorLabel="Founder"
        authorKind="participant"
        body="Ship the release note today."
        createdAt="2026-04-06T09:18:00.000Z"
        activeReactionEmojis={["👍"]}
        onToggleReaction={() => {}}
        canEdit
        onStartEdit={() => {}}
        canRedact
        onRedact={() => {}}
      />,
    )

    expect(html).toContain("React")
    expect(html).toContain("❤️")
    expect(html).toContain("🤔")
    expect(html).toContain("absolute top-0 right-0")
  })

  it("lets compact thread rows use the available pane width", () => {
    const html = renderToStaticMarkup(
      <MessageRow
        authorLabel="Founder"
        authorKind="participant"
        body="A longer compact reply should use the thread pane width instead of collapsing into a narrow fixed column."
        createdAt="2026-04-06T09:18:00.000Z"
        density="compact"
      />,
    )

    expect(html).toContain('data-density="compact"')
    expect(html).toContain("pr-2 md:pr-24")
    expect(html).toContain("max-w-none text-[13px] leading-[1.48]")
  })
})
