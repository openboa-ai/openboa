import type { LucideIcon } from "lucide-react"
import { Activity, AtSign, Eye, Hash, LayoutGrid, MessageSquareText, Users } from "lucide-react"
import type { TopLevelSurfaceState, WorkItemState } from "../../../../shared/company-model.js"
import { demoCompanyShell } from "../../demo-shell.js"

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
})

export const uiLabelClass =
  "[font-family:var(--font-ui)] text-[12px] font-medium tracking-[-0.01em]"
export const uiCodeClass =
  "[font-family:var(--font-mono)] text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
export const displayTitleClass =
  "[font-family:var(--font-display)] font-semibold tracking-[-0.05em] text-foreground"
export const displayHeadingClass =
  "[font-family:var(--font-display)] font-semibold tracking-[-0.04em] text-foreground"
export const shellLabelClass =
  "[font-family:var(--font-mono)] text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
export const uiTitleClass =
  "[font-family:var(--font-display)] text-[24px] font-semibold tracking-[-0.04em] text-foreground"
export const roomTitleClass =
  "[font-family:var(--font-display)] text-[32px] font-semibold leading-[1.1] tracking-[-0.06em] text-foreground sm:text-[40px]"
export const messageAuthorClass =
  "[font-family:var(--font-ui)] text-[16px] font-semibold tracking-[-0.02em] text-foreground"
export const messageBodyClass =
  "[font-family:var(--font-body)] text-[15px] leading-[1.6] tracking-[-0.012em] text-foreground"
export const panelCardClass =
  "rounded-[var(--radius-card)] border-border bg-card shadow-[var(--shadow-card)]"
export const panelShellClass =
  "rounded-[var(--radius-panel)] border border-border bg-card shadow-[var(--shadow-card)]"

export function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return "now"
  }
  return timeFormatter.format(new Date(timestamp))
}

export function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}

export function labelFromId(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function avatarFromLabel(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function surfaceIcon(surface: TopLevelSurfaceState): LucideIcon {
  switch (surface) {
    case "chat":
      return MessageSquareText
    case "work":
      return LayoutGrid
    case "observe":
      return Activity
  }
}

export function sectionIcon(sectionId: string): LucideIcon {
  if (sectionId === "inbox") {
    return AtSign
  }
  if (sectionId === "followed") {
    return MessageSquareText
  }
  if (sectionId === "channels") {
    return Hash
  }
  if (sectionId === "viewer-recents") {
    return Eye
  }
  return Users
}

export function workflowPillClass(state: WorkItemState) {
  switch (state) {
    case "in_progress":
    case "done_recently":
      return "border-[color:var(--workflow-green-line)] bg-[color:var(--workflow-green-soft)] text-[color:var(--workflow-green)]"
    case "needs_decision":
      return "border-[color:var(--workflow-amber-line)] bg-[color:var(--workflow-amber-soft)] text-[color:var(--workflow-amber)]"
    case "blocked":
      return "border-[color:var(--workflow-red-line)] bg-[color:var(--workflow-red-soft)] text-[color:var(--workflow-red)]"
    case "inbox":
      return "border-border bg-white/[0.04] text-foreground"
  }
}

export function workflowDotClass(state: WorkItemState) {
  switch (state) {
    case "in_progress":
    case "done_recently":
      return "bg-[color:var(--workflow-green)]"
    case "needs_decision":
      return "bg-[color:var(--workflow-amber)]"
    case "blocked":
      return "bg-[color:var(--workflow-red)]"
    case "inbox":
      return "bg-foreground/55"
  }
}

export function workItemStateFor(workItemId: string | null | undefined): WorkItemState | null {
  if (!workItemId) {
    return null
  }

  const workCard = demoCompanyShell.work.lanes
    .flatMap((lane) => lane.items)
    .find((item) => item.workItemId === workItemId)

  if (workCard) {
    return workCard.state
  }

  const observeCard = demoCompanyShell.observe.workItems.find(
    (item) => item.workItemId === workItemId,
  )
  return observeCard?.state ?? null
}
