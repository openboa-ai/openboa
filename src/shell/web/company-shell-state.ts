import { useMemo } from "react"
import type { TopLevelSurfaceState } from "../../shared/company-model.js"
import {
  demoDetailPane,
  demoObserveSurface,
  demoTopLevelTabs,
  demoWorkSurface,
} from "./demo-shell.js"
import type { CompanyOperationalShellState } from "./frame-state.js"

export const DEFAULT_COMPANY_ACTIVE_SURFACE: TopLevelSurfaceState = "chat"

export function createDemoOperationalShellState(): CompanyOperationalShellState {
  return {
    topLevelTabs: demoTopLevelTabs,
    detailPane: demoDetailPane,
    work: demoWorkSurface,
    observe: demoObserveSurface,
  }
}

export function useCompanyOperationalShellState(): CompanyOperationalShellState {
  return useMemo(() => createDemoOperationalShellState(), [])
}
