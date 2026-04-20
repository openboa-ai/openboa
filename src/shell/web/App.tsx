import { useEffect, useState } from "react"
import { SidebarProvider } from "../../components/ui/sidebar.js"
import type { TopLevelSurfaceState } from "../../shared/company-model.js"
import { ChatApp } from "./ChatApp.js"
import {
  DEFAULT_COMPANY_ACTIVE_SURFACE,
  useCompanyOperationalShellState,
} from "./company-shell-state.js"
import { SurfaceRail } from "./components/chrome/surface-rail.js"
import { ObserveWorkspace } from "./components/observe/observe-workspace.js"
import { WorkWorkspace } from "./components/work/work-workspace.js"
import { buildCompanyShellFrame, resolveInitialSurface } from "./frame-state.js"

const STORAGE_KEY = "openboa.shell.activeSurface"

export function App() {
  const operationalShell = useCompanyOperationalShellState()
  const [activeSurface, setActiveSurface] = useState<TopLevelSurfaceState>(() =>
    resolveInitialSurface(window.localStorage.getItem(STORAGE_KEY), DEFAULT_COMPANY_ACTIVE_SURFACE),
  )

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, activeSurface)
  }, [activeSurface])

  const operationalFrame =
    activeSurface === "chat" ? null : buildCompanyShellFrame(operationalShell, activeSurface)

  return (
    <SidebarProvider defaultOpen className="dark h-full min-h-0 bg-black text-foreground">
      <div className="box-border flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--shell-ambient)] p-1 md:p-1.5">
        <div className="flex h-full min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-[image:var(--shell-gradient)] bg-background shadow-[var(--shadow-card-strong)]">
          <SurfaceRail
            activeSurface={activeSurface}
            tabs={operationalShell.topLevelTabs}
            onChange={setActiveSurface}
          />

          {activeSurface === "chat" ? <ChatApp /> : null}
          {activeSurface === "work" && operationalFrame ? (
            <WorkWorkspace frame={operationalFrame} surface={operationalShell.work} />
          ) : null}
          {activeSurface === "observe" && operationalFrame ? (
            <ObserveWorkspace frame={operationalFrame} surface={operationalShell.observe} />
          ) : null}
        </div>
      </div>
    </SidebarProvider>
  )
}
