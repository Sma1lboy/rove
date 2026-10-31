import type { HTMLAttributes } from "react"
import { cn } from "./cn.ts"

/**
 * A column's resize handle: a 6px hit strip inside the column on the given edge, its hairline on the edge itself,
 * so every grip sits the same distance from its neighbour and nothing reaches past a column that clips.
 * The hairline shows after a beat of hover (passing over doesn't flash it) and at once while dragging.
 */
export function ResizeGrip({ edge, className, ...rest }: { edge: "left" | "right" } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-grip=""
      className={cn(
        "absolute inset-y-0 z-5 w-1.5 cursor-col-resize touch-none",
        "after:absolute after:inset-y-0 after:w-0.5 after:bg-line-active after:opacity-0 after:transition-opacity after:duration-120",
        "hover:after:opacity-100 hover:after:delay-250 active:after:bg-accent active:after:opacity-100 active:after:delay-0",
        edge === "right" ? "right-0 after:right-0" : "left-0 after:left-0",
        className,
      )}
      {...rest}
    />
  )
}
