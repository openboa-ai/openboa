import { X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "../../../../components/ui/badge.js"
import { Button } from "../../../../components/ui/button.js"
import { cn } from "../../../../lib/utils.js"
import { cycleSuggestionIndex, labelFromId, resolveSuggestionSelection } from "./presentation.js"

function normalizeParticipantId(value: string): string {
  return value.trim()
}

export function appendDirectConversationParticipant(
  participantIds: readonly string[],
  participantId: string,
): string[] {
  const normalized = normalizeParticipantId(participantId)
  if (!normalized) {
    return [...participantIds]
  }
  return Array.from(new Set([...participantIds, normalized]))
}

export function removeDirectConversationParticipant(
  participantIds: readonly string[],
  participantId: string,
): string[] {
  return participantIds.filter((value) => value !== participantId)
}

export function buildDirectConversationSuggestions(
  participantOptions: readonly string[],
  selectedParticipantIds: readonly string[],
  query: string,
): string[] {
  const normalizedQuery = normalizeParticipantId(query).toLowerCase()
  return participantOptions
    .filter((participantId) => !selectedParticipantIds.includes(participantId))
    .filter((participantId) => {
      if (!normalizedQuery) {
        return true
      }
      const label = labelFromId(participantId).toLowerCase()
      return (
        participantId.toLowerCase().includes(normalizedQuery) || label.includes(normalizedQuery)
      )
    })
    .slice(0, 6)
}

export function resolveDirectConversationDraft(input: {
  selectedParticipantIds: readonly string[]
  query: string
}): {
  participantIds: string[]
  canSubmit: boolean
  helperCopy: string
} {
  const pendingParticipantId = normalizeParticipantId(input.query)
  const participantIds = pendingParticipantId
    ? appendDirectConversationParticipant(input.selectedParticipantIds, pendingParticipantId)
    : [...input.selectedParticipantIds]

  if (participantIds.length === 0) {
    return {
      participantIds,
      canSubmit: false,
      helperCopy: "Choose at least one participant to start a direct conversation.",
    }
  }

  if (pendingParticipantId) {
    return {
      participantIds,
      canSubmit: true,
      helperCopy: `Create will add ${labelFromId(pendingParticipantId)} to this conversation.`,
    }
  }

  return {
    participantIds,
    canSubmit: true,
    helperCopy:
      participantIds.length === 1
        ? "This will create a direct message."
        : "This will create a private group conversation.",
  }
}

export function ChatCreateConversationPanel(props: {
  className?: string
  participantOptions?: string[]
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
  onClose: () => void
}) {
  const [draftMode, setDraftMode] = useState<"channel" | "direct">("channel")
  const [draftTitle, setDraftTitle] = useState("")
  const [draftParticipants, setDraftParticipants] = useState<string[]>([])
  const [draftParticipantQuery, setDraftParticipantQuery] = useState("")
  const [draftVisibility, setDraftVisibility] = useState<"public" | "private">("public")
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const channelInputRef = useRef<HTMLInputElement | null>(null)
  const participantInputRef = useRef<HTMLInputElement | null>(null)
  const directSuggestions = useMemo(
    () =>
      buildDirectConversationSuggestions(
        props.participantOptions ?? [],
        draftParticipants,
        draftParticipantQuery,
      ),
    [props.participantOptions, draftParticipants, draftParticipantQuery],
  )
  const directDraft = useMemo(
    () =>
      resolveDirectConversationDraft({
        selectedParticipantIds: draftParticipants,
        query: draftParticipantQuery,
      }),
    [draftParticipants, draftParticipantQuery],
  )
  const resolvedActiveSuggestionIndex =
    directSuggestions.length > 0
      ? Math.min(activeSuggestionIndex, directSuggestions.length - 1)
      : -1

  const appendParticipant = (participantId: string) => {
    setDraftParticipants((current) => appendDirectConversationParticipant(current, participantId))
    setDraftParticipantQuery("")
    setActiveSuggestionIndex(0)
  }

  const removeParticipant = (participantId: string) => {
    setDraftParticipants((current) => removeDirectConversationParticipant(current, participantId))
  }

  const commitParticipantQuery = (fallbackParticipantId?: string) => {
    const participantId =
      fallbackParticipantId ??
      resolveSuggestionSelection(directSuggestions, resolvedActiveSuggestionIndex) ??
      draftParticipantQuery
    const normalized = normalizeParticipantId(participantId)
    if (!normalized) {
      return false
    }
    appendParticipant(normalized)
    return true
  }

  const reset = () => {
    setDraftMode("channel")
    setDraftTitle("")
    setDraftParticipants([])
    setDraftParticipantQuery("")
    setDraftVisibility("public")
  }

  const close = () => {
    reset()
    props.onClose()
  }

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      if (draftMode === "direct") {
        participantInputRef.current?.focus()
      } else {
        channelInputRef.current?.focus()
      }
    })

    return () => window.cancelAnimationFrame(handle)
  }, [draftMode])

  const submit = () => {
    if (draftMode === "direct") {
      if (!directDraft.canSubmit) {
        return
      }
      props.onCreateConversation({
        kind: "direct",
        participantIds: directDraft.participantIds,
      })
      close()
      return
    }

    const title = draftTitle.trim()
    if (!title) {
      return
    }
    props.onCreateConversation({
      kind: "channel",
      title,
      visibility: draftVisibility,
    })
    close()
  }

  return (
    <div className={props.className}>
      <div className="mb-2 flex items-center gap-1">
        <Button
          variant={draftMode === "channel" ? "secondary" : "ghost"}
          size="xs"
          className="hover:bg-white/[0.05]"
          onClick={() => setDraftMode("channel")}
        >
          Channel
        </Button>
        <Button
          variant={draftMode === "direct" ? "secondary" : "ghost"}
          size="xs"
          className="hover:bg-white/[0.05]"
          onClick={() => setDraftMode("direct")}
        >
          Direct
        </Button>
      </div>
      {draftMode === "direct" ? (
        <div className="rounded-[var(--radius-control)] border border-border bg-[var(--surface-2)] px-2.5 py-2 shadow-[var(--shadow-ring-soft)]">
          {draftParticipants.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draftParticipants.map((participantId) => (
                <Badge
                  key={participantId}
                  variant="secondary"
                  size="sm"
                  className="gap-1 rounded-full bg-white/[0.05] px-2 text-[11px]"
                >
                  <span>{labelFromId(participantId)}</span>
                  <button
                    type="button"
                    className="flex size-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                    aria-label={`Remove ${labelFromId(participantId)}`}
                    onClick={() => removeParticipant(participantId)}
                  >
                    <X className="size-3" strokeWidth={2.1} />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
          <input
            ref={participantInputRef}
            value={draftParticipantQuery}
            onChange={(event) => {
              setDraftParticipantQuery(event.target.value)
              setActiveSuggestionIndex(0)
            }}
            onKeyDown={(event) => {
              if (
                (event.key === "Enter" || event.key === "," || event.key === "Tab") &&
                draftParticipantQuery.trim()
              ) {
                event.preventDefault()
                commitParticipantQuery()
                return
              }
              if (event.key === "ArrowDown" && directSuggestions.length > 0) {
                event.preventDefault()
                setActiveSuggestionIndex((current) =>
                  cycleSuggestionIndex(current, 1, directSuggestions.length),
                )
                return
              }
              if (event.key === "ArrowUp" && directSuggestions.length > 0) {
                event.preventDefault()
                setActiveSuggestionIndex((current) =>
                  cycleSuggestionIndex(current, -1, directSuggestions.length),
                )
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                submit()
              }
              if (
                event.key === "Backspace" &&
                !draftParticipantQuery &&
                draftParticipants.length > 0
              ) {
                event.preventDefault()
                removeParticipant(draftParticipants[draftParticipants.length - 1] ?? "")
              }
              if (event.key === "Escape") {
                close()
              }
            }}
            placeholder={
              draftParticipants.length > 0 ? "Add more participants" : "Choose participants"
            }
            className="h-7 w-full border-0 bg-transparent px-0 py-0 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      ) : (
        <input
          ref={channelInputRef}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
            if (event.key === "Escape") {
              close()
            }
          }}
          placeholder="Create channel"
          className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-[var(--surface-2)] px-3 text-[13px] text-foreground shadow-[var(--shadow-ring-soft)] outline-none placeholder:text-muted-foreground focus-visible:border-white/16 focus-visible:ring-2 focus-visible:ring-ring/70"
        />
      )}
      {draftMode === "direct" ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p
              className={cn(
                "text-[11px]",
                directDraft.canSubmit ? "text-muted-foreground" : "text-[var(--brand-orange)]",
              )}
            >
              {directDraft.helperCopy}
            </p>
            {draftParticipants.length > 0 ? (
              <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/72">
                {draftParticipants.length} selected
              </span>
            ) : null}
          </div>
          {directSuggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {directSuggestions.map((participantId, index) => (
                <Button
                  key={participantId}
                  variant={index === resolvedActiveSuggestionIndex ? "secondary" : "ghost"}
                  size="xs"
                  className="hover:bg-white/[0.05]"
                  title={participantId}
                  aria-selected={index === resolvedActiveSuggestionIndex}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => appendParticipant(participantId)}
                >
                  {labelFromId(participantId)}
                </Button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {draftMode === "channel" ? (
        <div className="mt-2 flex items-center gap-1">
          <Button
            variant={draftVisibility === "public" ? "secondary" : "ghost"}
            size="xs"
            className="hover:bg-white/[0.05]"
            onClick={() => setDraftVisibility("public")}
          >
            Public
          </Button>
          <Button
            variant={draftVisibility === "private" ? "secondary" : "ghost"}
            size="xs"
            className="hover:bg-white/[0.05]"
            onClick={() => setDraftVisibility("private")}
          >
            Private
          </Button>
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="ghost" size="xs" className="hover:bg-white/[0.05]" onClick={close}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={draftMode === "direct" ? !directDraft.canSubmit : !draftTitle.trim()}
          className="bg-[var(--surface-2)] text-foreground shadow-none hover:bg-[var(--accent)]"
          onClick={submit}
        >
          Create
        </Button>
      </div>
    </div>
  )
}
