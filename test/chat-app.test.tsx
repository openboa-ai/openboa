import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SidebarProvider } from "../src/components/ui/sidebar.js"
import { ChatApp } from "../src/shell/web/ChatApp.js"

describe("chat app", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders an unavailable state instead of demo chat data when no runtime gateway is present", () => {
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

    expect(html).toContain("Chat runtime unavailable")
    expect(html).toContain("no longer falls back to demo chat data")
    expect(html).not.toContain("general")
    expect(html).not.toContain("Queues")
    expect(html).not.toContain("Participants")
  })
})
