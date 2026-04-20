import { AtSign, CornerDownLeft, SmilePlus, Star, X } from "lucide-react"
import { useState } from "react"
import { Badge } from "../../../../components/ui/badge.js"
import { Button } from "../../../../components/ui/button.js"
import { ScrollArea } from "../../../../components/ui/scroll-area.js"
import { Textarea } from "../../../../components/ui/textarea.js"
import { cn } from "../../../../lib/utils.js"
import type { ChatTranscriptViewState } from "../../../chat/index.js"
import { shouldSubmitChatComposerFromKeyInput } from "../../chat-submit.js"
import { ComposerShell } from "../system/composer-shell.js"
import { PaneHeader } from "../system/pane-header.js"
import { MessageRow } from "./message-row.js"
import {
  applyMentionSuggestion,
  buildMentionSuggestions,
  cycleSuggestionIndex,
  labelFromId,
  resolveSuggestionSelection,
  uiCodeClass,
  uiTitleClass,
} from "./presentation.js"

export function ThreadPane(props: {
  actorId: string
  onClose: () => void
  title: string
  view: ChatTranscriptViewState
  draft: string
  editingMessageId: string | null
  editingMessageDraft: string
  audienceOptions: string[]
  selectedAudienceId: string | null
  onDraftChange: (value: string) => void
  onSubmitDraft: () => void
  onMarkRead: () => void
  onToggleFollow: () => void
  onStartEditingMessage: (messageId: string) => void
  onEditingMessageDraftChange: (value: string) => void
  onCancelEditingMessage: () => void
  onSaveEditingMessage: () => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onRedactMessage: (messageId: string) => void
  onToggleAudience: (participantId: string) => void
  onInsertMentionToken: () => void
  onInsertEmojiToken: () => void
}) {
  const { title, view } = props
  const rootMessage = view.threadDrawer.rootMessage
  const replyMessages = view.threadDrawer.messages
  const replyCount = replyMessages.length
  const composerMentionSuggestions = buildMentionSuggestions(props.draft, props.audienceOptions)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const resolvedActiveMentionIndex =
    composerMentionSuggestions.length > 0
      ? Math.min(activeMentionIndex, composerMentionSuggestions.length - 1)
      : -1

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--surface-1)]/98">
      <PaneHeader
        actionsClassName="pt-0.5 sm:pt-0.5"
        eyebrow="Thread"
        title={<h2 className={cn(uiTitleClass, "truncate text-[17px] leading-tight")}>{title}</h2>}
        description={
          <span
            className={cn(
              uiCodeClass,
              "text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
            )}
          >
            {replyCount > 0 ? `${replyCount} repl${replyCount === 1 ? "y" : "ies"}` : "no replies"}
          </span>
        }
        actions={
          <div className="grid w-full gap-1.5 sm:w-auto sm:min-w-[17rem]">
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                className="justify-center rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                onClick={props.onToggleFollow}
              >
                <Star className="size-3.5" strokeWidth={2.1} />
                <span>{view.threadDrawer.followed ? "Following" : "Follow"}</span>
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="justify-center rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05] disabled:opacity-45"
                disabled={
                  view.threadDrawer.unreadReplyCount <= 0 &&
                  view.threadDrawer.unreadMentionCount <= 0
                }
                onClick={props.onMarkRead}
              >
                Mark read
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto hover:bg-white/[0.04]"
                onClick={props.onClose}
              >
                <X className="size-4" strokeWidth={2.1} />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge
                variant="outline"
                size="xs"
                className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  view.threadDrawer.unreadReplyCount > 0
                    ? "border-border bg-[var(--surface-2)] text-muted-foreground"
                    : "border-border/70 bg-white/[0.03] text-muted-foreground/80",
                )}
              >
                {view.threadDrawer.unreadReplyCount} unread
              </Badge>
              <Badge
                variant="outline"
                size="xs"
                className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  view.threadDrawer.unreadMentionCount > 0
                    ? "border-[color:var(--workflow-green-line)] bg-[var(--brand-green)] text-[var(--brand-green-foreground)]"
                    : "border-border/70 bg-white/[0.03] text-muted-foreground/80",
                )}
              >
                {view.threadDrawer.unreadMentionCount} mentions
              </Badge>
            </div>
          </div>
        }
      />

      <ScrollArea className="h-full min-h-0 flex-1">
        <div className="grid gap-3 px-2.5 py-2">
          {rootMessage ? (
            <section className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className={cn(uiCodeClass, "text-[10px] text-muted-foreground")}>
                  Original message
                </span>
                <Badge
                  variant="outline"
                  size="xs"
                  className="rounded-full border-border bg-[var(--surface-2)] px-1.5 text-[10px] text-muted-foreground"
                >
                  {replyCount} repl{replyCount === 1 ? "y" : "ies"}
                </Badge>
              </div>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-white/[0.02] shadow-[var(--shadow-ring-soft)]">
                <MessageRow
                  authorKind={rootMessage.author.kind}
                  authorLabel={labelFromId(rootMessage.author.id)}
                  audienceLabel={
                    rootMessage.audience?.kind === "participant"
                      ? labelFromId(rootMessage.audience.id)
                      : null
                  }
                  createdAt={rootMessage.createdAt}
                  body={rootMessage.body}
                  editedAt={rootMessage.editedAt}
                  redactedAt={rootMessage.redactedAt}
                  reactions={rootMessage.reactions}
                  activeReactionEmojis={rootMessage.reactions
                    .filter((reaction) => reaction.participantIds.includes(props.actorId))
                    .map((reaction) => reaction.emoji)}
                  onToggleReaction={
                    rootMessage.author.kind === "participant" && view.openMode === "joined"
                      ? (emoji) => props.onToggleReaction(rootMessage.messageId, emoji)
                      : undefined
                  }
                  canEdit={
                    rootMessage.author.kind === "participant" &&
                    rootMessage.author.id === props.actorId &&
                    view.openMode === "joined"
                  }
                  editing={props.editingMessageId === rootMessage.messageId}
                  editDraft={
                    props.editingMessageId === rootMessage.messageId
                      ? props.editingMessageDraft
                      : ""
                  }
                  onEditDraftChange={props.onEditingMessageDraftChange}
                  onStartEdit={() => props.onStartEditingMessage(rootMessage.messageId)}
                  onCancelEdit={props.onCancelEditingMessage}
                  onSaveEdit={props.onSaveEditingMessage}
                  canRedact={
                    rootMessage.author.kind === "participant" &&
                    view.openMode === "joined" &&
                    (rootMessage.author.id === props.actorId || view.chrome.canModerateMessages)
                  }
                  onRedact={() => props.onRedactMessage(rootMessage.messageId)}
                  density="compact"
                />
              </div>
            </section>
          ) : (
            <section className="rounded-[var(--radius-card)] border border-dashed border-border bg-white/[0.02] px-4 py-4">
              <div className="text-sm font-medium tracking-[-0.01em] text-foreground">
                No thread selected
              </div>
              <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">
                Open any reply chain to review the root message, unread state, and follow status in
                one place.
              </p>
            </section>
          )}

          {rootMessage ? (
            <section className="grid gap-0">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <span className={cn(uiCodeClass, "text-[10px] text-muted-foreground")}>
                  Replies
                </span>
                {replyMessages.length > 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    {replyMessages.length} in this thread
                  </span>
                ) : null}
              </div>
              {replyMessages.length > 0 ? (
                replyMessages.map((message, index) => (
                  <div key={message.messageId} className="grid gap-0">
                    {index > 0 ? <div className="ml-[46px] border-t border-border/50" /> : null}
                    <MessageRow
                      authorKind={message.author.kind}
                      authorLabel={labelFromId(message.author.id)}
                      audienceLabel={
                        message.audience?.kind === "participant"
                          ? labelFromId(message.audience.id)
                          : null
                      }
                      createdAt={message.createdAt}
                      body={message.body}
                      editedAt={message.editedAt}
                      redactedAt={message.redactedAt}
                      reactions={message.reactions}
                      activeReactionEmojis={message.reactions
                        .filter((reaction) => reaction.participantIds.includes(props.actorId))
                        .map((reaction) => reaction.emoji)}
                      onToggleReaction={
                        message.author.kind === "participant" && view.openMode === "joined"
                          ? (emoji) => props.onToggleReaction(message.messageId, emoji)
                          : undefined
                      }
                      canEdit={
                        message.author.kind === "participant" &&
                        message.author.id === props.actorId &&
                        view.openMode === "joined"
                      }
                      editing={props.editingMessageId === message.messageId}
                      editDraft={
                        props.editingMessageId === message.messageId
                          ? props.editingMessageDraft
                          : ""
                      }
                      onEditDraftChange={props.onEditingMessageDraftChange}
                      onStartEdit={() => props.onStartEditingMessage(message.messageId)}
                      onCancelEdit={props.onCancelEditingMessage}
                      onSaveEdit={props.onSaveEditingMessage}
                      canRedact={
                        message.author.kind === "participant" &&
                        view.openMode === "joined" &&
                        (message.author.id === props.actorId || view.chrome.canModerateMessages)
                      }
                      onRedact={() => props.onRedactMessage(message.messageId)}
                      density="compact"
                    />
                  </div>
                ))
              ) : (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-white/[0.02] px-4 py-3 text-[12px] leading-[1.45] text-muted-foreground">
                  No replies yet. Reply in thread to keep follow state and read tracking on the root
                  message.
                </div>
              )}
            </section>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border px-0 py-0">
        <ComposerShell
          variant="embedded"
          overlay={
            composerMentionSuggestions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1 rounded-[var(--radius-card)] border border-border bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-card-strong)]">
                <span className={cn(uiCodeClass, "px-1 text-[10px] text-muted-foreground")}>
                  Mention
                </span>
                {composerMentionSuggestions.map((participantId, index) => (
                  <Button
                    key={participantId}
                    variant={index === resolvedActiveMentionIndex ? "secondary" : "ghost"}
                    size="xs"
                    className="hover:bg-white/[0.05]"
                    aria-selected={index === resolvedActiveMentionIndex}
                    onMouseEnter={() => setActiveMentionIndex(index)}
                    onClick={() =>
                      props.onDraftChange(applyMentionSuggestion(props.draft, participantId))
                    }
                  >
                    {labelFromId(participantId)}
                  </Button>
                ))}
              </div>
            ) : null
          }
          editor={
            <Textarea
              disabled={!view.composer.enabled}
              value={props.draft}
              onChange={(event) => {
                setActiveMentionIndex(0)
                props.onDraftChange(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && composerMentionSuggestions.length > 0) {
                  event.preventDefault()
                  setActiveMentionIndex((current) =>
                    cycleSuggestionIndex(current, 1, composerMentionSuggestions.length),
                  )
                  return
                }
                if (event.key === "ArrowUp" && composerMentionSuggestions.length > 0) {
                  event.preventDefault()
                  setActiveMentionIndex((current) =>
                    cycleSuggestionIndex(current, -1, composerMentionSuggestions.length),
                  )
                  return
                }
                const nativeEvent = event.nativeEvent as KeyboardEvent
                if (
                  shouldSubmitChatComposerFromKeyInput({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: nativeEvent.isComposing,
                    keyCode: nativeEvent.keyCode,
                    which: nativeEvent.which,
                  })
                ) {
                  event.preventDefault()
                  const selectedMention = resolveSuggestionSelection(
                    composerMentionSuggestions,
                    resolvedActiveMentionIndex,
                  )
                  if (selectedMention) {
                    props.onDraftChange(applyMentionSuggestion(props.draft, selectedMention))
                    return
                  }
                  props.onSubmitDraft()
                }
              }}
              placeholder={view.composer.enabled ? "Reply in thread" : view.composer.placeholder}
              className="min-h-[28px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-[1.45] shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            />
          }
          toolbar={
            <div className="flex flex-wrap items-center gap-1">
              {props.audienceOptions.map((participantId) => (
                <Button
                  key={participantId}
                  variant={props.selectedAudienceId === participantId ? "secondary" : "ghost"}
                  size="xs"
                  className="hover:bg-white/[0.04]"
                  onClick={() => props.onToggleAudience(participantId)}
                >
                  <span>To {labelFromId(participantId)}</span>
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                className="hover:bg-white/[0.04]"
                onClick={props.onInsertMentionToken}
              >
                <AtSign className="size-4" strokeWidth={2.1} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hover:bg-white/[0.04]"
                onClick={props.onInsertEmojiToken}
              >
                <SmilePlus className="size-4" strokeWidth={2.1} />
              </Button>
              <span className={cn("text-[11px] text-muted-foreground tracking-[-0.01em]")}>
                {view.composer.disabledReason ??
                  (props.selectedAudienceId
                    ? `Reply to ${labelFromId(props.selectedAudienceId)}`
                    : "Thread reply")}
              </span>
            </div>
          }
          action={
            <Button
              disabled={!view.composer.enabled}
              size="xs"
              className="ml-auto border-border bg-[var(--surface-2)] px-3 text-foreground shadow-none hover:bg-[var(--accent)]"
              onClick={props.onSubmitDraft}
            >
              <span>Reply</span>
              <CornerDownLeft className="size-4" strokeWidth={2.1} />
            </Button>
          }
        />
      </div>
    </aside>
  )
}
