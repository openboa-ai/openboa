import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import type * as React from "react"

import { cn } from "../../lib/utils.js"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-pill)] border font-medium tracking-[-0.01em] whitespace-nowrap transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/70 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-white/10 bg-primary text-primary-foreground shadow-[var(--shadow-ring)] [a&]:hover:bg-primary/92",
        secondary:
          "border-border bg-secondary text-secondary-foreground shadow-[var(--shadow-ring-soft)] [a&]:hover:bg-white/[0.06]",
        destructive:
          "border-destructive/50 bg-destructive text-white focus-visible:ring-destructive/20 [a&]:hover:bg-destructive/90",
        outline:
          "border-border bg-white/[0.03] text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost:
          "border-transparent bg-transparent text-muted-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "border-transparent bg-transparent text-foreground underline-offset-4 [a&]:hover:underline",
      },
      size: {
        xs: "h-[var(--control-xs)] min-w-[var(--control-xs)] px-1 text-[9px] leading-none",
        sm: "h-[var(--control-sm)] min-w-[var(--control-sm)] px-1.5 text-[10px] leading-none",
        md: "h-[var(--control-lg)] px-2 py-0.5 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
)

function Badge({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
