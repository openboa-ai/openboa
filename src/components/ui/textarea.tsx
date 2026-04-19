import type * as React from "react"

import { cn } from "../../lib/utils.js"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-[5rem] w-full rounded-[var(--radius-control)] border border-input bg-input px-3.5 py-2.5 text-[14px] leading-[1.5] shadow-[var(--shadow-ring-soft)] transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-white/16 focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
