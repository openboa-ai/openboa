import type { ChatSurface } from "../../../../chat/view-model.js"
import { SidebarInset } from "../../../../components/ui/sidebar.js"
import type { ChatFrameState, ChatTranscriptViewState } from "../../../chat/index.js"
import type { ChatSearchResult } from "../../chat-app-state.js"
import { GlobalBar } from "../chrome/global-bar.js"
import { ChatMobileNav } from "./chat-mobile-nav.js"
import { ChatSidebar } from "./chat-sidebar.js"
import { ThreadPane } from "./thread-pane.js"
import { TranscriptPane } from "./transcript-pane.js"

export function ChatWorkspace(props: {
  actorId: string
  actorOptions: string[]
  frame: ChatFrameState
  chat: ChatSurface
  transcriptView: ChatTranscriptViewState
  activeSidebarItemId: string
  conversationDraft: string
  threadDraft: string
  editingMessageId: string | null
  editingMessageDraft: string
  searchQuery: string
  searchResults: ChatSearchResult[]
  activeSearchResultIndex: number
  inboxCount: number
  canCreateConversation: boolean
  canHideViewerConversation: boolean
  participantOptions: string[]
  audienceOptions: string[]
  selectedConversationAudienceId: string | null
  selectedThreadAudienceId: string | null
  onCreateConversation: (
    input:
      | {
          kind: "channel"
          title: string
          visibility: "public" | "private"
        }
      | {
          kind: "direct"
          participantIds: string[]
        },
  ) => void
  onSelectActor: (actorId: string) => void
  onOpenInbox: () => void
  onSelectSidebarItem: (itemId: string) => void
  onCloseThread: () => void
  onOpenThread: (messageId: string) => void
  onConversationDraftChange: (value: string) => void
  onSubmitConversationDraft: () => void
  onThreadDraftChange: (value: string) => void
  onSubmitThreadDraft: () => void
  onMarkConversationRead: () => void
  onMarkThreadRead: () => void
  onToggleThreadFollow: () => void
  onJoinConversation: () => void
  onLeaveConversation: () => void
  onAddParticipantToConversation: (participantId: string) => void
  onRemoveParticipantFromConversation: (participantId: string) => void
  onGrantConversationAccess: (
    participantId: string,
    roleId: "participant" | "viewer" | "room_manager",
  ) => void
  onRevokeConversationAccess: (bindingId: string) => void
  onTogglePostingPolicy: () => void
  onArchiveConversation: () => void
  onUpdateConversationDetails: (
    title: string,
    topic: string | null,
    visibility: "public" | "private" | undefined,
  ) => void
  onHideViewerConversation: () => void
  onStartEditingMessage: (messageId: string) => void
  onEditingMessageDraftChange: (value: string) => void
  onCancelEditingMessage: () => void
  onSaveEditingMessage: () => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onRedactMessage: (messageId: string) => void
  onSearchQueryChange: (value: string) => void
  onSelectSearchResult: (result: ChatSearchResult) => void
  onMoveSearchSelection: (delta: number) => void
  onSubmitActiveSearchResult: () => void
  onToggleConversationAudience: (participantId: string) => void
  onToggleThreadAudience: (participantId: string) => void
  onInsertConversationMentionToken: () => void
  onInsertConversationEmojiToken: () => void
  onInsertThreadMentionToken: () => void
  onInsertThreadEmojiToken: () => void
}) {
  const showThreadPane = props.frame.detailPane?.kind === "thread"

  return (
    <div className="flex h-full min-h-0 flex-1 max-md:flex-col">
      <ChatSidebar
        actorId={props.actorId}
        actorOptions={props.actorOptions}
        frame={props.frame}
        activeItemId={props.activeSidebarItemId}
        canCreateConversation={props.canCreateConversation}
        participantOptions={props.participantOptions}
        onSelectActor={props.onSelectActor}
        onSelectItem={props.onSelectSidebarItem}
        onCreateConversation={props.onCreateConversation}
      />

      <SidebarInset className="h-full min-h-0 border-0 bg-background">
        <div className="grid h-full min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]">
          <GlobalBar
            actorId={props.actorId}
            searchQuery={props.searchQuery}
            searchResults={props.searchResults}
            activeSearchResultIndex={props.activeSearchResultIndex}
            inboxCount={props.inboxCount}
            onOpenInbox={props.onOpenInbox}
            onSearchQueryChange={props.onSearchQueryChange}
            onSelectSearchResult={props.onSelectSearchResult}
            onMoveSearchSelection={props.onMoveSearchSelection}
            onSubmitActiveSearchResult={props.onSubmitActiveSearchResult}
          />
          <ChatMobileNav
            actorId={props.actorId}
            actorOptions={props.actorOptions}
            frame={props.frame}
            activeItemId={props.activeSidebarItemId}
            canCreateConversation={props.canCreateConversation}
            participantOptions={props.participantOptions}
            onSelectActor={props.onSelectActor}
            onSelectItem={props.onSelectSidebarItem}
            onCreateConversation={props.onCreateConversation}
          />
          <div
            className={
              showThreadPane
                ? "grid h-full min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
                : "grid h-full min-h-0 flex-1 grid-cols-1"
            }
          >
            <TranscriptPane
              actorId={props.actorId}
              conversation={props.chat.activeConversation}
              view={props.transcriptView}
              draft={props.conversationDraft}
              editingMessageId={props.editingMessageId}
              editingMessageDraft={props.editingMessageDraft}
              participantOptions={props.participantOptions}
              audienceOptions={props.audienceOptions}
              selectedAudienceId={props.selectedConversationAudienceId}
              onDraftChange={props.onConversationDraftChange}
              onSubmitDraft={props.onSubmitConversationDraft}
              onOpenThread={props.onOpenThread}
              onMarkConversationRead={props.onMarkConversationRead}
              onJoinConversation={props.onJoinConversation}
              onLeaveConversation={props.onLeaveConversation}
              onAddParticipant={props.onAddParticipantToConversation}
              onRemoveParticipant={props.onRemoveParticipantFromConversation}
              onGrantAccess={props.onGrantConversationAccess}
              onRevokeAccess={props.onRevokeConversationAccess}
              onTogglePostingPolicy={props.onTogglePostingPolicy}
              onArchiveConversation={props.onArchiveConversation}
              onUpdateConversationDetails={props.onUpdateConversationDetails}
              canHideViewerConversation={props.canHideViewerConversation}
              onHideViewerConversation={props.onHideViewerConversation}
              onStartEditingMessage={props.onStartEditingMessage}
              onEditingMessageDraftChange={props.onEditingMessageDraftChange}
              onCancelEditingMessage={props.onCancelEditingMessage}
              onSaveEditingMessage={props.onSaveEditingMessage}
              onToggleReaction={props.onToggleReaction}
              onRedactMessage={props.onRedactMessage}
              onToggleAudience={props.onToggleConversationAudience}
              onInsertMentionToken={props.onInsertConversationMentionToken}
              onInsertEmojiToken={props.onInsertConversationEmojiToken}
            />
            {showThreadPane ? (
              <ThreadPane
                actorId={props.actorId}
                onClose={props.onCloseThread}
                title={props.frame.detailPane?.title ?? "Thread"}
                view={props.transcriptView}
                draft={props.threadDraft}
                editingMessageId={props.editingMessageId}
                editingMessageDraft={props.editingMessageDraft}
                audienceOptions={props.audienceOptions}
                selectedAudienceId={props.selectedThreadAudienceId}
                onDraftChange={props.onThreadDraftChange}
                onSubmitDraft={props.onSubmitThreadDraft}
                onMarkRead={props.onMarkThreadRead}
                onToggleFollow={props.onToggleThreadFollow}
                onStartEditingMessage={props.onStartEditingMessage}
                onEditingMessageDraftChange={props.onEditingMessageDraftChange}
                onCancelEditingMessage={props.onCancelEditingMessage}
                onSaveEditingMessage={props.onSaveEditingMessage}
                onToggleReaction={props.onToggleReaction}
                onRedactMessage={props.onRedactMessage}
                onToggleAudience={props.onToggleThreadAudience}
                onInsertMentionToken={props.onInsertThreadMentionToken}
                onInsertEmojiToken={props.onInsertThreadEmojiToken}
              />
            ) : null}
          </div>
        </div>
      </SidebarInset>
    </div>
  )
}
