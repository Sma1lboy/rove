/**
 * A row's status as 3×3 dots in its tone, after ELYTerminal's session orb (MIT,
 * `src/sessions/orb.rs`): work ripples out from the centre, a wait stays lit and dips,
 * a settled state draws its shape dot by dot and holds. All motion is CSS (`status-dots.css`).
 */

import { type CSSProperties, useState } from "react"
import type { RowStatus } from "rove-bridge/protocol"
import { type DotLook, statusMark } from "./rail-glyphs.ts"
import "./status-dots.css"

/** A settled look's dots, row by row from the top left, in the order they light. */
const SHAPE: Partial<Record<DotLook, readonly number[]>> = {
  error: [0, 4, 8, 2, 6],
  done: [3, 7, 5, 2],
  idle: [1, 2, 5, 8, 7, 6, 3, 0],
}

/** One ripple and one round of dips, so every mark on the page moves in step. */
const PERIOD: Partial<Record<DotLook, number>> = { working: 1200, waiting: 1600 }

export function StatusDots({ status }: { status: RowStatus | undefined }) {
  const { look, tone } = statusMark(status)
  return <Dots key={look} look={look} tone={tone} />
}

function Dots({ look, tone }: { look: DotLook; tone: string }) {
  // Read once per mount: a later change of delay would jump a running animation.
  const [sync] = useState(() => {
    const period = PERIOD[look]
    return period ? -(performance.now() % period) : 0
  })
  const shape = SHAPE[look]
  return (
    <span
      className={`dots is-${look} tone-${tone}`}
      style={{ "--sync": `${sync}ms` } as CSSProperties}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, dot) => {
        const rank = shape?.indexOf(dot) ?? -1
        return (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: a dot's place is its identity
            key={dot}
            className={rank >= 0 ? "on" : undefined}
            style={rank >= 0 ? ({ "--rank": rank } as CSSProperties) : undefined}
          />
        )
      })}
    </span>
  )
}
