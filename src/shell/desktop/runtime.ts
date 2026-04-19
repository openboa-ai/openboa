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
  sandbox: boolean
  spellcheck: boolean
}

export interface DesktopRuntimeSpec {
  loadTarget: DesktopLoadTarget
  window: DesktopWindowSpec
  webPreferences: DesktopWebPreferencesSpec
}

export function resolveDesktopChatIndexPath(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../web/chat/index.html")
}

export function buildDesktopRuntimeSpec(moduleUrl: string): DesktopRuntimeSpec {
  return {
    loadTarget: {
      kind: "file",
      path: resolveDesktopChatIndexPath(moduleUrl),
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
      sandbox: true,
      spellcheck: true,
    },
  }
}
