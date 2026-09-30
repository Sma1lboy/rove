/**
 * ReplayTerminal — the film renderer's view of a recorded take. Same xterm as
 * `ChatTerminal` (see `openHarnessTerminal`), fed from an asciicast instead of
 * a PTY socket, and driven entirely by `window.__replay` so every frame is a
 * function of the recording and the requested time, never of wall clock.
 */

import type { Terminal } from "@xterm/xterm"
import { useEffect, useRef } from "react"
import {
  type Cast,
  type CastMarker,
  castDuration,
  castMarkers,
  parseCast,
  planSeek,
} from "../lib/cast.ts"
import {
  loadTerminalFont,
  openHarnessTerminal,
} from "../lib/harness-terminal.ts"
import type { TerminalRendererMode } from "../lib/terminal-renderer.ts"

export type ReplayControl = {
  load(text: string): Promise<{ duration: number; markers: CastMarker[] }>
  /** Show the take at `t` seconds; resolves once painted. True when the
   *  screen may differ from the previous seek. */
  seek(t: number): Promise<boolean>
}

declare global {
  interface Window {
    __replay?: ReplayControl
  }
}

// Renderers paint on the animation frame after a write lands; two frames make
// sure the one the screenshot sees is the painted one.
function painted(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  return promise
}

export function ReplayTerminal({
  renderer,
  transparent,
  hostBackground,
}: {
  renderer: TerminalRendererMode
  transparent: boolean
  hostBackground?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let disposed = false
    let term: Terminal | null = null

    void (async () => {
      await loadTerminalFont()
      if (disposed) return
      const t = openHarnessTerminal(el, {
        renderer,
        transparent,
        hostBackground,
        cursorBlink: false,
      })
      term = t
      let cast: Cast | null = null
      let cursor = 0
      const rewind = (c: Cast): void => {
        t.reset()
        t.resize(c.cols, c.rows)
      }
      window.__replay = {
        async load(text) {
          cast = parseCast(text)
          cursor = 0
          rewind(cast)
          await painted()
          return { duration: castDuration(cast), markers: castMarkers(cast) }
        },
        async seek(time) {
          if (!cast) throw new Error("__replay.seek before load")
          const plan = planSeek(cast, cursor, time)
          if (plan.reset) rewind(cast)
          for (const step of plan.steps) {
            if (step.kind === "resize") {
              t.resize(step.cols, step.rows)
              continue
            }
            const { promise, resolve } = Promise.withResolvers<void>()
            t.write(step.data, resolve)
            await promise
          }
          cursor = plan.cursor
          const changed = plan.reset || plan.steps.length > 0
          if (changed) await painted()
          return changed
        },
      }
      el.dataset.replayReady = "true"
    })()

    return () => {
      disposed = true
      delete window.__replay
      term?.dispose()
    }
  }, [renderer, transparent, hostBackground])

  return (
    <div
      ref={ref}
      data-testid="opentui-terminal"
      className="h-full w-full overflow-hidden"
    />
  )
}
