import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import type * as React from "react"

import { cn } from "../../lib/utils.js"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border text-[14px] font-medium tracking-[-0.01em] transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-[var(--radius-control)] border-white/10 bg-primary text-primary-foreground shadow-[var(--shadow-button-solid)] hover:bg-white/92",
        destructive:
          "rounded-[var(--radius-control)] border-destructive/60 bg-destructive text-white shadow-[var(--shadow-button-solid)] hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "rounded-[var(--radius-control)] border-border bg-[image:var(--panel-gradient)] text-foreground shadow-[var(--shadow-ring-soft)] hover:bg-accent hover:text-accent-foreground",
        secondary:
          "rounded-[var(--radius-control)] border-border bg-secondary text-secondary-foreground shadow-[var(--shadow-ring-soft)] hover:bg-white/[0.06]",
        ghost:
          "rounded-[var(--radius-control)] border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "border-transparent bg-transparent p-0 text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--control-xl)] px-3.5 py-2 has-[>svg]:px-3",
        xs: "h-[var(--control-sm)] gap-1 rounded-[var(--radius-small)] px-2 text-[12px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--control-lg)] gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-[calc(var(--control-xl)+0.25rem)] rounded-[var(--radius-card)] px-4.5 has-[>svg]:px-4",
        icon: "size-[var(--control-xl)] rounded-[var(--radius-control)]",
        "icon-xs":
          "size-[var(--control-sm)] rounded-[var(--radius-small)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--control-lg)] rounded-[var(--radius-control)]",
        "icon-lg": "size-[calc(var(--control-xl)+0.25rem)] rounded-[var(--radius-card)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
