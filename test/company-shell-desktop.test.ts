import { describe, expect, it } from "vitest"
import {
  buildDesktopRuntimeSpec,
  resolveDesktopChatIndexPath,
} from "../src/shell/desktop/runtime.js"

describe("desktop runtime", () => {
  it("resolves the desktop host to the built standalone chat artifact", () => {
    const shellIndexPath = resolveDesktopChatIndexPath(
      "file:///Users/sangjoon/openboa/dist/shell/desktop/main.js",
    )

    expect(shellIndexPath).toBe("/Users/sangjoon/openboa/dist/web/chat/index.html")
  })

  it("uses file-backed loading and secure BrowserWindow defaults", () => {
    const runtime = buildDesktopRuntimeSpec(
      "file:///Users/sangjoon/openboa/dist/shell/desktop/main.js",
    )

    expect(runtime.loadTarget).toEqual({
      kind: "file",
      path: "/Users/sangjoon/openboa/dist/web/chat/index.html",
    })
    expect(runtime.window).toEqual({
      title: "openboa",
      width: 1440,
      height: 960,
      minWidth: 720,
      minHeight: 560,
      autoHideMenuBar: true,
      backgroundColor: "#0b1020",
      titleBarStyle: "hiddenInset",
    })
    expect(runtime.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    })
  })
})
