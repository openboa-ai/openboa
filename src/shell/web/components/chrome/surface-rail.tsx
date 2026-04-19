import { Avatar, AvatarFallback } from "../../../../components/ui/avatar.js"
import { Button } from "../../../../components/ui/button.js"
import { cn } from "../../../../lib/utils.js"
import type { CompanyTopLevelTab, TopLevelSurfaceState } from "../../../../shared/company-model.js"
import { surfaceIcon } from "../shared/presentation.js"
import { CountBadge } from "../system/count-badge.js"

export function SurfaceRail(props: {
  activeSurface: TopLevelSurfaceState
  tabs: CompanyTopLevelTab[]
  onChange: (surface: TopLevelSurfaceState) => void
}) {
  return (
    <div className="hidden w-[72px] shrink-0 flex-col border-r border-border bg-[var(--surface-0)] sm:flex">
      <div className="flex h-full flex-col gap-2 px-1.5 py-2">
        <Button
          variant="outline"
          className="h-10 rounded-[var(--radius-control)] border-border bg-[var(--surface-2)] px-0 text-[18px] font-semibold tracking-[-0.08em] text-foreground shadow-none [font-family:var(--font-display)]"
        >
          ob
        </Button>

        <div className="grid gap-1 pt-1">
          {props.tabs.map((tab) => {
            const Icon = surfaceIcon(tab.surface)
            const active = props.activeSurface === tab.surface

            return (
              <Button
                key={tab.surface}
                variant="ghost"
                className={cn(
                  "h-auto min-h-[54px] rounded-[var(--radius-control)] border border-transparent bg-transparent px-0 py-1.5 text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                  active && "border-border/70 bg-[var(--surface-2)] text-foreground",
                )}
                aria-label={tab.label}
                onClick={() => props.onChange(tab.surface)}
              >
                <span className="flex flex-col items-center justify-center gap-1">
                  <Icon className="size-[18px]" strokeWidth={2.1} />
                  {tab.badgeCount > 0 ? (
                    <CountBadge
                      value={tab.badgeCount}
                      size="xs"
                      className="h-[18px] min-w-[18px] border-border/80 bg-[var(--surface-1)] px-1 text-[9px] shadow-none"
                    />
                  ) : (
                    <span className="h-[18px]" aria-hidden="true" />
                  )}
                </span>
              </Button>
            )
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-2 pt-1">
          <Avatar className="size-7 border border-border/70 bg-[var(--surface-2)]">
            <AvatarFallback className="bg-transparent text-xs font-semibold text-foreground">
              FO
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </div>
  )
}
