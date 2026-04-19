import { Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Badge } from "../../../../components/ui/badge.js"
import { Button } from "../../../../components/ui/button.js"
import { cn } from "../../../../lib/utils.js"
import type { ChatFrameState } from "../../../chat/index.js"
import { ChatCreateConversationPanel } from "./chat-create-conversation-panel.js"
import { labelFromId } from "./presentation.js"

export function ChatMobileNav(props: {
  actorId: string
  actorOptions: string[]
  frame: ChatFrameState
  activeItemId: string
  participantOptions: string[]
  onSelectActor: (actorId: string) => void
  onSelectItem: (itemId: string) => void
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
}) {
  const [creating, setCreating] = useState(false)
  const createPanelRef = useRef<HTMLDivElement | null>(null)
  const createToggleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!creating) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreating(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [creating])

  useEffect(() => {
    if (!creating) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (createPanelRef.current?.contains(target) || createToggleRef.current?.contains(target)) {
        return
      }
      setCreating(false)
    }
    window.addEventListener("pointerdown", handlePointerDown)
    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [creating])

  return (
    <div className="relative border-b border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.005))] px-3 py-2 md:hidden">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Conversations
        </div>
        <div ref={createToggleRef}>
          <Button
            variant={creating ? "secondary" : "ghost"}
            size="xs"
            className="hover:bg-white/[0.04]"
            onClick={() => setCreating((current) => !current)}
          >
            <Plus className="size-3.5" strokeWidth={2.1} />
            <span>New</span>
          </Button>
        </div>
      </div>
      {props.actorOptions.length > 1 ? (
        <div className="mb-2 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-px-1 pb-1">
          {props.actorOptions.map((participantId) => {
            const selected = participantId === props.actorId
            return (
              <Button
                key={participantId}
                variant={selected ? "secondary" : "ghost"}
                size="xs"
                className={cn(
                  "snap-start rounded-full px-2.5 text-[11px]",
                  selected && "ring-1 ring-white/[0.12] shadow-[0_8px_18px_rgba(0,0,0,0.18)]",
                  !selected && "hover:bg-white/[0.04]",
                )}
                onClick={() => props.onSelectActor(participantId)}
              >
                {labelFromId(participantId)}
              </Button>
            )
          })}
        </div>
      ) : null}
      {creating ? (
        <div
          ref={createPanelRef}
          className="absolute top-[calc(100%-0.35rem)] left-3 right-3 z-20 rounded-[var(--radius-card)] border border-border bg-[var(--surface-1)] p-3 shadow-[var(--shadow-card-strong)]"
        >
          <ChatCreateConversationPanel
            participantOptions={props.participantOptions}
            onCreateConversation={props.onCreateConversation}
            onClose={() => setCreating(false)}
          />
        </div>
      ) : null}
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-1 pb-1">
        {props.frame.sidebarSections.map((section) => (
          <div key={section.id} className="min-w-max snap-start space-y-1.5">
            <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              <span>{section.label}</span>
              {section.badgeCount && section.badgeCount > 0 ? (
                <Badge
                  variant="outline"
                  size="xs"
                  className={cn(
                    "rounded-full px-1.5",
                    section.badgeTone === "attention" &&
                      "border-[color:var(--workflow-green-line)] bg-[var(--brand-green)] text-[var(--brand-green-foreground)]",
                  )}
                >
                  {section.badgeCount}
                </Badge>
              ) : null}
            </div>
            <div className="flex gap-1.5">
              {section.items.length > 0 ? (
                section.items.map((item) => {
                  const active = item.id === props.activeItemId
                  return (
                    <Button
                      key={item.id}
                      variant={active ? "secondary" : "ghost"}
                      size="xs"
                      className={cn(
                        "h-auto w-[11.75rem] shrink-0 snap-start flex-col items-start gap-1 rounded-[18px] px-3 py-2 text-left",
                        active && "ring-1 ring-white/[0.12] shadow-[0_8px_18px_rgba(0,0,0,0.2)]",
                        !active &&
                          "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                      )}
                      onClick={() => props.onSelectItem(item.id)}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="truncate text-[12px] font-medium tracking-[-0.01em] text-foreground">
                          {item.label}
                        </span>
                        {item.badgeCount > 0 ? (
                          <Badge
                            variant={active ? "default" : "outline"}
                            size="xs"
                            className={cn(
                              "shrink-0 rounded-full px-1.5",
                              item.badgeTone === "attention" &&
                                !active &&
                                "border-[color:var(--workflow-green-line)] bg-[var(--brand-green)] text-[var(--brand-green-foreground)]",
                            )}
                          >
                            {item.badgeCount}
                          </Badge>
                        ) : item.statusLabel ? (
                          <Badge
                            variant="outline"
                            size="xs"
                            className="shrink-0 rounded-full px-1.5 text-[9px] uppercase tracking-[0.06em] text-muted-foreground/88"
                          >
                            {item.statusLabel}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="line-clamp-2 min-h-[2.15rem] text-[11px] leading-[1.2] text-muted-foreground/82">
                        {item.detail ?? "No recent activity yet."}
                      </span>
                    </Button>
                  )
                })
              ) : section.emptyState ? (
                <div className="w-[11.75rem] shrink-0 rounded-[18px] border border-dashed border-border/70 bg-white/[0.02] px-3 py-2">
                  <div className="text-[12px] font-medium tracking-[-0.01em] text-muted-foreground/82">
                    {section.emptyState.title}
                  </div>
                  {section.emptyState.detail ? (
                    <div className="mt-1 line-clamp-2 min-h-[2.15rem] text-[11px] leading-[1.2] text-muted-foreground/62">
                      {section.emptyState.detail}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
