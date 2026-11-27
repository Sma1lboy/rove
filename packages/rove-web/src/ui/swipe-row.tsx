import { type ReactNode, useRef, useState } from "react"
import { haptic } from "./haptic.ts"

/** The screen's left edge belongs to the system's back swipe: a touch starting this close to it never moves a row. */
const EDGE_PX = 24
const SLOP_PX = 10
/** Let go this far out and the action runs. */
const COMMIT_PX = 72

const TONE = {
  accent: "bg-accent text-paper",
  danger: "bg-error text-paper",
  neutral: "bg-line-active text-ink",
} as const

const GROUND = { surface: "bg-surface", paper: "bg-paper" } as const

export interface SwipeAction {
  readonly label: string
  readonly tone: keyof typeof TONE
  readonly run: () => void
}

/**
 * A list row a finger slides sideways, iOS's swipe actions: dragged left it uncovers `left` at its right end, dragged
 * right `right` at its left end; let go past the mark and the action runs, else the row springs back. A vertical drag
 * stays a scroll, and the tap that ends a swipe is swallowed so it does not open the row.
 */
export function SwipeRow(props: {
  left?: SwipeAction
  right?: SwipeAction
  /** What the row sits on, so the moving row hides the action under it. */
  ground?: keyof typeof GROUND
  children: ReactNode
}) {
  const [dx, setDx] = useState(0)
  const drag = useRef<{ x: number; y: number; on: boolean } | null>(null)
  const swallow = useRef(false)
  const action = dx < 0 ? props.left : dx > 0 ? props.right : undefined
  const clamp = (x: number) =>
    Math.max(props.left ? -window.innerWidth : 0, Math.min(props.right ? window.innerWidth : 0, x))
  return (
    <div
      className="relative overflow-hidden touch-pan-y"
      onTouchStart={(e) => {
        const touch = e.touches[0]
        drag.current =
          touch && e.touches.length === 1 && touch.clientX > EDGE_PX
            ? { x: touch.clientX, y: touch.clientY, on: false }
            : null
      }}
      onTouchMove={(e) => {
        const start = drag.current
        const touch = e.touches[0]
        if (!start || !touch) return
        const x = touch.clientX - start.x
        if (!start.on) {
          const y = touch.clientY - start.y
          if (Math.hypot(x, y) < SLOP_PX) return
          if (Math.abs(x) <= Math.abs(y)) {
            drag.current = null
            return
          }
          start.on = true
        }
        setDx(clamp(x))
      }}
      onTouchEnd={() => {
        const was = drag.current
        drag.current = null
        if (!was?.on) return
        swallow.current = true
        if (action && Math.abs(dx) >= COMMIT_PX) {
          haptic("medium")
          action.run()
        }
        setDx(0)
      }}
      onTouchCancel={() => {
        drag.current = null
        setDx(0)
      }}
      onClickCapture={(e) => {
        if (!swallow.current) return
        swallow.current = false
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {action && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center px-5 font-sans text-body font-semibold ${dx < 0 ? "justify-end" : "justify-start"} ${TONE[action.tone]}`}
        >
          {action.label}
        </div>
      )}
      <div
        className={`relative ${dx === 0 ? "" : GROUND[props.ground ?? "surface"]} ${dx === 0 ? "transition-transform duration-200 ease-snap motion-reduce:transition-none" : ""}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      >
        {props.children}
      </div>
    </div>
  )
}
