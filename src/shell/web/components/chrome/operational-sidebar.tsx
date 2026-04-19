import type { CSSProperties } from "react"
import { ScrollArea } from "../../../../components/ui/scroll-area.js"
import { Sidebar, SidebarContent, SidebarHeader } from "../../../../components/ui/sidebar.js"
import { cn } from "../../../../lib/utils.js"
import type { CompanyShellFrameState } from "../../frame-state.js"
import { shellLabelClass, uiTitleClass } from "../shared/presentation.js"
import { SidebarSectionList } from "./sidebar-section-list.js"

export function OperationalSidebar(props: { frame: CompanyShellFrameState }) {
  return (
    <Sidebar
      collapsible="none"
      className="hidden md:flex md:border-r md:border-border"
      style={{ "--sidebar-width": "16.5rem" } as CSSProperties}
    >
      <SidebarHeader className="gap-2 border-b border-border bg-[image:var(--panel-gradient)] px-2 py-2">
        <div className="grid gap-1">
          <span className={shellLabelClass}>Company</span>
          <span className={cn(uiTitleClass, "text-[24px] leading-none")}>Operational views</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="p-0">
        <ScrollArea className="h-full">
          <div className="py-1">
            {props.frame.sidebarSections.map((section) => (
              <SidebarSectionList key={section.id} section={section} />
            ))}
          </div>
        </ScrollArea>
      </SidebarContent>
    </Sidebar>
  )
}
