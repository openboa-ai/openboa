import type { ReactNode } from "react"
import { cn } from "../../../../lib/utils.js"

export function ComposerShell(props: {
  editor: ReactNode
  toolbar: ReactNode
  action?: ReactNode
  overlay?: ReactNode
  variant?: "default" | "embedded"
  className?: string
  editorClassName?: string
  toolbarClassName?: string
}) {
  return (
    <div
      data-slot="composer-shell"
      className={cn(
        "relative border border-border bg-[var(--surface-1)]",
        props.variant === "embedded"
          ? "rounded-none border-x-0 border-b-0 bg-transparent"
          : "rounded-[var(--radius-control)]",
        props.className,
      )}
    >
      {props.overlay ? (
        <div
          data-slot="composer-overlay"
          className="pointer-events-none absolute inset-x-3 bottom-[calc(100%+0.5rem)] z-20"
        >
          <div className="pointer-events-auto">{props.overlay}</div>
        </div>
      ) : null}
      <div data-slot="composer-editor" className={cn("px-3 py-1.25", props.editorClassName)}>
        {props.editor}
      </div>
      <div
        data-slot="composer-toolbar"
        className={cn(
          "flex flex-wrap items-start gap-1.25 border-t border-border px-2.5 py-1 sm:items-center",
          props.toolbarClassName,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.25">{props.toolbar}</div>
        {props.action ? (
          <div className="flex w-full justify-end pt-1 sm:w-auto sm:pt-0">{props.action}</div>
        ) : null}
      </div>
    </div>
  )
}
