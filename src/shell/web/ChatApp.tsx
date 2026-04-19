import { buildChatFrameState } from "../chat/index.js"
import { useChatShellState } from "./chat-app-state.js"
import { ChatWorkspace } from "./components/chat/chat-workspace.js"

export function ChatApp() {
  const {
    actorId,
    actorOptions,
    activeConversationDraft,
    activeConversationAudienceId,
    activeConversationAudienceOptions,
    activeThreadDraft,
    activeThreadAudienceId,
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
