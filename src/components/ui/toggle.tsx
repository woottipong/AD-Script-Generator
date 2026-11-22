"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const toggleVariants = cva(
  "group/toggle inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all not-disabled:hover:bg-muted not-disabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-transparent aria-pressed:bg-brand-100 aria-pressed:text-brand-900 aria-pressed:ring-1 aria-pressed:ring-brand-300 aria-pressed:ring-inset not-disabled:aria-pressed:hover:bg-brand-200/70",
        outline:
          "border border-input bg-transparent not-disabled:hover:bg-muted aria-pressed:bg-brand-100 aria-pressed:text-brand-900 aria-pressed:ring-1 aria-pressed:ring-brand-300 aria-pressed:ring-inset not-disabled:aria-pressed:hover:bg-brand-200/70",
        "solid-primary":
          "rounded-[calc(var(--radius)-2px)] bg-transparent text-muted-foreground not-disabled:hover:bg-background/80 not-disabled:hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-xs not-disabled:aria-pressed:hover:bg-primary",
        "solid-muted":
          "rounded-[calc(var(--radius)-2px)] bg-transparent text-muted-foreground not-disabled:hover:bg-background/80 not-disabled:hover:text-foreground aria-pressed:bg-slate-700 aria-pressed:text-white aria-pressed:shadow-xs not-disabled:aria-pressed:hover:bg-slate-700",
        soft:
          "bg-transparent text-muted-foreground aria-pressed:bg-brand-50 aria-pressed:text-brand-700 aria-pressed:ring-1 aria-pressed:ring-brand-200 aria-pressed:ring-inset not-disabled:aria-pressed:hover:bg-brand-100/80",
        segmented:
          "rounded-[calc(var(--radius)-2px)] bg-transparent text-muted-foreground not-disabled:hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs not-disabled:aria-pressed:hover:bg-background",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // Square 32px icon toggles for the video transport (DESIGN › Buttons).
        icon: "size-8",
      },
    },
    compoundVariants: [
      {
        variant: "segmented",
        class: "rounded-[calc(var(--radius)-2px)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      data-size={size}
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
