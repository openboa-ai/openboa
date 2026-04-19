import type { ReactNode } from "react"
import { cn } from "../../../../lib/utils.js"
import { shellLabelClass } from "../shared/presentation.js"

export function PaneHeader(props: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  titleClassName?: string
  descriptionClassName?: string
  actionsClassName?: string
}) {
  return (
    <header
      data-slot="pane-header"
      className={cn(
        "flex flex-col gap-2 border-b border-border bg-[image:var(--panel-gradient)] px-3 py-2 sm:flex-row sm:items-start sm:justify-between",
        props.className,
      )}
    >
      <div data-slot="pane-header-body" className={cn("min-w-0 flex-1", props.bodyClassName)}>
        {props.eyebrow ? (
          <div data-slot="pane-header-eyebrow" className={cn(shellLabelClass, "mb-1")}>
            {props.eyebrow}
          </div>
        ) : null}
        <div data-slot="pane-header-title" className={props.titleClassName}>
          {props.title}
        </div>
        {props.description ? (
          <div
            data-slot="pane-header-description"
            className={cn(
              "mt-1 line-clamp-2 text-[13px] leading-[1.35] text-muted-foreground",
              props.descriptionClassName,
            )}
          >
            {props.description}
          </div>
        ) : null}
      </div>

      {props.actions ? (
        <div
          data-slot="pane-header-actions"
          className={cn(
            "flex w-full flex-wrap items-center justify-start gap-1.5 sm:w-auto sm:justify-end",
            props.actionsClassName,
          )}
        >
          {props.actions}
        </div>
      ) : null}
    </header>
  )
}
