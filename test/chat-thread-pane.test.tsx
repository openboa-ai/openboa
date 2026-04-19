import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ChatTranscriptViewState } from "../src/shell/chat/index.js"
import { makeProjectedMessage } from "../src/shell/web/chat-seed.js"
import { ThreadPane } from "../src/shell/web/components/chat/thread-pane.js"

function makeThreadView(): ChatTranscriptViewState {
  const rootMessage = makeProjectedMessage({
    messageId: "general-root",
    conversationId: "general",
    author: { kind: "participant", id: "alpha" },
    body: "Root summary",
  })
  const replyMessage = makeProjectedMessage({
    messageId: "general-reply",
    conversationId: "general",
    threadId: "general-root",
    author: { kind: "participant", id: "founder" },
    body: "Follow-up note",
  })

  return {
    conversationId: "general",
    conversationTitle: "general",
    openMode: "joined",
    chrome: {
      icon: "channel",
      badgeLabel: "public",
      canEditDetails: true,
      canTogglePostingPolicy: true,
      canArchive: true,
      canLeave: true,
      canManageParticipants: true,
    },
    accessGrants: [],
    focusMessageId: null,
    transcript: [rootMessage],
    threadDrawer: {
      open: true,
      rootMessage,
      messages: [replyMessage],
      followed: true,
      unreadReplyCount: 2,
      unreadMentionCount: 1,
    },
    viewerTreatment: null,
    composer: {
      visible: true,
      enabled: true,
      placeholder: "Reply in thread",
      disabledReason: null,
    },
  }
}

describe("chat thread pane", () => {
  it("renders thread attention badges with a mark-read affordance", () => {
    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={makeThreadView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={["alpha"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain("Following")
    expect(html).toContain("2 unread")
    expect(html).toContain("1 mentions")
    expect(html).toContain("Mark read")
  })

  it("uses a wrapped header action layout to avoid overlap on narrow widths", () => {
    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={makeThreadView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={["alpha"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain('data-slot="pane-header-actions"')
    expect(html).toContain("w-full flex-wrap items-center justify-start")
    expect(html).toContain("grid w-full gap-1.5")
  })

  it("keeps zero-state attention badges visible for layout stability", () => {
    const view = makeThreadView()
    view.threadDrawer.unreadReplyCount = 0
    view.threadDrawer.unreadMentionCount = 0

    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={view}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={["alpha"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain("0 unread")
    expect(html).toContain("0 mentions")
    expect(html).toContain("disabled")
  })

  it("renders mention suggestions for thread replies", () => {
    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={makeThreadView()}
        draft="@al"
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={["alpha", "beta"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain("Mention")
    expect(html).toContain("Alpha")
  })

  it("visually separates the root message from the reply list", () => {
    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={makeThreadView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={["alpha", "beta"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain("Original message")
    expect(html).toContain("Replies")
    expect(html).toContain("1 in this thread")
  })

  it("shows an explicit empty state when no thread root is selected", () => {
    const view = makeThreadView()
    view.threadDrawer.rootMessage = null
    view.threadDrawer.messages = []

    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={view}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain("No thread selected")
    expect(html).toContain("Open any reply chain")
  })

  it("marks the first thread mention suggestion as active for keyboard navigation", () => {
    const html = renderToStaticMarkup(
      <ThreadPane
        actorId="founder"
        onClose={() => {}}
        title="general thread"
        view={makeThreadView()}
        draft="@al"
        editingMessageId={null}
        editingMessageDraft=""
        audienceOptions={["alpha", "beta"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onMarkRead={() => {}}
        onToggleFollow={() => {}}
        onStartEditingMessage={() => {}}
        onEditingMessageDraftChange={() => {}}
        onCancelEditingMessage={() => {}}
        onSaveEditingMessage={() => {}}
        onToggleReaction={() => {}}
        onRedactMessage={() => {}}
        onToggleAudience={() => {}}
        onInsertMentionToken={() => {}}
        onInsertEmojiToken={() => {}}
      />,
    )

    expect(html).toContain('aria-selected="true"')
    expect(html).toContain("Alpha")
  })
})
