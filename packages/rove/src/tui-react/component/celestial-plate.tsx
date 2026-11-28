/** @jsxImportSource @opentui/react */
/** The web composer's sky, drawn in braille: the same frames, 64 × 20 cells. */

import { ACCENT, COLS, INK, ROWS } from "@sma1lboy/rove-core/lib/celestial/grid.ts"
import { orbitFrame } from "@sma1lboy/rove-core/lib/celestial/orbit.ts"
import { cometFrame, ringsFrame } from "@sma1lboy/rove-core/lib/celestial/scenes.ts"
import { useEffect, useMemo, useState } from "react"
import { brailleRows } from "../../lib/celestial/braille"
import { useTheme } from "../context/theme"

const SCENES = [orbitFrame, cometFrame, ringsFrame] as const
/** Rows the plate draws: a caller hides it when the pane cannot spare them. */
export const PLATE_ROWS = ROWS / 4
const FRAME_MS = 125
let opened = 0

export function CelestialPlate() {
  const { theme } = useTheme()
  // Each opening shows the next sky; a re-render keeps the one it has.
  const [scene] = useState(() => SCENES[opened++ % SCENES.length] ?? orbitFrame)
  const cells = useMemo(() => new Uint8Array(COLS * ROWS), [])
  const [t, setT] = useState(7)
  useEffect(() => {
    const timer = setInterval(() => setT((now) => now + FRAME_MS / 1000), FRAME_MS)
    return () => clearInterval(timer)
  }, [])
  scene(cells, t)
  const ink = (level: number) => (level === ACCENT ? theme.primary : level === INK ? theme.text : theme.textMuted)
  return (
    <box flexShrink={0} alignItems="center">
      {brailleRows(cells).map((runs, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid, rows never reorder
        <text key={row} wrapMode="none">
          {runs.map((run, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional within the row
            <span key={i} fg={ink(run.ink)}>
              {run.text}
            </span>
          ))}
        </text>
      ))}
    </box>
  )
}
