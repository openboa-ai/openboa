import { existsSync } from "node:fs"
import { app, BrowserWindow, shell } from "electron"
import { buildDesktopRuntimeSpec } from "./runtime.js"

const runtime = buildDesktopRuntimeSpec(import.meta.url)

function createMainWindow(): BrowserWindow {
  if (!existsSync(runtime.loadTarget.path)) {
    throw new Error(`Missing built shell at ${runtime.loadTarget.path}`)
  }

  const window = new BrowserWindow({
    title: runtime.window.title,
    width: runtime.window.width,
    height: runtime.window.height,
    minWidth: runtime.window.minWidth,
    minHeight: runtime.window.minHeight,
    autoHideMenuBar: runtime.window.autoHideMenuBar,
    backgroundColor: runtime.window.backgroundColor,
    titleBarStyle: runtime.window.titleBarStyle,
    webPreferences: runtime.webPreferences,
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })

  void window.loadFile(runtime.loadTarget.path)
  return window
}

app.whenReady().then(() => {
  createMainWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
