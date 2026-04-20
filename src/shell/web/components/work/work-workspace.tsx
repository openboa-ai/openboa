import { Badge } from "../../../../components/ui/badge.js"
import { SidebarInset } from "../../../../components/ui/sidebar.js"
import { cn } from "../../../../lib/utils.js"
import type { CompanyWorkSurface } from "../../../../shared/company-model.js"
import { workItemStateLabel } from "../../../../shared/company-model.js"
import type { CompanyShellFrameState } from "../../frame-state.js"
import { GlobalBar } from "../chrome/global-bar.js"
import { OperationalSidebar } from "../chrome/operational-sidebar.js"
import {
  displayHeadingClass,
  displayTitleClass,
  formatTime,
  panelShellClass,
  shellLabelClass,
  workflowPillClass,
} from "../shared/presentation.js"

export function WorkWorkspace(props: {
  frame: CompanyShellFrameState
  surface: CompanyWorkSurface
}) {
  const spotlight = props.surface.selectedItem ?? props.surface.lanes[0]?.items[0] ?? null
  const activeLane =
    props.surface.lanes.find((lane) => lane.laneId === props.surface.activeQueueId) ??
    props.surface.lanes[0] ??
    null

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <OperationalSidebar frame={props.frame} />

      <SidebarInset className="min-h-0 border-0 bg-background">
        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
          <GlobalBar />
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
            <section className="border-b border-border px-3 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0">
                  <div className={shellLabelClass}>Work</div>
                  <h1 className={cn(displayTitleClass, "mt-1.5 text-[26px] leading-[1.06]")}>
                    Published work queue
                  </h1>
                  <p className="mt-1.5 max-w-[46rem] text-sm text-muted-foreground">
                    Structured queues and calmer decision surfaces live here.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="rounded-[9999px] border-border bg-white/[0.03] text-foreground"
                  >
                    {props.surface.queueSidebar.find((queue) => queue.queueId === "all")?.count ??
                      0}{" "}
                    total
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-[9999px] border-border bg-white/[0.03] text-foreground"
                  >
                    {props.surface.queueSidebar.find((queue) => queue.queueId === "needs_decision")
                      ?.count ?? 0}{" "}
                    need decision
                  </Badge>
                </div>
              </div>
            </section>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_minmax(0,1fr)]">
              <section className="min-h-0 border-b border-border px-1 py-1 lg:border-r lg:border-b-0">
                <div className={cn(panelShellClass, "overflow-hidden")}>
                  <div className="border-b border-border px-3 py-3">
                    <div className={shellLabelClass}>Queues</div>
                  </div>

                  <div>
                    {props.surface.lanes.map((lane, index) => {
                      const selected = lane.laneId === activeLane?.laneId

                      return (
                        <div
                          key={lane.laneId}
                          className={cn(
                            "grid gap-2 px-3 py-3",
                            index > 0 ? "border-t border-border" : "",
                            selected ? "bg-white/[0.03]" : "",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className={shellLabelClass}>Queue</div>
                              <div className={cn(displayHeadingClass, "mt-1 text-[20px]")}>
                                {lane.label}
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn("rounded-[9999px]", workflowPillClass(lane.laneId))}
                            >
                              {lane.items.length}
                            </Badge>
                          </div>
                          <div className="text-[12.5px] leading-[1.55] text-muted-foreground">
                            {lane.items[0]?.title ?? "No work items in this lane yet."}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              <section className="min-h-0 px-1 py-1">
                <div className="grid min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_272px]">
                  <div className={cn(panelShellClass, "overflow-hidden")}>
                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-3">
                      <div>
                        <div className={shellLabelClass}>Spotlight</div>
                        <div className={cn(displayHeadingClass, "mt-1 text-[24px]")}>
                          {spotlight?.title ?? "No selected item"}
                        </div>
                      </div>
                      {spotlight ? (
                        <Badge
                          variant="outline"
                          className={cn("rounded-[9999px]", workflowPillClass(spotlight.state))}
                        >
                          {workItemStateLabel(spotlight.state)}
                        </Badge>
                      ) : null}
                    </div>

                    {spotlight ? (
                      <div className="grid gap-0">
                        <div className="grid gap-3 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className={shellLabelClass}>{spotlight.itemType}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatTime(spotlight.updatedAt)}
                            </span>
                          </div>
                          <p className="max-w-[48rem] text-[14px] leading-[1.7] text-muted-foreground">
                            {spotlight.summary}
                          </p>
                        </div>

                        <div className="grid gap-0 border-t border-border xl:grid-cols-[minmax(0,1fr)_280px]">
                          <div className="grid gap-0">
                            <div className="grid gap-2 px-3 py-3">
                              <div className={shellLabelClass}>Latest update</div>
                              <p className="text-[15px] leading-[1.7] text-foreground">
                                {spotlight.latestUpdate}
                              </p>
                            </div>
                            <div className="grid gap-2 border-t border-border px-3 py-3">
                              <div className={shellLabelClass}>Next action</div>
                              <p className="text-[14px] leading-[1.65] text-muted-foreground">
                                {spotlight.nextAction}
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-0 border-t border-border xl:border-t-0 xl:border-l">
                            <div className="grid gap-2 px-3 py-3">
                              <div className={shellLabelClass}>Owner</div>
                              <div className="text-[14px] font-semibold text-foreground">
                                {spotlight.ownerId ?? "Unassigned"}
                              </div>
                            </div>
                            <div className="grid gap-2 border-t border-border px-3 py-3">
                              <div className={shellLabelClass}>Participants</div>
                              <div className="text-[13px] leading-[1.6] text-muted-foreground">
                                {spotlight.participantIds.join(", ")}
                              </div>
                            </div>
                            <div className="grid gap-2 border-t border-border px-3 py-3">
                              <div className={shellLabelClass}>Source</div>
                              <div className="text-[13px] leading-[1.6] text-muted-foreground">
                                #{spotlight.sourceConversationId}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        No work item selected.
                      </div>
                    )}
                  </div>

                  <aside className={cn(panelShellClass, "overflow-hidden")}>
                    <div className="border-b border-border px-3 py-3">
                      <div className={shellLabelClass}>Decision</div>
                    </div>
                    {spotlight ? (
                      <div className="grid gap-0">
                        <div className="grid gap-2 px-3 py-3">
                          <div className={shellLabelClass}>Needs</div>
                          <p className="text-[14px] leading-[1.65] text-foreground">
                            {spotlight.nextAction}
                          </p>
                        </div>
                        <div className="grid gap-2 border-t border-border px-3 py-3">
                          <div className={shellLabelClass}>Approval</div>
                          <div className="text-[13px] leading-[1.6] text-muted-foreground">
                            {spotlight.approvalRequired
                              ? "Required before landing"
                              : "Not required"}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </aside>
                </div>
              </section>
            </div>
          </div>
        </div>
      </SidebarInset>
    </div>
  )
}
