import { Plus } from "lucide-react"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import { Avatar, AvatarFallback } from "../../../../components/ui/avatar.js"
import { Button } from "../../../../components/ui/button.js"
import { ScrollArea } from "../../../../components/ui/scroll-area.js"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "../../../../components/ui/sidebar.js"
import { cn } from "../../../../lib/utils.js"
import type { ChatFrameState } from "../../../chat/index.js"
import { SidebarSectionList } from "../chrome/sidebar-section-list.js"
import { ListRowContent } from "../system/list-row-content.js"
import { PaneHeader } from "../system/pane-header.js"
import { ChatCreateConversationPanel } from "./chat-create-conversation-panel.js"
import { avatarFromLabel, labelFromId, uiCodeClass, uiTitleClass } from "./presentation.js"

export function ChatSidebar(props: {
  actorId: string
  actorOptions: string[]
  frame: ChatFrameState
  activeItemId: string | null
  canCreateConversation: boolean
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
    <Sidebar
      collapsible="none"
      className="hidden md:flex md:border-r md:border-border"
      style={{ "--sidebar-width": "16.5rem" } as CSSProperties}
    >
      <SidebarHeader className="relative p-0">
        <PaneHeader
          title={
            <span className={cn(uiTitleClass, "text-[16px] leading-none")}>Conversations</span>
          }
          actions={
            <div ref={createToggleRef}>
              <Button
                variant={creating ? "secondary" : "ghost"}
                size="icon-sm"
                className="shrink-0 hover:bg-white/[0.04]"
                disabled={!props.canCreateConversation}
                onClick={() => setCreating((current) => !current)}
              >
                <Plus className="size-4" strokeWidth={2.1} />
              </Button>
            </div>
          }
        />
        {creating && props.canCreateConversation ? (
          <div
            ref={createPanelRef}
            className="absolute top-[calc(100%-0.25rem)] left-3 right-3 z-20 rounded-[var(--radius-card)] border border-border bg-[var(--surface-1)] p-3 shadow-[var(--shadow-card-strong)]"
          >
            <ChatCreateConversationPanel
              participantOptions={props.participantOptions}
              onCreateConversation={props.onCreateConversation}
              onClose={() => setCreating(false)}
            />
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="p-0">
        <ScrollArea className="h-full">
          <div className="py-1">
            {props.frame.sidebarSections.map((section) => (
              <SidebarSectionList
                key={section.id}
                section={section}
                activeId={props.activeItemId ?? undefined}
                onSelectItem={props.onSelectItem}
              />
            ))}
          </div>
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="border-t border-border bg-[image:var(--panel-gradient)] p-1.5">
        <div className="rounded-[var(--radius-control)] border border-border/70 bg-white/[0.02] px-2.5 py-2 shadow-[var(--shadow-ring-soft)]">
          <div className={cn(uiCodeClass, "mb-1.5 text-[10px] text-muted-foreground/78")}>
            Viewing as
          </div>
          <ListRowContent
            leading={
              <Avatar className="size-7 border border-border/80 bg-[var(--surface-2)]">
                <AvatarFallback className="bg-transparent text-xs font-semibold text-foreground">
                  {avatarFromLabel(labelFromId(props.actorId))}
                </AvatarFallback>
              </Avatar>
            }
            title={labelFromId(props.actorId)}
            detail={props.actorId}
            leadingAlign="center"
            leadingClassName="mt-0"
            detailClassName={cn(uiCodeClass, "text-[10px]")}
          />
          {props.actorOptions.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {props.actorOptions.map((participantId) => (
                <Button
                  key={participantId}
                  variant={participantId === props.actorId ? "secondary" : "ghost"}
                  size="xs"
                  className="h-7 rounded-full px-2.5 text-[11px] hover:bg-white/[0.05]"
                  onClick={() => props.onSelectActor(participantId)}
                >
                  {labelFromId(participantId)}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
