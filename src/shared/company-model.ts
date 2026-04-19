import type { ChatParticipantRef } from "../chat/core/model.js"
import type { ChatProjectedMessage, ChatSurface } from "../chat/view-model.js"

export type TopLevelSurfaceState = "chat" | "work" | "observe"

export interface CompanyTopLevelTab {
  surface: TopLevelSurfaceState
  label: string
  badgeCount: number
}

export type WorkItemType = "task" | "proposal" | "approval" | "blocker" | "result"
export type WorkItemState = "inbox" | "needs_decision" | "in_progress" | "blocked" | "done_recently"

export interface ExecutionRef {
  agentId: string
  taskId: string
  sessionId: string
  conversationId: string
  threadId: string | null
}

export interface WorkItemRecord {
  eventType: "work.item.upserted"
  companyId: string
  eventId: string
  sequence: number
  workItemId: string
  itemType: WorkItemType
  state: WorkItemState
  title: string
  summary: string
  ownerId: string | null
  participantIds: string[]
  sourceConversationId: string
  sourceThreadId: string | null
  sourceMessageId: string
  latestUpdate: string
  nextAction: string
  createdAt: string
  updatedAt: string
  publishedBy: ChatParticipantRef
  trackInWork: boolean
  blockedReason: string | null
  approvalRequired: boolean
  executionRefs: ExecutionRef[]
  labels: string[]
}

export interface WorkItemUpsertInput {
  companyId?: string
  workItemId?: string
  itemType: WorkItemType
  state: WorkItemState
  title: string
  summary: string
  ownerId?: string | null
  participantIds?: string[]
  sourceConversationId: string
  sourceThreadId?: string | null
  sourceMessageId: string
  latestUpdate: string
  nextAction: string
  createdAt?: string
  updatedAt: string
  publishedBy: ChatParticipantRef
  trackInWork?: boolean
  blockedReason?: string | null
  approvalRequired?: boolean
  executionRefs?: ExecutionRef[]
  labels?: string[]
}

export interface WorkSelector {
  itemType?: WorkItemType
  state?: WorkItemState
  ownerId?: string
  participantId?: string
  conversationId?: string
  labels?: string[]
}

export interface PolicyBinding {
  bindingId: string
  role: string
  subjectId: string
  scope: string
  selector: WorkSelector
}

export interface WorkCard {
  workItemId: string
  itemType: WorkItemType
  state: WorkItemState
  title: string
  summary: string
  ownerId: string | null
  participantIds: string[]
  sourceConversationId: string
  sourceThreadId: string | null
  sourceMessageId: string
  latestUpdate: string
  nextAction: string
  updatedAt: string
  blockedReason: string | null
  approvalRequired: boolean
}

export interface WorkLane {
  laneId: WorkItemState
  label: string
  items: WorkCard[]
}

export interface CompanyWorkSurface {
  queueSidebar: Array<{
    queueId: WorkItemState | "all"
    label: string
    count: number
  }>
  channelFilters: Array<{ conversationId: string; label: string; count: number }>
  participantFilters: Array<{ participantId: string; count: number }>
  activeQueueId: WorkItemState | "all"
  lanes: WorkLane[]
  selectedItem: WorkCard | null
}

export interface ObserveWorkSummary {
  workItemId: string
  title: string
  itemType: WorkItemType
  state: WorkItemState
  ownerId: string | null
  participantIds: string[]
  latestUpdate: string
  updatedAt: string
  sourceConversationId: string
  sourceThreadId: string | null
  sourceMessageId: string
  executionRefs: ExecutionRef[]
  subtaskCount: number
  blockedCount: number
}

export interface ObserveLinkedChatContext {
  conversationId: string
  conversationTitle: string
  sourceMessageId: string
  recentMessages: ChatProjectedMessage[]
}

export interface ObserveAgentEvidence {
  agentId: string
  status: "idle" | "error"
  latestTask: string | null
  latestResponse: string | null
  lastActivityAt: string | null
  liveStatus: {
    status: "idle" | "running" | "waiting" | "cancelling" | "blocked"
    text: string
    updatedAt: string
  } | null
  recentEvents: Array<{
    kind: string
    createdAt: string
    prompt: string
    response?: string
    error?: string
  }>
  timeline: Array<{
    source: "runtime" | "journal"
    kind: string
    createdAt: string
    text: string
    prompt?: string
    response?: string
    error?: string
  }>
}

export interface ObserveWorkDetail extends ObserveWorkSummary {
  summary: string
  nextAction: string
  linkedChat: ObserveLinkedChatContext | null
  evidence: ObserveAgentEvidence[]
  degradedReason: string | null
}

export interface CompanyObserveSurface {
  queueSidebar: Array<{
    queueId: WorkItemState | "all"
    label: string
    count: number
  }>
  participantFilters: Array<{ participantId: string; count: number }>
  activeQueueId: WorkItemState | "all"
  workItems: ObserveWorkSummary[]
  selectedWork: ObserveWorkDetail | null
}

export interface CompanyDetailPane {
  surface: TopLevelSurfaceState
  kind: "thread" | "work-item"
  title: string
}

export interface CompanyShell {
  companyId: string
  viewerId: string
  activeSurface: TopLevelSurfaceState
  topLevelTabs: CompanyTopLevelTab[]
  detailPane: CompanyDetailPane | null
  chat: ChatSurface
  work: CompanyWorkSurface
  observe: CompanyObserveSurface
}

export const STARTER_CHANNELS = [
  { slug: "general", title: "general" },
  { slug: "announcements", title: "announcements" },
  { slug: "ops", title: "ops" },
] as const
export const WORK_LANE_ORDER: WorkItemState[] = [
  "inbox",
  "needs_decision",
  "in_progress",
  "blocked",
  "done_recently",
]

export function workItemStateLabel(state: WorkItemState): string {
  switch (state) {
    case "inbox":
      return "Inbox"
    case "needs_decision":
      return "Needs decision"
    case "in_progress":
      return "In progress"
    case "blocked":
      return "Blocked"
    case "done_recently":
      return "Done recently"
  }
}
