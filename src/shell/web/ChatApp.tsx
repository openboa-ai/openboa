import { buildChatFrameState } from "../chat/index.js"
import { useChatShellState } from "./chat-app-state.js"
import { ChatWorkspace } from "./components/chat/chat-workspace.js"

function chatRuntimeStatusCopy(status: "loading" | "ready" | "unavailable" | "error"): {
  title: string
  detail: string
} {
  switch (status) {
    case "loading":
      return {
        title: "Connecting chat runtime",
        detail: "Loading live chat state from the runtime bridge.",
      }
    case "error":
      return {
        title: "Chat runtime failed to load",
        detail: "The app could not hydrate chat from the live runtime source.",
      }
    case "unavailable":
      return {
        title: "Chat runtime unavailable",
        detail:
          "This surface no longer falls back to demo chat data when no live runtime bridge is present.",
      }
    case "ready":
      return {
        title: "Chat ready",
        detail: "",
      }
  }
}

export function ChatApp() {
  const {
    actorId,
    actorOptions,
    activeConversationDraft,
    activeConversationAudienceId,
    activeConversationAudienceOptions,
    activeThreadDraft,
    activeThreadAudienceId,
    canCreateConversation,
    canHideViewerConversation,
    createConversation,
    selectActor,
    closeThreadDrawer,
    inboxCount,
    editingMessageDraft,
    editingMessageId,
    insertConversationDraftToken,
    insertThreadDraftToken,
    cancelEditingMessage,
    hideActiveViewerConversation,
    joinActiveConversation,
    leaveActiveConversation,
    addParticipantToActiveConversation,
    removeParticipantFromActiveConversation,
    grantAccessToActiveConversation,
    revokeAccessFromActiveConversation,
    markActiveConversationRead,
    markActiveThreadRead,
    toggleConversationPostingPolicy,
    archiveActiveConversation,
    updateActiveConversationDetails,
    openInbox,
    openThreadDrawer,
    redactActiveMessage,
    runtimeAvailability,
    runtime: chatRuntime,
    searchQuery,
    searchResults,
    activeSearchResultIndex,
    knownParticipantIds,
    saveEditingMessage,
    moveSearchSelection,
    selectSearchResult,
    submitActiveSearchResult,
    selectSidebarItem,
    setSearchQuery,
    startEditingMessage,
    submitConversationDraft,
    submitThreadDraft,
    toggleActiveThreadFollow,
    toggleConversationAudience,
    toggleReaction,
    toggleThreadAudience,
    updateConversationDraft,
    updateEditingMessageDraft,
    updateThreadDraft,
  } = useChatShellState()

  if (runtimeAvailability !== "ready") {
    const copy = chatRuntimeStatusCopy(runtimeAvailability)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 py-8">
        <div className="w-full max-w-xl rounded-[var(--radius-card)] border border-border bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card-strong)]">
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Chat
          </div>
          <h1 className="mt-2 [font-family:var(--font-display)] text-[28px] font-semibold tracking-[-0.05em] text-foreground">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">{copy.detail}</p>
        </div>
      </div>
    )
  }

  const chatFrame = buildChatFrameState(chatRuntime.chat, chatRuntime.detailPane)

  return (
    <ChatWorkspace
      actorId={actorId}
      actorOptions={actorOptions}
      frame={chatFrame}
      chat={chatRuntime.chat}
      transcriptView={chatRuntime.transcriptView}
      activeSidebarItemId={chatRuntime.selectedSidebarItemId}
      conversationDraft={activeConversationDraft}
      threadDraft={activeThreadDraft}
      editingMessageId={editingMessageId}
      editingMessageDraft={editingMessageDraft}
      searchQuery={searchQuery}
      searchResults={searchResults}
      activeSearchResultIndex={activeSearchResultIndex}
      inboxCount={inboxCount}
      canCreateConversation={canCreateConversation}
      canHideViewerConversation={canHideViewerConversation}
      participantOptions={knownParticipantIds}
      audienceOptions={activeConversationAudienceOptions}
      selectedConversationAudienceId={activeConversationAudienceId}
      selectedThreadAudienceId={activeThreadAudienceId}
      onCreateConversation={createConversation}
      onSelectActor={selectActor}
      onOpenInbox={openInbox}
      onSelectSidebarItem={selectSidebarItem}
      onCloseThread={closeThreadDrawer}
      onOpenThread={openThreadDrawer}
      onConversationDraftChange={updateConversationDraft}
      onSubmitConversationDraft={submitConversationDraft}
      onThreadDraftChange={updateThreadDraft}
      onSubmitThreadDraft={submitThreadDraft}
      onMarkConversationRead={markActiveConversationRead}
      onMarkThreadRead={markActiveThreadRead}
      onToggleThreadFollow={toggleActiveThreadFollow}
      onJoinConversation={joinActiveConversation}
      onLeaveConversation={leaveActiveConversation}
      onAddParticipantToConversation={addParticipantToActiveConversation}
      onRemoveParticipantFromConversation={removeParticipantFromActiveConversation}
      onGrantConversationAccess={grantAccessToActiveConversation}
      onRevokeConversationAccess={revokeAccessFromActiveConversation}
      onTogglePostingPolicy={toggleConversationPostingPolicy}
      onArchiveConversation={archiveActiveConversation}
      onUpdateConversationDetails={updateActiveConversationDetails}
      onHideViewerConversation={hideActiveViewerConversation}
      onStartEditingMessage={startEditingMessage}
      onEditingMessageDraftChange={updateEditingMessageDraft}
      onCancelEditingMessage={cancelEditingMessage}
      onSaveEditingMessage={saveEditingMessage}
      onToggleReaction={toggleReaction}
      onRedactMessage={redactActiveMessage}
      onSearchQueryChange={setSearchQuery}
      onSelectSearchResult={selectSearchResult}
      onMoveSearchSelection={moveSearchSelection}
      onSubmitActiveSearchResult={submitActiveSearchResult}
      onToggleConversationAudience={toggleConversationAudience}
      onToggleThreadAudience={toggleThreadAudience}
      onInsertConversationMentionToken={() => insertConversationDraftToken("@")}
      onInsertConversationEmojiToken={() => insertConversationDraftToken("🙂")}
      onInsertThreadMentionToken={() => insertThreadDraftToken("@")}
      onInsertThreadEmojiToken={() => insertThreadDraftToken("🙂")}
    />
  )
}
