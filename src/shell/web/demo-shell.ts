import type {
  CompanyDetailPane,
  CompanyObserveSurface,
  CompanyShell,
  CompanyTopLevelTab,
  CompanyWorkSurface,
} from "../../shared/company-model.js"
import { chatSeedSurface } from "./chat-seed.js"

export const demoWorkSurface: CompanyWorkSurface = {
  queueSidebar: [
    { queueId: "all", label: "All", count: 4 },
    { queueId: "needs_decision", label: "Needs decision", count: 1 },
    { queueId: "in_progress", label: "In progress", count: 2 },
    { queueId: "blocked", label: "Blocked", count: 1 },
  ],
  channelFilters: [
    { conversationId: "general", label: "general", count: 3 },
    { conversationId: "ops", label: "ops", count: 1 },
  ],
  participantFilters: [
    { participantId: "alpha", count: 2 },
    { participantId: "beta", count: 1 },
  ],
  activeQueueId: "all",
  lanes: [
    {
      laneId: "needs_decision",
      label: "Needs decision",
      items: [
        {
          workItemId: "work-quality-pass",
          itemType: "approval",
          state: "needs_decision",
          title: "Review quality-pass shipment",
          summary: "Check the final release checklist and sign off on risk notes.",
          ownerId: "founder",
          participantIds: ["founder", "alpha"],
          sourceConversationId: "general",
          sourceThreadId: "general-root",
          sourceMessageId: "general-root",
          latestUpdate: "Alpha synthesized the last review comments.",
          nextAction: "Approve or ask for one more pass.",
          updatedAt: "2026-04-06T09:25:00.000Z",
          blockedReason: null,
          approvalRequired: true,
        },
      ],
    },
  ],
  selectedItem: null,
}

export const demoObserveSurface: CompanyObserveSurface = {
  queueSidebar: [
    { queueId: "all", label: "All", count: 2 },
    { queueId: "in_progress", label: "In progress", count: 1 },
    { queueId: "blocked", label: "Blocked", count: 1 },
  ],
  participantFilters: [
    { participantId: "alpha", count: 1 },
    { participantId: "beta", count: 1 },
  ],
  activeQueueId: "all",
  workItems: [
    {
      workItemId: "work-quality-pass",
      title: "Review quality-pass shipment",
      itemType: "approval",
      state: "needs_decision",
      ownerId: "founder",
      participantIds: ["founder", "alpha"],
      latestUpdate: "Alpha is synthesizing release risk.",
      updatedAt: "2026-04-06T09:25:00.000Z",
      sourceConversationId: "general",
      sourceThreadId: "general-root",
      sourceMessageId: "general-root",
      executionRefs: [
        {
          agentId: "alpha",
          taskId: "task-1",
          sessionId: "session-1",
          conversationId: "general",
          threadId: "general-root",
        },
      ],
      subtaskCount: 2,
      blockedCount: 0,
    },
  ],
  selectedWork: null,
}

export const demoTopLevelTabs: CompanyTopLevelTab[] = [
  { surface: "chat", label: "Chat", badgeCount: 4 },
  { surface: "work", label: "Work", badgeCount: 2 },
  { surface: "observe", label: "Observe", badgeCount: 1 },
]

export const demoDetailPane: CompanyDetailPane = {
  surface: "chat",
  kind: "thread",
  title: "Quality-pass thread",
}

export const demoCompanyShell: CompanyShell = {
  companyId: "demo-company",
  viewerId: "founder",
  activeSurface: "chat",
  topLevelTabs: demoTopLevelTabs,
  detailPane: demoDetailPane,
  chat: chatSeedSurface,
  work: demoWorkSurface,
  observe: demoObserveSurface,
}
