import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../../../components/ui/sidebar.js"
import { cn } from "../../../../lib/utils.js"
import { sectionIcon, shellLabelClass } from "../shared/presentation.js"
import { CountBadge } from "../system/count-badge.js"
import { ListRowContent } from "../system/list-row-content.js"

export interface ShellSidebarItem {
  id: string
  label: string
  detail: string | null
  badgeCount: number
  badgeTone?: "default" | "attention" | "muted"
  muted?: boolean
  statusLabel?: string
  statusTone?: "default" | "attention" | "muted"
}

export interface ShellSidebarSection {
  id: string
  label: string
  badgeCount?: number
  badgeTone?: "default" | "attention" | "muted"
  items: ShellSidebarItem[]
  emptyState?: {
    title: string
    detail?: string
    tone?: "default" | "attention" | "muted"
  }
}

export function SidebarSectionList(props: {
  section: ShellSidebarSection
  activeId?: string | null
  onSelectItem?: (itemId: string) => void
}) {
  const Icon = sectionIcon(props.section.id)
  const alwaysShowDetail = true

  return (
    <SidebarGroup className="px-1">
      <SidebarGroupLabel
        className={cn(
          shellLabelClass,
          "flex items-center justify-between gap-2 px-2 pb-1.5 pt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80",
        )}
      >
        <span>{props.section.label}</span>
        {props.section.badgeCount && props.section.badgeCount > 0 ? (
          <CountBadge
            value={props.section.badgeCount}
            size="xs"
            tone={props.section.badgeTone ?? "default"}
          />
        ) : null}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {props.section.items.length > 0 ? (
            props.section.items.map((item) => (
              <SidebarSectionItem
                key={item.id}
                icon={Icon}
                item={item}
                active={item.id === props.activeId}
                onSelectItem={props.onSelectItem}
                showDetail={alwaysShowDetail}
              />
            ))
          ) : props.section.emptyState ? (
            <SidebarMenuItem>
              <div className="rounded-[var(--radius-small)] px-2 py-1.5">
                <ListRowContent
                  leading={<Icon className="size-3.5" strokeWidth={2.1} />}
                  title={props.section.emptyState.title}
                  detail={props.section.emptyState.detail}
                  leadingClassName="flex size-4.5 shrink-0 items-center justify-center text-muted-foreground/65"
                  titleClassName="text-[12px] font-medium text-muted-foreground/82"
                  detailClassName="line-clamp-2 text-[11px] leading-[1.22] text-muted-foreground/62"
                />
              </div>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function SidebarSectionItem(props: {
  item: ShellSidebarItem
  icon: ReturnType<typeof sectionIcon>
  active: boolean
  showDetail: boolean
  onSelectItem?: (itemId: string) => void
}) {
  const Icon = props.icon
  const detailVisible = props.showDetail && Boolean(props.item.detail)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={props.active}
        onClick={() => props.onSelectItem?.(props.item.id)}
        className={cn(
          "relative h-auto overflow-hidden rounded-[var(--radius-small)] border-0 px-2 py-1.75 text-left transition-colors hover:bg-white/[0.02]",
          props.active &&
            "bg-white/[0.06] text-foreground ring-1 ring-white/[0.08] shadow-[0_10px_26px_rgba(0,0,0,0.16)]",
          props.item.muted && !props.active && "opacity-55",
        )}
      >
        {props.active ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-1.5 left-0.5 w-0.5 rounded-full bg-foreground/88"
          />
        ) : null}
        <ListRowContent
          leading={<Icon className="size-3.5" strokeWidth={2.1} />}
          title={props.item.label}
          detail={detailVisible ? props.item.detail : undefined}
          trailing={
            props.item.badgeCount > 0 ? (
              <CountBadge value={props.item.badgeCount} tone={props.item.badgeTone ?? "default"} />
            ) : props.item.statusLabel ? (
              <CountBadge
                value={props.item.statusLabel}
                size="xs"
                tone={props.item.statusTone ?? "muted"}
                className="px-1.5 text-[9px] uppercase tracking-[0.06em]"
              />
            ) : undefined
          }
          leadingClassName={cn(
            "flex size-4.5 shrink-0 items-center justify-center",
            props.active && "text-foreground",
          )}
          detailClassName="line-clamp-2 text-[11px] leading-[1.18]"
        />
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
