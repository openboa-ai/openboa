import { Badge } from "../../../../components/ui/badge.js"
import { cn } from "../../../../lib/utils.js"

export function CountBadge(props: {
  value: number | string
  size?: "xs" | "sm"
  tone?: "default" | "attention" | "muted"
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      size={props.size ?? "sm"}
      className={cn(
        "justify-center rounded-full border-border bg-[var(--surface-1)] font-medium tabular-nums text-foreground",
        props.size === "xs" && "min-w-[1.4rem]",
        (props.size === "sm" || props.size == null) && "min-w-[1.55rem]",
        props.tone === "attention" &&
          "border-[color:var(--workflow-green-line)] bg-[var(--brand-green)] text-[var(--brand-green-foreground)]",
        props.tone === "muted" && "border-border/70 bg-white/[0.03] text-muted-foreground/88",
        props.className,
      )}
    >
      {props.value}
    </Badge>
  )
}
