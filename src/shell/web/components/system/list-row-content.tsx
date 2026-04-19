import type { ReactNode } from "react"
import { cn } from "../../../../lib/utils.js"

export function ListRowContent(props: {
  leading?: ReactNode
  title: ReactNode
  detail?: ReactNode
  trailing?: ReactNode
  className?: string
  leadingClassName?: string
  contentClassName?: string
  titleClassName?: string
  detailClassName?: string
  compact?: boolean
  leadingAlign?: "start" | "center"
  verticalAlign?: "auto" | "start" | "center"
}) {
  const hasDetail = Boolean(props.detail)
  const verticalAlign =
    props.verticalAlign && props.verticalAlign !== "auto"
      ? props.verticalAlign
      : hasDetail
        ? "start"
        : "center"

  return (
    <span
      data-slot="list-row-content"
      data-vertical-align={verticalAlign}
      className={cn(
        "flex min-w-0 gap-2.5",
        verticalAlign === "center" ? "items-center" : "items-start",
        props.compact && "gap-2",
        props.className,
      )}
    >
      {props.leading ? (
        <span
          data-slot="list-row-leading"
          className={cn(
            "flex shrink-0 items-center justify-center text-muted-foreground",
            props.leadingAlign === "center" || verticalAlign === "center"
              ? "self-center"
              : "mt-0.5",
            props.leadingClassName,
          )}
        >
          {props.leading}
        </span>
      ) : null}

      <span
        data-slot="list-row-body"
        className={cn(
          "min-w-0 flex-1",
          verticalAlign === "center" ? "flex items-center self-center" : "grid gap-0 self-start",
          props.contentClassName,
        )}
      >
        <span
          data-slot="list-row-title"
          className={cn(
            "truncate text-[13px] font-medium tracking-[-0.02em] text-foreground",
            verticalAlign === "center" ? "leading-none" : "leading-[1.18]",
            props.titleClassName,
          )}
        >
          {props.title}
        </span>
        {hasDetail ? (
          <span
            data-slot="list-row-detail"
            className={cn(
              "line-clamp-1 text-[11px] leading-[1.2] tracking-[-0.01em] text-muted-foreground",
              props.detailClassName,
            )}
          >
            {props.detail}
          </span>
        ) : null}
      </span>

      {props.trailing ? (
        <span data-slot="list-row-trailing" className="shrink-0 self-center">
          {props.trailing}
        </span>
      ) : null}
    </span>
  )
}
