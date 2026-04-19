import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ChatConversation } from "../src/chat/core/model.js"
import type { ChatTranscriptViewState } from "../src/shell/chat/index.js"
import { makeProjectedMessage } from "../src/shell/web/chat-seed.js"
import { TranscriptPane } from "../src/shell/web/components/chat/transcript-pane.js"

function makeConversation(
  input: Partial<ChatConversation> & { conversationId: string },
): ChatConversation {
  return {
    conversationId: input.conversationId,
    kind: input.kind ?? "channel",
    slug: input.slug ?? input.conversationId,
    title: input.title ?? input.conversationId,
    topic: input.topic ?? null,
    visibility: input.visibility ?? "public",
    postingPolicy: input.postingPolicy ?? "open",
    lifecycleState: input.lifecycleState ?? "active",
    section: input.section ?? (input.kind === "channel" ? "channels" : "dms"),
    dmGroup: input.dmGroup ?? null,
    participantIds: input.participantIds ?? ["founder", "alpha"],
    predecessorConversationId: input.predecessorConversationId ?? null,
    lineageRootConversationId: input.lineageRootConversationId ?? input.conversationId,
    historyMode: input.historyMode ?? "native",
    unreadCount: input.unreadCount ?? 0,
    mentionCount: input.mentionCount ?? 0,
    latestActivityAt: input.latestActivityAt ?? null,
    latestMessagePreview: input.latestMessagePreview ?? "",
    messageCount: input.messageCount ?? 1,
  }
}

function makeView(input?: Partial<ChatTranscriptViewState>): ChatTranscriptViewState {
  return {
    conversationId: input?.conversationId ?? "general",
    conversationTitle: input?.conversationTitle ?? "general",
    openMode: input?.openMode ?? "joined",
    chrome: input?.chrome ?? {
      icon: "channel",
      badgeLabel: "public",
      canEditDetails: true,
      canTogglePostingPolicy: true,
      canArchive: true,
      canLeave: true,
      canManageParticipants: true,
      canModerateMessages: true,
    },
    accessGrants: input?.accessGrants ?? [],
    focusMessageId: input?.focusMessageId ?? null,
    transcript: input?.transcript ?? [],
    threadDrawer: input?.threadDrawer ?? {
      open: false,
      rootMessage: null,
      messages: [],
      followed: false,
      unreadReplyCount: 0,
      unreadMentionCount: 0,
    },
    viewerTreatment: input?.viewerTreatment ?? null,
    composer: input?.composer ?? {
      visible: true,
      enabled: true,
      placeholder: "Message #general",
      disabledReason: null,
    },
  }
}

describe("chat transcript pane", () => {
  it("uses neutral fallback descriptions when a conversation has no topic", () => {
    const channelHtml = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel", topic: null })}
        view={makeView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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
    const dmHtml = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({
          conversationId: "dm-alpha",
          kind: "dm",
          title: "Alpha",
          topic: null,
        })}
        view={makeView({
          conversationId: "dm-alpha",
          conversationTitle: "Alpha",
          chrome: {
            icon: "dm",
            badgeLabel: "dm",
            canEditDetails: false,
            canTogglePostingPolicy: false,
            canArchive: false,
            canLeave: false,
            canManageParticipants: false,
            canModerateMessages: true,
          },
          composer: {
            visible: true,
            enabled: true,
            placeholder: "Message Alpha",
            disabledReason: null,
          },
        })}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(channelHtml).toContain("No topic set")
    expect(dmHtml).toContain("Direct conversation")
  })

  it("shows room status hierarchy for viewer, archived, and restricted conversations", () => {
    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({
          conversationId: "finance-private",
          kind: "channel",
          visibility: "private",
          postingPolicy: "restricted",
          lifecycleState: "archived",
        })}
        view={makeView({
          openMode: "viewer",
          viewerTreatment: {
            mode: "viewer",
            badge: "Viewer mode",
            detail: "Read-only",
            actionLabel: "Join to participate",
          },
          composer: {
            visible: true,
            enabled: false,
            placeholder: "Conversation archived",
            disabledReason: "Archived conversations cannot accept new messages",
          },
        })}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(html).toContain("private")
    expect(html).toContain("Read-only")
    expect(html).toContain("Archived")
  })

  it("uses grouped header actions so dense room controls can wrap cleanly", () => {
    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({
          conversationId: "general",
          kind: "channel",
          unreadCount: 3,
          mentionCount: 1,
        })}
        view={makeView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(html).toContain("grid w-full gap-1.5")
    expect(html).toContain("Mark read")
    expect(html).toContain("Edit details")
    expect(html).toContain("Archive")
  })

  it("uses clearer composer helper copy for room broadcast and directed messages", () => {
    const broadcastHtml = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={["alpha"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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
    const directedHtml = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView()}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={["alpha"]}
        selectedAudienceId="alpha"
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(broadcastHtml).toContain("Broadcast to #general")
    expect(directedHtml).toContain("Directed message to Alpha")
  })

  it("shows redact affordances for room managers on other participant messages", () => {
    const transcript = [
      makeProjectedMessage({
        messageId: "general-second",
        conversationId: "general",
        author: { kind: "participant", id: "alpha" },
        body: "Reliability thread is covered.",
      }),
    ]

    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView({ transcript })}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(html).toContain("Redact")
  })

  it("shows joined manager grants on roster rows without duplicating access entries", () => {
    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView({
          accessGrants: [
            { bindingId: "grant-manager", subjectId: "alpha", roleId: "room_manager" },
            { bindingId: "grant-viewer", subjectId: "bravo", roleId: "viewer" },
          ],
        })}
        defaultShowRoster
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={["bravo", "charlie"]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(html).toContain("Room roster")
    expect(html).toContain("1 grant")
    expect(html).toContain("Bravo")
    expect((html.match(/Revoke/g) ?? []).length).toBe(1)
  })

  it("renders mention suggestions above the composer when drafting a participant mention", () => {
    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView()}
        draft="@al"
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={["alpha", "beta"]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

  it("shows an explicit empty transcript state when a room has no messages", () => {
    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView({ transcript: [] })}
        draft=""
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={[]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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

    expect(html).toContain("No messages yet")
    expect(html).toContain("Use the composer below to start the conversation")
  })

  it("marks the first mention suggestion as active for keyboard navigation", () => {
    const html = renderToStaticMarkup(
      <TranscriptPane
        actorId="founder"
        conversation={makeConversation({ conversationId: "general", kind: "channel" })}
        view={makeView()}
        draft="@al"
        editingMessageId={null}
        editingMessageDraft=""
        participantOptions={[]}
        audienceOptions={["alpha", "beta"]}
        selectedAudienceId={null}
        onDraftChange={() => {}}
        onSubmitDraft={() => {}}
        onOpenThread={() => {}}
        onMarkConversationRead={() => {}}
        onJoinConversation={() => {}}
        onLeaveConversation={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onGrantAccess={() => {}}
        onRevokeAccess={() => {}}
        onTogglePostingPolicy={() => {}}
        onArchiveConversation={() => {}}
        onUpdateConversationDetails={() => {}}
        onHideViewerConversation={() => {}}
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
