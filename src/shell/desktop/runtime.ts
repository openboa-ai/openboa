import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface DesktopLoadTarget {
  kind: "file"
  path: string
}

export interface DesktopWindowSpec {
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  autoHideMenuBar: boolean
  backgroundColor: string
  titleBarStyle: "hiddenInset"
}

export interface DesktopWebPreferencesSpec {
  contextIsolation: boolean
  nodeIntegration: boolean
  preload: string
  sandbox: boolean
  spellcheck: boolean
}

export interface DesktopRuntimeSpec {
  loadTarget: DesktopLoadTarget
  window: DesktopWindowSpec
  webPreferences: DesktopWebPreferencesSpec
}

export function resolveDesktopAppIndexPath(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../web/index.html")
}

export function resolveDesktopPreloadPath(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "./preload.cjs")
}

export function buildDesktopRuntimeSpec(moduleUrl: string): DesktopRuntimeSpec {
  return {
    loadTarget: {
      kind: "file",
      path: resolveDesktopAppIndexPath(moduleUrl),
    },
    window: {
      title: "openboa",
      width: 1440,
      height: 960,
      minWidth: 720,
      minHeight: 560,
      autoHideMenuBar: true,
      backgroundColor: "#0b1020",
      titleBarStyle: "hiddenInset",
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolveDesktopPreloadPath(moduleUrl),
      sandbox: true,
      spellcheck: true,
    },
  }
}
