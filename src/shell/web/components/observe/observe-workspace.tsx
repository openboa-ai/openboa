import { Badge } from "../../../../components/ui/badge.js"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js"
import { SidebarInset } from "../../../../components/ui/sidebar.js"
import { cn } from "../../../../lib/utils.js"
import type { CompanyObserveSurface } from "../../../../shared/company-model.js"
import { workItemStateLabel } from "../../../../shared/company-model.js"
import type { CompanyShellFrameState } from "../../frame-state.js"
import { GlobalBar } from "../chrome/global-bar.js"
import { OperationalSidebar } from "../chrome/operational-sidebar.js"
import {
  displayTitleClass,
  formatCount,
  panelCardClass,
  panelShellClass,
  shellLabelClass,
  uiCodeClass,
  workflowPillClass,
} from "../shared/presentation.js"

export function ObserveWorkspace(props: {
  frame: CompanyShellFrameState
  surface: CompanyObserveSurface
}) {
  const spotlight = props.surface.selectedWork ?? props.surface.workItems[0] ?? null

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <OperationalSidebar frame={props.frame} />

      <SidebarInset className="min-h-0 border-0 bg-background">
        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
          <GlobalBar />
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_312px]">
            <section className="min-h-0 border-b border-border px-1 py-1 lg:border-r lg:border-b-0">
              <div className={cn(panelShellClass, "overflow-hidden")}>
                <div className="border-b border-border px-4 py-4">
                  <div className={shellLabelClass}>Observe</div>
                  <h1 className={cn(displayTitleClass, "mt-2 text-[32px] leading-[1.05]")}>
                    Execution evidence
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Proof, refs, and execution context live here.
                  </p>
                </div>

                <div>
                  {props.surface.workItems.map((item, index) => (
                    <div
                      key={item.workItemId}
                      className={cn(
                        "grid gap-2 px-4 py-4",
                        index > 0 ? "border-t border-border" : "",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={shellLabelClass}>{item.itemType}</span>
                        <Badge
                          variant="outline"
                          className={cn("rounded-[9999px]", workflowPillClass(item.state))}
                        >
                          {workItemStateLabel(item.state)}
                        </Badge>
                      </div>
                      <div className="text-[13.5px] font-semibold text-foreground">
                        {item.title}
                      </div>
                      <p className="text-[13px] leading-[1.6] text-muted-foreground">
                        {item.latestUpdate}
                      </p>
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{formatCount(item.executionRefs.length, "execution ref")}</span>
                        <span>{item.participantIds.join(", ")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <aside className="min-h-0 bg-card/60 px-1 py-1">
              <Card className={cn(panelCardClass, "gap-2 rounded-[var(--radius-panel)] py-2.5")}>
                <CardHeader>
                  <CardDescription className={shellLabelClass}>Focus</CardDescription>
                  <CardTitle className={cn(displayTitleClass, "text-[24px] leading-[1.08]")}>
                    {spotlight?.title ?? "Focus"}
                  </CardTitle>
                  {spotlight ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Badge
                        variant="outline"
                        className={cn("rounded-[9999px]", workflowPillClass(spotlight.state))}
                      >
                        {workItemStateLabel(spotlight.state)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {spotlight.subtaskCount} subtasks
                      </span>
                    </div>
                  ) : null}
                </CardHeader>
                {spotlight ? (
                  <CardContent className="grid gap-1.5">
                    {spotlight.executionRefs.map((ref) => (
                      <div
                        key={ref.taskId}
                        className="grid gap-0 border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.006))]"
                      >
                        <div className="flex items-start justify-between gap-3 px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2 rounded-full bg-[var(--workflow-green)]"
                              aria-hidden="true"
                            />
                            <div className="text-[13.5px] font-semibold text-foreground">
                              {ref.agentId}
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-[9999px] border-[color:var(--workflow-green-line)] bg-[color:var(--workflow-green-soft)] text-[color:var(--workflow-green)]"
                            >
                              Running
                            </Badge>
                          </div>
                          <span className={cn(uiCodeClass, "text-[11px] text-muted-foreground")}>
                            {ref.sessionId}
                          </span>
                        </div>
                        <div className="grid gap-1 border-t border-border px-3 py-3">
                          <div className={cn(uiCodeClass, "text-[11px] text-muted-foreground")}>
                            task
                          </div>
                          <div className="[font-family:var(--font-mono)] text-[12px] font-medium tracking-[-0.01em] text-foreground">
                            {ref.taskId}
                          </div>
                        </div>
                        <div className="grid gap-1 border-t border-border px-3 py-3">
                          <div className={cn(uiCodeClass, "text-[11px] text-muted-foreground")}>
                            thread context
                          </div>
                          <div className="[font-family:var(--font-mono)] text-[12px] font-medium tracking-[-0.01em] text-muted-foreground">
                            {ref.threadId ?? "main transcript"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            </aside>
          </div>
        </div>
      </SidebarInset>
    </div>
  )
}
