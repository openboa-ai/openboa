import {
  AtSign,
  Hash,
  Lock,
  MessageSquareText,
  SendHorizontal,
  SmilePlus,
  Users,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ChatConversation } from "../../../../chat/core/model.js"
import { Badge } from "../../../../components/ui/badge.js"
import { Button } from "../../../../components/ui/button.js"
import { Input } from "../../../../components/ui/input.js"
import { ScrollArea } from "../../../../components/ui/scroll-area.js"
import { Separator } from "../../../../components/ui/separator.js"
import { Textarea } from "../../../../components/ui/textarea.js"
import { cn } from "../../../../lib/utils.js"
import type { ChatTranscriptViewState } from "../../../chat/index.js"
import { ComposerShell } from "../system/composer-shell.js"
import { MetaPill } from "../system/meta-pill.js"
import { PaneHeader } from "../system/pane-header.js"
import { MessageRow } from "./message-row.js"
import {
  applyMentionSuggestion,
  buildMentionSuggestions,
  cycleSuggestionIndex,
  labelFromId,
  resolveSuggestionSelection,
  uiCodeClass,
  uiLabelClass,
} from "./presentation.js"

function conversationDescription(conversation: ChatConversation | null): string {
  if (!conversation) {
    return "Select a conversation"
  }
  if (conversation.topic) {
    return conversation.topic
  }
  switch (conversation.kind) {
    case "channel":
      return "No topic set"
    case "dm":
      return "Direct conversation"
    case "group_dm":
      return "Group direct conversation"
  }
}

function buildConversationStatusBadges(input: {
  conversation: ChatConversation | null
  openMode: ChatTranscriptViewState["openMode"]
}): Array<{
  label: string
  tone: "default" | "caution" | "muted"
}> {
  const conversation = input.conversation
  if (!conversation) {
    return []
  }

  const badges: Array<{
    label: string
    tone: "default" | "caution" | "muted"
  }> = [
    {
      label: conversation.kind === "channel" ? conversation.visibility : conversation.kind,
      tone: "default",
    },
  ]

  if (input.openMode === "viewer") {
    badges.push({
      label: "Read-only",
      tone: "muted",
    })
  }
  if (conversation.lifecycleState === "archived") {
    badges.push({
      label: "Archived",
      tone: "caution",
    })
  }
  if (conversation.postingPolicy === "restricted" && conversation.lifecycleState !== "archived") {
    badges.push({
      label: "Restricted posting",
      tone: "muted",
    })
  }

  return badges
}

function conversationComposerHelperCopy(input: {
  conversation: ChatConversation | null
  disabledReason: string | null
  selectedAudienceId: string | null
}): string {
  if (input.disabledReason) {
    return input.disabledReason
  }
  if (!input.conversation) {
    return "Select a conversation to start messaging."
  }
  if (input.selectedAudienceId) {
    return `Directed message to ${labelFromId(input.selectedAudienceId)}`
  }
  if (input.conversation.kind === "channel") {
    return `Broadcast to #${input.conversation.title}`
  }
  if (input.conversation.kind === "group_dm") {
    return "Visible to everyone in this direct conversation"
  }
  return `Direct message with ${input.conversation.title}`
}

