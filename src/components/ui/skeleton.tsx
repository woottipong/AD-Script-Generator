import type { CSSProperties } from "react"
import { cn } from "cn"

function Skeleton({
  className,
  variant = "pulse",
  delay,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "pulse" | "shimmer"
  delay?: number
}) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        variant === "shimmer"
          ? "soft-shimmer"
          : "animate-pulse motion-reduce:animate-none",
        "rounded-md bg-muted",
        className
      )}
      style={
        delay !== undefined
          ? ({ "--shimmer-delay": `${delay}ms`, ...style } as CSSProperties)
          : style
      }
      {...props}
    />
  )
}

export { Skeleton }
