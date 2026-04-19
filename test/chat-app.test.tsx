import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SidebarProvider } from "../src/components/ui/sidebar.js"
import { ChatApp } from "../src/shell/web/ChatApp.js"

describe("chat app", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the standalone chat surface without operational shell chrome", () => {
    const storage = new Map<string, string>()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
      },
    })

    const html = renderToStaticMarkup(
      <SidebarProvider>
        <ChatApp />
      </SidebarProvider>,
    )

    expect(html).toContain("openboa")
    expect(html).toContain("general")
    expect(html).not.toContain("Queues")
    expect(html).not.toContain("Participants")
  })
})
