import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const textareaVariants = cva(
  "flex w-full rounded-lg border border-input bg-background transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-brand-100 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "field-sizing-content min-h-16 px-2.5 py-2 text-base disabled:bg-input/50 disabled:opacity-50 md:text-sm",
        script:
          "field-sizing-fixed min-h-0 resize-none px-3 py-2.5 font-script text-[length:var(--text-script)] leading-[var(--text-script--line-height)] font-normal tracking-normal text-foreground disabled:border-border disabled:bg-muted/80 disabled:text-muted-foreground disabled:opacity-100",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      data-variant={variant}
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Textarea, textareaVariants }
