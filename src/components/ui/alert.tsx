import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        // DESIGN › Semantic States: error surface, ink and border.
        destructive:
          "border-red-200 bg-red-50 text-red-800 *:data-[slot=alert-description]:text-red-800 *:[svg]:text-red-600",
        // DESIGN › Semantic States: amber for warnings that do not block the author.
        warning:
          "border-amber-200 bg-amber-50 text-amber-800 *:data-[slot=alert-description]:text-amber-800 *:[svg]:text-amber-600",
      },
      // DESIGN › Layout: a full-width strip under the navbar, square and divided from the workspace by one hairline.
      placement: {
        inline: "",
        strip: "shrink-0 rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      placement: "inline",
    },
  }
)

function Alert({
  className,
  variant,
  placement,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, placement }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
