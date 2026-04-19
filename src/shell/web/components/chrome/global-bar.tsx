import { Bell, ChevronDown, Search } from "lucide-react"
import { useEffect, useRef } from "react"
import { Badge } from "../../../../components/ui/badge.js"
import { Button } from "../../../../components/ui/button.js"
import { Input } from "../../../../components/ui/input.js"
import { cn } from "../../../../lib/utils.js"
import type { ChatSearchResult } from "../../chat-app-state.js"
import { labelFromId, uiCodeClass } from "../chat/presentation.js"
import { MetaPill } from "../system/meta-pill.js"

export function GlobalBar(props: {
  actorId?: string
  searchQuery?: string
  searchResults?: ChatSearchResult[]
  activeSearchResultIndex?: number
  onSearchQueryChange?: (value: string) => void
  onSelectSearchResult?: (result: ChatSearchResult) => void
  onMoveSearchSelection?: (delta: number) => void
  onSubmitActiveSearchResult?: () => void
  inboxCount?: number
  onOpenInbox?: () => void
}) {
  const searchQuery = props.searchQuery ?? ""
  const searchResults = props.searchResults ?? []
  const activeSearchResultIndex = props.activeSearchResultIndex ?? 0
  const onSearchQueryChange = props.onSearchQueryChange ?? (() => {})
  const onSelectSearchResult = props.onSelectSearchResult ?? (() => {})
  const onMoveSearchSelection = props.onMoveSearchSelection ?? (() => {})
  const onSubmitActiveSearchResult = props.onSubmitActiveSearchResult ?? (() => {})
  const inboxCount = props.inboxCount ?? 0
  const onOpenInbox = props.onOpenInbox ?? (() => {})
  const actorId = props.actorId ?? "local-participant"
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.012),rgba(255,255,255,0))] px-3 py-1.5">
      <div className="flex h-9 shrink-0 items-center gap-2 px-0">
        <span className="size-2 rounded-full bg-[var(--brand-green)]" aria-hidden="true" />
        <span className="[font-family:var(--font-display)] text-[17px] font-semibold tracking-[-0.04em] text-foreground">
          openboa
        </span>
        <ChevronDown className="size-4 text-muted-foreground" strokeWidth={2.1} />
      </div>

      <div className="relative order-3 w-full min-w-0 sm:order-none sm:min-w-[16rem] sm:flex-1 sm:basis-[20rem] sm:self-stretch lg:max-w-[32rem]">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2.1}
        />
        <Input
          ref={inputRef}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          aria-keyshortcuts="Meta+K"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              onMoveSearchSelection(1)
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              onMoveSearchSelection(-1)
            }
            if (event.key === "Enter" && searchResults[0]) {
              event.preventDefault()
              onSubmitActiveSearchResult()
            }
            if (event.key === "Escape") {
              onSearchQueryChange("")
            }
          }}
          placeholder="Search rooms and messages..."
          className="h-9 rounded-[9999px] border-border bg-[var(--surface-2)] pl-10 pr-14 text-[13px] text-foreground shadow-none placeholder:text-muted-foreground"
        />
        <span
          className={cn(
            uiCodeClass,
            "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[9999px] border border-border bg-[var(--surface-1)] px-1.5 py-0.5 text-[10px]",
          )}
        >
          ⌘K
        </span>
        {searchQuery.trim() ? (
          <div className="absolute top-[calc(100%+0.4rem)] left-0 right-0 z-20 overflow-hidden rounded-[var(--radius-card)] border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card-strong)]">
            {searchResults.length > 0 ? (
              <>
                <div className="grid max-h-[20rem] gap-0.5 overflow-y-auto p-1">
                  {searchResults.map((result) => (
                    <Button
                      key={`${result.sidebarItemId}:${result.resultKind}:${result.messageId ?? "room"}`}
                      variant={
                        searchResults[activeSearchResultIndex]?.resultKind === result.resultKind &&
                        searchResults[activeSearchResultIndex]?.messageId === result.messageId &&
                        searchResults[activeSearchResultIndex]?.sidebarItemId ===
                          result.sidebarItemId
                          ? "secondary"
                          : "ghost"
                      }
                      className={cn(
                        "relative h-auto w-full justify-start rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-white/[0.04]",
                        searchResults[activeSearchResultIndex]?.resultKind === result.resultKind &&
                          searchResults[activeSearchResultIndex]?.messageId === result.messageId &&
                          searchResults[activeSearchResultIndex]?.sidebarItemId ===
                            result.sidebarItemId &&
                          "bg-white/[0.06] ring-1 ring-white/[0.08] shadow-[0_10px_28px_rgba(0,0,0,0.18)]",
                      )}
                      onClick={() => onSelectSearchResult(result)}
                    >
                      {searchResults[activeSearchResultIndex]?.resultKind === result.resultKind &&
                      searchResults[activeSearchResultIndex]?.messageId === result.messageId &&
                      searchResults[activeSearchResultIndex]?.sidebarItemId ===
                        result.sidebarItemId ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-2 left-1 w-0.5 rounded-full bg-foreground/88"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <div className="truncate text-[12px] font-medium tracking-[-0.01em] text-foreground">
                            {result.conversationTitle}
                          </div>
                          {result.resultKind === "conversation" ? (
                            <Badge
                              variant="outline"
                              size="xs"
                              className="rounded-full px-1.5 text-[9px]"
                            >
                              Room
                            </Badge>
                          ) : null}
                          {result.threadId ? (
                            <Badge
                              variant="outline"
                              size="xs"
                              className="rounded-full px-1.5 text-[9px]"
                            >
                              Thread
                            </Badge>
                          ) : null}
                          {result.openMode === "viewer" ? (
                            <Badge
                              variant="outline"
                              size="xs"
                              className="rounded-full px-1.5 text-[9px]"
                            >
                              Viewer
                            </Badge>
                          ) : null}
                        </div>
                        <div className="line-clamp-2 min-h-[2.15rem] text-[11px] leading-[1.2] text-muted-foreground">
                          {result.preview}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border bg-white/[0.02] px-3 py-1.5">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/78">
                    {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Enter to jump · Esc to clear
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-2 px-3 py-3">
                  <div className="flex size-8 items-center justify-center rounded-full border border-border bg-[var(--surface-2)] text-muted-foreground">
                    <Search className="size-4" strokeWidth={2.1} />
                  </div>
                  <div>
                    <div className="text-[12px] font-medium text-foreground">No matches yet</div>
                    <div className="text-[11px] text-muted-foreground">
                      Search room names, topics, and message text.
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end border-t border-border bg-white/[0.02] px-3 py-1.5 text-[11px] text-muted-foreground">
                  Esc to clear
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Badge
          variant="outline"
          size="sm"
          className="hidden rounded-[9999px] border-[color:var(--workflow-green-line)] bg-[color:var(--workflow-green-soft)] px-2.5 py-1 text-[color:var(--brand-green)] sm:inline-flex"
        >
          <span
            className="mr-1.5 size-1.5 rounded-full bg-[var(--brand-green)]"
            aria-hidden="true"
          />
          Live
        </Badge>
        <Button
          variant="outline"
          size="icon-sm"
          className="bg-[var(--surface-2)]"
          onClick={onOpenInbox}
        >
          <Bell className="size-4" strokeWidth={2.1} />
        </Button>
        <Badge
          variant="outline"
          size="sm"
          className={cn(
            "min-w-[5.9rem] justify-center rounded-[9999px] border-border bg-[var(--surface-2)] px-2 text-[11px] text-foreground",
            inboxCount <= 0 && "text-muted-foreground/88",
          )}
        >
          {inboxCount > 0 ? `${inboxCount} inbox` : "All clear"}
        </Badge>
        <MetaPill
          value={labelFromId(actorId)}
          size="sm"
          leading={<span className="size-1.5 rounded-full bg-foreground/72" aria-hidden="true" />}
          className="px-2.5"
        />
      </div>
    </div>
  )
}
