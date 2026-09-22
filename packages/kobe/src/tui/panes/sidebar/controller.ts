/**
 * Pure sidebar navigation controller (j/k/enter/g/G), free of opentui so
 * vitest (Node) can load it; the renderer only loads inside Bun.
 *
 * Cursor: indexes `getFlatIds()` (task ids, headers excluded), clamped to
 * `[0, ids.length-1]`; `-1` means "no selection yet" and moves like 0.
 *
 * Chord: a second `pressG` within the timeout jumps to top; any other
 * navigation disarms it (vim semantics).
 */

/** How long after a `g` press a second `g` still completes the `g g` chord. */
export const GG_CHORD_TIMEOUT_MS = 700

/** Inputs as plain accessors, so no reactivity flavor is baked in. */
export type SidebarControllerOpts = {
  /** Current cursor index into the flat task id list. -1 if no tasks. */
  getCursor: () => number
  /** Setter for the cursor index. The controller clamps to valid range. */
  setCursor: (next: number) => void
  /** Live flat list of navigable task ids, in display order. */
  getFlatIds: () => readonly string[]
  /** Selection callback. Fires on `selectCurrent` with the task id. */
  onSelect: (id: string) => void
  /** Chord-timer override (tests pass a fake); defaults to `setTimeout`. Returns a cancel function. */
  scheduleTimeout?: (cb: () => void, ms: number) => () => void
}

/** The sidebar's key behavior; binding handlers delegate here. */
export type SidebarController = {
  moveDown(): void
  moveUp(): void
  selectCurrent(): void
  /** Press `g`: arms the `g g` chord, or completes it (jump to top). */
  pressG(): void
  /** Press `Shift+G` — jump to bottom. Always disarms any pending chord. */
  pressShiftG(): void
  /** Test-only chord state. */
  isChordArmed(): boolean
  /** Disarm any pending chord without moving. */
  disarmChord(): void
}

/** Side effects happen only via the injected callbacks and `scheduleTimeout`. */
export function createSidebarController(opts: SidebarControllerOpts): SidebarController {
  const schedule =
    opts.scheduleTimeout ??
    ((cb, ms) => {
      const t = setTimeout(cb, ms)
      return () => clearTimeout(t)
    })

  let pendingG = false
  let cancelTimer: (() => void) | null = null

  const armChord = () => {
    pendingG = true
    cancelTimer?.()
    cancelTimer = schedule(() => {
      pendingG = false
      cancelTimer = null
    }, GG_CHORD_TIMEOUT_MS)
  }
  const disarm = () => {
    pendingG = false
    cancelTimer?.()
    cancelTimer = null
  }

  const move = (delta: number) => {
    const ids = opts.getFlatIds()
    if (ids.length === 0) return
    const cur = opts.getCursor()
    const start = cur < 0 ? 0 : cur
    const next = Math.min(ids.length - 1, Math.max(0, start + delta))
    opts.setCursor(next)
  }
  const jumpTo = (index: number) => {
    const ids = opts.getFlatIds()
    if (ids.length === 0) return
    opts.setCursor(Math.min(ids.length - 1, Math.max(0, index)))
  }

  return {
    moveDown() {
      disarm()
      move(1)
    },
    moveUp() {
      disarm()
      move(-1)
    },
    selectCurrent() {
      disarm()
      const ids = opts.getFlatIds()
      const cur = opts.getCursor()
      if (cur < 0 || cur >= ids.length) return
      const id = ids[cur]
      if (id !== undefined) opts.onSelect(id)
    },
    pressG() {
      if (pendingG) {
        disarm()
        jumpTo(0)
      } else {
        armChord()
      }
    },
    pressShiftG() {
      disarm()
      jumpTo(opts.getFlatIds().length - 1)
    },
    isChordArmed() {
      return pendingG
    },
    disarmChord() {
      disarm()
    },
  }
}
