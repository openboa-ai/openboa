import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatStandaloneApp } from "../src/shell/web/ChatStandaloneApp.js"

describe("chat standalone app", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the chat-only shell without the mixed surface rail", () => {
    const storage = new Map<string, string>()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
      },
    })

    const html = renderToStaticMarkup(<ChatStandaloneApp />)

    expect(html).toContain("Chat runtime unavailable")
    expect(html).toContain("h-full min-h-0")
    expect(html).not.toContain("general")
    expect(html).not.toContain(">Work<")
    expect(html).not.toContain(">Observe<")
  })

  it("renders a dedicated desktop titlebar gutter inside Electron", () => {
    const storage = new Map<string, string>()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
      },
    })
    vi.stubGlobal("navigator", { userAgent: "Electron/35.0.0" })

    const html = renderToStaticMarkup(<ChatStandaloneApp />)

    expect(html).toContain('data-slot="chat-desktop-titlebar"')
    expect(html).toContain("openboa chat")
    expect(html).toContain("-webkit-app-region:drag")
  })
})
