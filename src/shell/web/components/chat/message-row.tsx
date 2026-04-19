import { Bell, MessageSquareText, Pencil, SmilePlus, Trash2, X } from "lucide-react"
import type { ChatMessageReaction } from "../../../../chat/core/model.js"
import { Avatar, AvatarFallback } from "../../../../components/ui/avatar.js"
import { Badge } from "../../../../components/ui/badge.js"
import { Button } from "../../../../components/ui/button.js"
import { Textarea } from "../../../../components/ui/textarea.js"
import { cn } from "../../../../lib/utils.js"
import {
  avatarFromLabel,
  formatCount,
  formatTime,
  messageAuthorClass,
  messageBodyClass,
  uiCodeClass,
} from "./presentation.js"

export const DEFAULT_MESSAGE_REACTION_OPTIONS = ["👍", "❤️", "✅", "🎉", "👀", "🤔"] as const

export function MessageRow(props: {
  authorLabel: string
  authorKind: "participant" | "system"
  audienceLabel?: string | null
  body: string
  createdAt: string
  editedAt?: string | null
  redactedAt?: string | null
  reactions?: ChatMessageReaction[]
  focused?: boolean
  onOpenThread?: () => void
  threadReplyCount?: number
  threadPreview?: string | null
  density?: "default" | "compact"
  activeReactionEmojis?: string[]
  reactionOptions?: readonly string[]
  onToggleReaction?: (emoji: string) => void
  canEdit?: boolean
  editing?: boolean
  editDraft?: string
  onEditDraftChange?: (value: string) => void
  onStartEdit?: () => void
  onCancelEdit?: () => void
  onSaveEdit?: () => void
  canRedact?: boolean
  onRedact?: () => void
}) {
  const authorTag = props.authorKind === "system" ? "System" : null
  const compact = props.density === "compact"
  const activeReactionEmojis = props.activeReactionEmojis ?? []
  const reactionOptions = props.reactionOptions ?? DEFAULT_MESSAGE_REACTION_OPTIONS
  const messageStateTag = props.redactedAt ? "Redacted" : props.editedAt ? "Edited" : null
  const canMutateMessage = props.authorKind === "participant" && !props.redactedAt
  const showActionRow =
    canMutateMessage &&
    !props.editing &&
    (props.onToggleReaction != null || props.onStartEdit != null || props.onRedact != null)

  return (
    <div
      data-slot="message-row"
      data-density={compact ? "compact" : "default"}
      className={cn(
        "group relative grid grid-cols-[32px_minmax(0,1fr)] gap-3 px-4 transition-colors hover:bg-white/[0.018]",
        compact ? "py-1.5" : "py-2",
        props.focused && "bg-white/[0.022]",
      )}
    >
      <Avatar className="size-8 border border-border/60 bg-transparent">
        <AvatarFallback className="bg-transparent text-xs font-semibold text-foreground">
          {props.authorKind === "system" ? (
            <Bell className="size-4" strokeWidth={2.1} />
          ) : (
            avatarFromLabel(props.authorLabel)
          )}
        </AvatarFallback>
      </Avatar>

      <div className={cn("relative min-w-0", compact ? "pr-2 md:pr-24" : "pr-6 md:pr-36")}>
        <div
          className={cn(
            "flex flex-wrap gap-2",
            compact ? "items-center gap-1.5" : "items-baseline",
          )}
        >
          <span className={cn(messageAuthorClass, compact ? "text-[13px]" : "text-[14px]")}>
            {props.authorLabel}
          </span>
          {authorTag ? (
            <Badge
              variant="outline"
              size="xs"
              className="rounded-full border border-border/80 bg-white/6 px-2 text-[10px] text-foreground"
            >
              {authorTag}
            </Badge>
          ) : null}
          {props.audienceLabel ? (
            <Badge
              variant="outline"
              size="xs"
              className="rounded-full border border-border/80 bg-white/6 px-2 text-[10px] text-foreground/78"
            >
              To {props.audienceLabel}
            </Badge>
          ) : null}
          <span className={cn(uiCodeClass, compact ? "text-[10px] leading-none" : "text-[11px]")}>
            {formatTime(props.createdAt)}
          </span>
          {messageStateTag ? (
            <span
              className={cn(
                uiCodeClass,
                compact
                  ? "text-[10px] leading-none text-foreground/65"
                  : "text-[11px] text-foreground/65",
              )}
            >
              {messageStateTag}
            </span>
          ) : null}
        </div>

        <div>
          {props.editing ? (
            <div className="mt-1.5 max-w-[42rem] rounded-[18px] border border-border/80 bg-white/[0.03] px-3 py-2.5">
              <Textarea
                value={props.editDraft ?? ""}
                onChange={(event) => props.onEditDraftChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault()
                    props.onSaveEdit?.()
                  }
                }}
                className="min-h-[76px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-[1.52] shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  className="hover:bg-white/[0.05]"
                  onClick={props.onCancelEdit}
                >
                  <X className="size-3.5" strokeWidth={2.1} />
                  <span>Cancel</span>
                </Button>
                <Button
                  size="xs"
                  className="bg-[var(--surface-2)] text-foreground shadow-none hover:bg-[var(--accent)]"
                  onClick={props.onSaveEdit}
                >
                  <Pencil className="size-3.5" strokeWidth={2.1} />
                  <span>Save</span>
                </Button>
              </div>
            </div>
          ) : (
            <p
              className={cn(
                messageBodyClass,
                compact ? "mt-0.75 pr-0" : "mt-0.5 pr-4",
                compact
                  ? "max-w-none text-[13px] leading-[1.48]"
                  : "max-w-[42rem] text-[14px] leading-[1.52]",
              )}
            >
              {props.body}
            </p>
          )}
        </div>

        {props.reactions && props.reactions.length > 0 ? (
          <div className={cn("mt-1 flex flex-wrap gap-1.5", compact && "mt-1 gap-1")}>
            {props.reactions.map((reaction) => (
              <Badge
                key={`${reaction.emoji}:${reaction.participantIds.join(",")}`}
                variant="outline"
                size={compact ? "xs" : "sm"}
                className={cn(
                  "rounded-full border-border/80 bg-white/[0.03] text-foreground",
                  compact ? "px-1.5" : "px-2",
                )}
              >
                <span>{reaction.emoji}</span>
                <span className={cn(uiCodeClass, compact ? "text-[9px]" : "text-[10px]")}>
                  {reaction.count}
                </span>
              </Badge>
            ))}
          </div>
        ) : null}

        {showActionRow ? (
          <div
            className={cn(
              "absolute top-0 right-0 z-10 flex flex-wrap items-center justify-end gap-1 rounded-[12px] border border-border/70 bg-[var(--surface-1)]/96 px-1 py-1 shadow-[var(--shadow-card)] opacity-100 backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
              compact && "gap-0.5 px-0.75 py-0.75",
            )}
          >
            {props.onToggleReaction ? (
              <details className="group/reaction relative">
                <summary className="list-none">
                  <Button asChild variant="ghost" size="xs" className="hover:bg-white/[0.05]">
                    <span>
                      <SmilePlus className="size-3.5" strokeWidth={2.1} />
                      <span>React</span>
                    </span>
                  </Button>
                </summary>
                <div className="absolute top-[calc(100%+0.35rem)] left-0 z-20 flex flex-wrap items-center gap-1 rounded-[14px] border border-border bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-card-strong)]">
                  {reactionOptions.map((emoji) => {
                    const active = activeReactionEmojis.includes(emoji)
                    return (
                      <Button
                        key={emoji}
                        variant={active ? "secondary" : "ghost"}
                        size="icon-xs"
                        className="size-8 rounded-full text-[15px] hover:bg-white/[0.05]"
                        onClick={(event) => {
                          props.onToggleReaction?.(emoji)
                          const picker = event.currentTarget.closest("details")
                          if (picker instanceof HTMLDetailsElement) {
                            picker.open = false
                          }
                        }}
                      >
                        <span>{emoji}</span>
                      </Button>
                    )
                  })}
                </div>
              </details>
            ) : null}
            {props.canEdit && !props.editing && props.onStartEdit ? (
              <Button
                variant="ghost"
                size="xs"
                className="hover:bg-white/[0.05]"
                onClick={props.onStartEdit}
              >
                <Pencil className="size-3.5" strokeWidth={2.1} />
                <span>Edit</span>
              </Button>
            ) : null}
            {props.canRedact && props.onRedact ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                onClick={props.onRedact}
              >
                <Trash2 className="size-3.5" strokeWidth={2.1} />
                <span>Redact</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        {!compact && props.threadReplyCount ? (
          <Button
            onClick={props.onOpenThread}
            variant="outline"
            size="xs"
            className="mt-1.5 h-6 rounded-[9999px] border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
          >
            <MessageSquareText className="size-3.5" strokeWidth={2.1} />
            <span>{formatCount(props.threadReplyCount, "reply")}</span>
            {props.threadPreview ? (
              <span className="max-w-44 truncate text-foreground/70">{props.threadPreview}</span>
            ) : null}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
