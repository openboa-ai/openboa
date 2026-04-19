import { SidebarProvider } from "../../components/ui/sidebar.js"
import { ChatApp } from "./ChatApp.js"

function isDesktopShellUserAgent(): boolean {
  return typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent)
}

export function ChatStandaloneApp() {
  const showDesktopTitlebar = isDesktopShellUserAgent()

  return (
    <SidebarProvider defaultOpen className="dark h-full min-h-0 bg-black text-foreground">
      <div className="box-border flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--shell-ambient)] p-1 md:p-1.5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border bg-[image:var(--shell-gradient)] bg-background shadow-[var(--shadow-card-strong)]">
          {showDesktopTitlebar ? (
            <div
              data-slot="chat-desktop-titlebar"
              className="flex h-9 items-center border-b border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))] px-3 md:px-5 [-webkit-app-region:drag]"
            >
              <div className="ml-[4.75rem] flex items-center gap-2 text-[12px] text-muted-foreground">
                <span
                  className="size-1.5 rounded-full bg-[var(--brand-green)]"
                  aria-hidden="true"
                />
                <span className="tracking-[-0.01em]">openboa chat</span>
              </div>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <ChatApp />
          </div>
        </div>
      </div>
    </SidebarProvider>
  )
}
