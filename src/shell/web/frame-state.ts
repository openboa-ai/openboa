import type {
  CompanyDetailPane,
  CompanyObserveSurface,
  CompanyTopLevelTab,
  CompanyWorkSurface,
  TopLevelSurfaceState,
} from "../../shared/company-model.js"

export interface CompanyShellSidebarItem {
  id: string
  label: string
  detail: string | null
  badgeCount: number
}

export interface CompanyShellSidebarSection {
  id: string
  label: string
  items: CompanyShellSidebarItem[]
}

export interface CompanyShellFrameState {
  activeSurface: CompanyOperationalSurfaceState
  topLevelTabs: CompanyTopLevelTab[]
  sidebarSections: CompanyShellSidebarSection[]
  detailPane: CompanyDetailPane | null
}

export type CompanyOperationalSurfaceState = Exclude<TopLevelSurfaceState, "chat">

export interface CompanyOperationalShellState {
  topLevelTabs: CompanyTopLevelTab[]
  detailPane: CompanyDetailPane | null
  work: CompanyWorkSurface
  observe: CompanyObserveSurface
}

const VALID_SURFACES = new Set<TopLevelSurfaceState>(["chat", "work", "observe"])

export function resolveInitialSurface(
  persistedSurface: string | null | undefined,
  fallbackSurface: TopLevelSurfaceState = "chat",
): TopLevelSurfaceState {
  if (persistedSurface && VALID_SURFACES.has(persistedSurface as TopLevelSurfaceState)) {
    return persistedSurface as TopLevelSurfaceState
  }
  return fallbackSurface
}

export function buildCompanyShellFrame(
  shell: CompanyOperationalShellState,
  activeSurface: CompanyOperationalSurfaceState,
): CompanyShellFrameState {
  const detailPane = shell.detailPane?.surface === activeSurface ? shell.detailPane : null

  switch (activeSurface) {
    case "work":
      return {
        activeSurface,
        topLevelTabs: shell.topLevelTabs,
        detailPane,
        sidebarSections: [
          {
            id: "queues",
            label: "Queues",
            items: shell.work.queueSidebar.map((queue) => ({
              id: queue.queueId,
              label: queue.label,
              detail: null,
              badgeCount: queue.count,
            })),
          },
          {
            id: "channels",
            label: "Channels",
            items: shell.work.channelFilters.map((channel) => ({
              id: channel.conversationId,
              label: channel.label,
              detail: null,
              badgeCount: channel.count,
            })),
          },
          {
            id: "participants",
            label: "Participants",
            items: shell.work.participantFilters.map((participant) => ({
              id: participant.participantId,
              label: participant.participantId,
              detail: null,
              badgeCount: participant.count,
            })),
          },
        ],
      }
    case "observe":
      return {
        activeSurface,
        topLevelTabs: shell.topLevelTabs,
        detailPane,
        sidebarSections: [
          {
            id: "queues",
            label: "Queues",
            items: shell.observe.queueSidebar.map((queue) => ({
              id: queue.queueId,
              label: queue.label,
              detail: null,
              badgeCount: queue.count,
            })),
          },
          {
            id: "participants",
            label: "Participants",
            items: shell.observe.participantFilters.map((participant) => ({
              id: participant.participantId,
              label: participant.participantId,
              detail: null,
              badgeCount: participant.count,
            })),
          },
        ],
      }
  }
}
