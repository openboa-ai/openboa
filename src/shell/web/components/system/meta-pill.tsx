import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "../../../../components/ui/badge.js"
import { cn } from "../../../../lib/utils.js"

export function MetaPill(props: {
  value: ReactNode
  icon?: LucideIcon
  leading?: ReactNode
  size?: "xs" | "sm" | "md"
  className?: string
}) {
  const Icon = props.icon

  return (
    <Badge
      variant="outline"
      size={props.size ?? "sm"}
      className={cn(
        "min-w-[2rem] justify-center gap-1.25 rounded-full border-border bg-[var(--surface-2)] px-2 text-foreground shadow-none",
        props.className,
      )}
    >
      {props.leading ?? (Icon ? <Icon className="size-3.5" strokeWidth={2.1} /> : null)}
      {props.value}
    </Badge>
  )
}