export function TranscriptPane(props: {
  actorId: string
  conversation: ChatConversation | null
  view: ChatTranscriptViewState
  defaultShowRoster?: boolean
  draft: string
  editingMessageId: string | null
  editingMessageDraft: string
  participantOptions: string[]
  audienceOptions: string[]
  selectedAudienceId: string | null
  onDraftChange: (value: string) => void
  onSubmitDraft: () => void
  onOpenThread: (messageId: string) => void
  onMarkConversationRead: () => void
  onJoinConversation: () => void
  onLeaveConversation: () => void
  onAddParticipant: (participantId: string) => void
  onRemoveParticipant: (participantId: string) => void
  onGrantAccess: (participantId: string, roleId: "participant" | "viewer" | "room_manager") => void
  onRevokeAccess: (bindingId: string) => void
  onTogglePostingPolicy: () => void
  onArchiveConversation: () => void
  onUpdateConversationDetails: (
    title: string,
    topic: string | null,
    visibility: ChatConversation["visibility"] | undefined,
  ) => void
  onHideViewerConversation: () => void
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
  const { conversation, view } = props
  const [editingDetails, setEditingDetails] = useState(false)
  const defaultShowRoster = props.defaultShowRoster ?? false
  const [showRoster, setShowRoster] = useState(defaultShowRoster)
  const [participantDraft, setParticipantDraft] = useState("")
  const [grantDraft, setGrantDraft] = useState("")
  const [grantRoleDraft, setGrantRoleDraft] = useState<"participant" | "viewer" | "room_manager">(
    "participant",
  )
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [titleDraft, setTitleDraft] = useState(conversation?.title ?? "")
  const [topicDraft, setTopicDraft] = useState(conversation?.topic ?? "")
  const [visibilityDraft, setVisibilityDraft] = useState<ChatConversation["visibility"]>(
    conversation?.visibility ?? "public",
  )
  const showHeaderOverlay = editingDetails || showRoster
  const headerOverlayRef = useRef<HTMLDivElement | null>(null)
  const rosterToggleRef = useRef<HTMLDivElement | null>(null)
  const detailsToggleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setEditingDetails(false)
    setShowRoster(defaultShowRoster)
    setParticipantDraft("")
    setGrantDraft("")
    setGrantRoleDraft("participant")
    setTitleDraft(conversation?.title ?? "")
    setTopicDraft(conversation?.topic ?? "")
    setVisibilityDraft(conversation?.visibility ?? "public")
  }, [conversation, defaultShowRoster])

  useEffect(() => {
    if (!showHeaderOverlay) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditingDetails(false)
        setShowRoster(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [showHeaderOverlay])

  useEffect(() => {
    if (!showHeaderOverlay) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (
        headerOverlayRef.current?.contains(target) ||
        rosterToggleRef.current?.contains(target) ||
        detailsToggleRef.current?.contains(target)
      ) {
        return
      }
      setEditingDetails(false)
      setShowRoster(false)
    }
    window.addEventListener("pointerdown", handlePointerDown)
    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [showHeaderOverlay])

  const headerIcon =
    view.chrome.icon === "private-channel" ? (
      <Lock className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.1} />
    ) : view.chrome.icon === "channel" ? (
      <Hash className="size-4 shrink-0 text-foreground/72" strokeWidth={2.1} />
    ) : view.chrome.icon === "group-dm" ? (
      <Users className="size-4 shrink-0 text-foreground/72" strokeWidth={2.1} />
    ) : (
      <MessageSquareText className="size-4 shrink-0 text-foreground/72" strokeWidth={2.1} />
    )

  const submitConversationDetails = () => {
    if (!conversation) {
      return
    }
    const normalizedTitle = titleDraft.trim()
    if (!normalizedTitle) {
      return
    }
    const normalizedTopic = topicDraft.trim()
    props.onUpdateConversationDetails(
      normalizedTitle,
      normalizedTopic ? normalizedTopic : null,
      visibilityDraft,
    )
    setEditingDetails(false)
  }

  const submitParticipantDraft = () => {
    const participantId = participantDraft.trim()
    if (!participantId) {
      return
    }
    props.onAddParticipant(participantId)
    setParticipantDraft("")
  }
  const addableParticipantOptions = props.participantOptions.filter(
    (participantId) => !conversation?.participantIds.includes(participantId),
  )
  const grantableParticipantOptions = props.participantOptions.filter(
    (participantId) =>
      !view.accessGrants.some(
        (grant) => grant.subjectId === participantId && grant.roleId === grantRoleDraft,
      ),
  )
  const submitGrantDraft = () => {
    const participantId = grantDraft.trim()
    if (!participantId) {
      return
    }
    props.onGrantAccess(participantId, grantRoleDraft)
    setGrantDraft("")
  }
  const visibleAccessGrants = conversation
    ? view.accessGrants.filter((grant) => !conversation.participantIds.includes(grant.subjectId))
    : view.accessGrants
  const managerParticipantIds = new Set(
    (conversation ? view.accessGrants : []).flatMap((grant) =>
      conversation &&
      grant.roleId === "room_manager" &&
      conversation.participantIds.includes(grant.subjectId)
        ? [grant.subjectId]
        : [],
    ),
  )
  const composerMentionSuggestions = buildMentionSuggestions(
    props.draft,
    (conversation?.participantIds ?? []).filter((participantId) => participantId !== props.actorId),
  )
  const resolvedActiveMentionIndex =
    composerMentionSuggestions.length > 0
      ? Math.min(activeMentionIndex, composerMentionSuggestions.length - 1)
      : -1
  const conversationStatusBadges = buildConversationStatusBadges({
    conversation,
    openMode: view.openMode,
  })
  return (
    <section className="flex h-full min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
      <div className="relative z-10">
        <PaneHeader
          actionsClassName="pt-0.5"
          title={
            <div className="flex min-w-0 items-center gap-2">
              {headerIcon}
              <h1 className="truncate [font-family:var(--font-display)] text-[22px] font-semibold leading-none tracking-[-0.05em] text-foreground">
                {conversation?.title ?? "Conversation"}
              </h1>
              <div className="flex flex-wrap items-center gap-1">
                {conversationStatusBadges.map((badge) => (
                  <Badge
                    key={badge.label}
                    variant="outline"
                    size="sm"
                    className={cn(
                      "rounded-full px-2 text-[11px]",
                      badge.tone === "caution"
                        ? "border-[var(--brand-orange)]/35 bg-[var(--brand-orange)]/10 text-[var(--brand-orange)]"
                        : badge.tone === "muted"
                          ? "border-border bg-[var(--surface-2)] text-muted-foreground"
                          : "border-border bg-[var(--surface-2)] text-foreground/88",
                    )}
                  >
                    {badge.label}
                  </Badge>
                ))}
              </div>
            </div>
          }
          description={<span className="truncate">{conversationDescription(conversation)}</span>}
          actions={
            <div className="grid w-full gap-1.5 sm:w-auto sm:min-w-[20rem]">
              <div className="flex flex-wrap items-center gap-1">
                <div ref={rosterToggleRef}>
                  <Button
                    variant={showRoster ? "secondary" : "outline"}
                    size="xs"
                    className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                    onClick={() => setShowRoster((current) => !current)}
                  >
                    <Users className="size-3.5" strokeWidth={2.1} />
                    <span>{conversation?.participantIds.length ?? 0}</span>
                  </Button>
                </div>
                <MetaPill
                  icon={MessageSquareText}
                  value={conversation?.unreadCount ?? 0}
                  size="sm"
                />
                <MetaPill icon={AtSign} value={conversation?.mentionCount ?? 0} size="sm" />
                <Button
                  variant="outline"
                  size="xs"
                  className="rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                  onClick={props.onMarkConversationRead}
                >
                  Mark read
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {conversation && view.chrome.canTogglePostingPolicy ? (
                  <Button
                    variant="outline"
                    size="xs"
                    className="rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                    onClick={props.onTogglePostingPolicy}
                  >
                    {conversation.postingPolicy === "open" ? "Restrict posting" : "Open posting"}
                  </Button>
                ) : null}
                {conversation && view.chrome.canLeave ? (
                  <Button
                    variant="outline"
                    size="xs"
                    className="rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                    onClick={props.onLeaveConversation}
                  >
                    Leave
                  </Button>
                ) : null}
                {conversation && view.chrome.canEditDetails ? (
                  <div ref={detailsToggleRef}>
                    <Button
                      variant={editingDetails ? "secondary" : "outline"}
                      size="xs"
                      className="rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                      onClick={() => setEditingDetails((current) => !current)}
                    >
                      {editingDetails ? "Close details" : "Edit details"}
                    </Button>
                  </div>
                ) : null}
                {conversation && view.chrome.canArchive ? (
                  <Button
                    variant="outline"
                    size="xs"
                    className="rounded-full border-border bg-white/[0.03] px-2 text-[11px] text-foreground hover:bg-white/[0.05]"
                    onClick={props.onArchiveConversation}
                  >
                    Archive
                  </Button>
                ) : null}
              </div>
            </div>
          }
        />

        {showHeaderOverlay && conversation ? (
          <div
            ref={headerOverlayRef}
            className="pointer-events-none absolute top-[calc(100%-0.2rem)] left-3 right-3 z-20"
          >
            <div className="pointer-events-auto grid max-h-[min(34rem,calc(100dvh-14rem))] gap-2 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-[var(--surface-1)] p-3 shadow-[var(--shadow-card-strong)]">
              {editingDetails ? (
                <div className="grid gap-2">
                  <div className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_240px_auto] md:items-end">
                    <div className="grid gap-1">
                      <span className={cn(uiCodeClass, "text-[10px] text-muted-foreground")}>
                        Title
                      </span>
                      <Input
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        placeholder="Room title"
                        className="h-9 bg-white/[0.02]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <span className={cn(uiCodeClass, "text-[10px] text-muted-foreground")}>
                        Visibility
                      </span>
                      <div className="flex h-9 items-center gap-1 rounded-[var(--radius-control)] border border-input bg-input p-1 shadow-[var(--shadow-ring-soft)]">
                        {(["public", "private"] as const).map((visibility) => (
                          <Button
                            key={visibility}
                            type="button"
                            variant={visibilityDraft === visibility ? "secondary" : "ghost"}
                            size="xs"
                            className="h-7 flex-1 capitalize hover:bg-white/[0.05]"
                            onClick={() => setVisibilityDraft(visibility)}
                          >
                            {visibility}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-9 border-border bg-[var(--surface-2)] px-3 text-foreground shadow-none hover:bg-[var(--accent)]"
                        disabled={!titleDraft.trim()}
                        onClick={submitConversationDetails}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-3 hover:bg-white/[0.05]"
                        onClick={() => {
                          setEditingDetails(false)
                          setTitleDraft(conversation.title)
                          setTopicDraft(conversation.topic ?? "")
                          setVisibilityDraft(conversation.visibility)
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <span className={cn(uiCodeClass, "text-[10px] text-muted-foreground")}>
                      Topic
                    </span>
                    <Input
                      value={topicDraft}
                      onChange={(event) => setTopicDraft(event.target.value)}
                      placeholder="Topic"
                      className="h-9 bg-white/[0.02]"
                    />
                  </div>
                </div>
              ) : null}

              {showRoster ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={cn(uiCodeClass, "text-[10px]")}>Room roster</p>
                      <p className="text-[12px] text-muted-foreground">
                        Current room participants and access holders.
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-muted-foreground"
                    >
                      {conversation.participantIds.length} active
                    </Badge>
                  </div>
                  {view.chrome.canManageParticipants ? (
                    <div className="grid gap-1.5 rounded-[var(--radius-control)] border border-border bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className={cn(uiCodeClass, "text-[10px]")}>Add participant</p>
                          <p className="text-[12px] text-muted-foreground">
                            Invite another participant into this conversation.
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          size="sm"
                          className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-muted-foreground"
                        >
                          Joined room
                        </Badge>
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        <Input
                          list="chat-roster-participants"
                          value={participantDraft}
                          onChange={(event) => setParticipantDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              submitParticipantDraft()
                            }
                          }}
                          placeholder="participant-id"
                          className="h-9 bg-white/[0.02]"
                        />
                        <datalist id="chat-roster-participants">
                          {addableParticipantOptions.map((participantId) => (
                            <option key={participantId} value={participantId} />
                          ))}
                        </datalist>
                        <Button
                          size="sm"
                          className="h-9 border-border bg-[var(--surface-2)] px-3 text-foreground shadow-none hover:bg-[var(--accent)]"
                          disabled={!participantDraft.trim()}
                          onClick={submitParticipantDraft}
                        >
                          Add
                        </Button>
                      </div>
                      {addableParticipantOptions.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {addableParticipantOptions.map((participantId) => (
                            <Button
                              key={participantId}
                              variant="ghost"
                              size="xs"
                              className="hover:bg-white/[0.05]"
                              onClick={() => props.onAddParticipant(participantId)}
                            >
                              {labelFromId(participantId)}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {view.chrome.canManageParticipants ? (
                    <div className="grid gap-1.5 rounded-[var(--radius-control)] border border-border bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className={cn(uiCodeClass, "text-[10px]")}>Grant access</p>
                          <p className="text-[12px] text-muted-foreground">
                            Add invite, viewer access, or room manager rights.
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          size="sm"
                          className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-muted-foreground"
                        >
                          {visibleAccessGrants.length}{" "}
                          {visibleAccessGrants.length === 1 ? "grant" : "grants"}
                        </Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                        <Input
                          list="chat-roster-grants"
                          value={grantDraft}
                          onChange={(event) => setGrantDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              submitGrantDraft()
                            }
                          }}
                          placeholder="participant-id"
                          className="h-9 bg-white/[0.02]"
                        />
                        <datalist id="chat-roster-grants">
                          {grantableParticipantOptions.map((participantId) => (
                            <option key={participantId} value={participantId} />
                          ))}
                        </datalist>
                        <div className="flex h-9 items-center gap-1 rounded-[var(--radius-control)] border border-input bg-input p-1 shadow-[var(--shadow-ring-soft)]">
                          {(
                            [
                              { id: "participant", label: "Invite" },
                              { id: "viewer", label: "Viewer" },
                              { id: "room_manager", label: "Manager" },
                            ] as const
                          ).map((role) => (
                            <Button
                              key={role.id}
                              type="button"
                              variant={grantRoleDraft === role.id ? "secondary" : "ghost"}
                              size="xs"
                              className="h-7 hover:bg-white/[0.05]"
                              onClick={() => setGrantRoleDraft(role.id)}
                            >
                              {role.label}
                            </Button>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          className="h-9 border-border bg-[var(--surface-2)] px-3 text-foreground shadow-none hover:bg-[var(--accent)]"
                          disabled={!grantDraft.trim()}
                          onClick={submitGrantDraft}
                        >
                          Grant
                        </Button>
                      </div>
                      {grantableParticipantOptions.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {grantableParticipantOptions.map((participantId) => (
                            <Button
                              key={participantId}
                              variant="ghost"
                              size="xs"
                              className="hover:bg-white/[0.05]"
                              onClick={() => props.onGrantAccess(participantId, grantRoleDraft)}
                            >
                              {labelFromId(participantId)}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      {visibleAccessGrants.length > 0 ? (
                        <div className="grid gap-1.5">
                          {visibleAccessGrants.map((grant) => (
                            <div
                              key={grant.bindingId}
                              className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-white/[0.02] px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-medium text-foreground">
                                  {labelFromId(grant.subjectId)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className={cn(uiCodeClass, "truncate text-[10px]")}>
                                    {grant.subjectId}
                                  </p>
                                  <Badge
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-muted-foreground"
                                  >
                                    {grant.roleId === "participant"
                                      ? "Invited"
                                      : grant.roleId === "viewer"
                                        ? "Viewer"
                                        : "Manager"}
                                  </Badge>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="xs"
                                className="shrink-0 px-2 text-[11px] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                                onClick={() => props.onRevokeAccess(grant.bindingId)}
                              >
                                Revoke
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="grid gap-1.5">
                    {conversation.participantIds.map((participantId) => {
                      const isActor = participantId === props.actorId
                      const canRemove =
                        view.chrome.canManageParticipants &&
                        !isActor &&
                        conversation.participantIds.length > 1 &&
                        conversation.lifecycleState !== "archived"
                      return (
                        <div
                          key={participantId}
                          className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-white/[0.02] px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-foreground">
                              {labelFromId(participantId)}
                              {isActor ? (
                                <span className="ml-2 text-[11px] text-muted-foreground">
                                  (You)
                                </span>
                              ) : null}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className={cn(uiCodeClass, "truncate text-[10px]")}>
                                {participantId}
                              </p>
                              {managerParticipantIds.has(participantId) ? (
                                <Badge
                                  variant="outline"
                                  size="sm"
                                  className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-muted-foreground"
                                >
                                  Manager
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          {canRemove ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="shrink-0 px-2 text-[11px] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                              onClick={() => props.onRemoveParticipant(participantId)}
                            >
                              Remove
                            </Button>
                          ) : (
                            <Badge
                              variant="outline"
                              size="sm"
                              className="rounded-full border-border bg-[var(--surface-2)] px-2 text-[11px] text-muted-foreground"
                            >
                              {isActor ? "Local" : "Member"}
                            </Badge>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {view.viewerTreatment ? (
        <div className="flex flex-col gap-2 border-b border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.006))] px-3 py-2 md:flex-row md:items-center">
          <Badge
            variant="outline"
            className="rounded-full border-border bg-[var(--surface-2)] px-2 py-0.5 text-foreground"
          >
            {view.viewerTreatment.badge}
          </Badge>
          <p className="flex-1 text-[13px] leading-[1.45] text-muted-foreground">
            {view.viewerTreatment.detail}
          </p>
          <Button
            size="sm"
            className="h-8 border-[color:var(--workflow-green-line)] bg-[var(--brand-green)] px-3 text-[var(--brand-green-foreground)] shadow-none hover:bg-[#9ad83b]"
            onClick={props.onJoinConversation}
          >
            {view.viewerTreatment.actionLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-[13px] hover:bg-white/[0.05]"
            onClick={props.onHideViewerConversation}
          >
            Hide
          </Button>
        </div>
      ) : null}

      <ScrollArea className="h-full min-h-0 flex-1">
        <div className="px-0 py-1">
          {view.transcript.length > 0 ? (
            <>
              <div className="mb-1 flex items-center gap-2 px-3">
                <Separator className="flex-1" />
                <span className={cn(uiCodeClass, "text-[10px]")}>Today</span>
                <Separator className="flex-1" />
              </div>

              <div className="grid gap-0">
                {view.transcript.map((message) => (
                  <MessageRow
                    key={message.messageId}
                    authorLabel={
                      message.author.kind === "system" ? "System" : labelFromId(message.author.id)
                    }
                    authorKind={message.author.kind}
                    audienceLabel={
                      message.audience?.kind === "participant"
                        ? labelFromId(message.audience.id)
                        : null
                    }
                    body={message.body}
                    createdAt={message.createdAt}
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
                      props.editingMessageId === message.messageId ? props.editingMessageDraft : ""
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
                    focused={view.focusMessageId === message.messageId}
                    onOpenThread={
                      message.threadReplyCount
                        ? () => props.onOpenThread(message.messageId)
                        : undefined
                    }
                    threadReplyCount={message.threadReplyCount}
                    threadPreview={message.threadPreview}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="px-4 py-4">
              <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-white/[0.02] px-4 py-4">
                <div className="text-sm font-medium tracking-[-0.01em] text-foreground">
                  No messages yet
                </div>
                <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">
                  Use the composer below to start the conversation. Room state, attention, and
                  thread history will collect here.
                </p>
              </div>
            </div>
          )}
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
                if (event.key === "Enter" && !event.shiftKey) {
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
              placeholder={view.composer.placeholder}
              className="min-h-[28px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-[1.45] shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            />
          }
          toolbar={
            <>
              {props.audienceOptions.length > 0 ? (
                <div className="mr-2 flex flex-wrap items-center gap-1">
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
                </div>
              ) : null}
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
              <span className={cn("ml-1 text-[11px] text-muted-foreground tracking-[-0.01em]")}>
                {conversationComposerHelperCopy({
                  conversation,
                  disabledReason: view.composer.disabledReason,
                  selectedAudienceId: props.selectedAudienceId,
                })}
              </span>
            </>
          }
          action={
            <Button
              disabled={!view.composer.enabled}
              size="xs"
              className="ml-auto border-border bg-[var(--surface-2)] px-3 text-foreground shadow-none hover:bg-[var(--accent)]"
              onClick={props.onSubmitDraft}
            >
              <span className={uiLabelClass}>Send</span>
              <SendHorizontal className="size-4" strokeWidth={2.1} />
            </Button>
          }
        />
      </div>
    </section>
  )
}
