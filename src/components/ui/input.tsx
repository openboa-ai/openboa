import type * as React from "react"

import { cn } from "../../lib/utils.js"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--control-xl)] w-full min-w-0 rounded-[var(--radius-control)] border border-input bg-input px-3.5 py-2 text-[14px] shadow-[var(--shadow-ring-soft)] transition-[color,background-color,border-color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-[var(--control-lg)] file:border-0 file:bg-transparent file:text-[14px] file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-white/16 focus-visible:ring-2 focus-visible:ring-ring/70",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
