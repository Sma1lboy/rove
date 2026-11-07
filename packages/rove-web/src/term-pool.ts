/**
 * Terminals outlive the view that shows them. A view that goes away (a switch to another task or
 * tab) parks its xterm in a hidden box, still attached and still taking output, so coming back
 * moves it into place: no attach, no ring replay, no repaint nudge. Past `PARKED_MAX` the least
 * recently shown one is disposed and leaves an HTML snapshot, which its next mount shows until
 * the reattach has repainted the screen.
 */

import type { BridgeClient } from "./bridge.ts"
import { type MountOpts, type Notice, type TermHandle, mountTerminal, streamKey } from "./term-mount.ts"
import { TERM_BOX } from "./ui/shell.ts"

/** Parked terminals per connection. Each holds a WebGL context, and a browser keeps only ~16 live. */
const PARKED_MAX = 8
/** Snapshots kept for evicted terminals. */
const SNAPSHOTS_MAX = 32
/** The longest a leaving terminal stays over the host while the next one waits for its replay. */
const LEAVING_MAX_MS = 600
/** A cold mount this soon after a terminal was parked is the view switching to another task. */
const ADOPT_WITHIN_MS = 100

/** What a view supplies; a parked terminal reaches nobody until the next view binds. */
export type TermBinding = Pick<
  MountOpts,
  "setNotice" | "onScrolled" | "onFocusChange" | "onExit" | "copyText" | "pasteImage"
>

/** What changes over a terminal's life in the pool; the forwarders mountTerminal holds read it. */
interface Slot {
  binding: TermBinding | null
  notice: Notice
  scrolled: number
  /** Parked since (ms); null while a view shows it. */
  parkedAt: number | null
}

interface Entry {
  readonly key: string
  readonly handle: TermHandle
  readonly box: HTMLElement
  readonly slot: Slot
  /** Timer of a parked box shown over the host (`is-leaving`) until its successor has painted; null otherwise. */
  leaving: number | null
}

interface Pool {
  readonly entries: Map<string, Entry>
  readonly snapshots: Map<string, string>
  /** The terminal parked most recently, which the next cold mount may show over itself. */
  left: Entry | null
}

const pools = new WeakMap<BridgeClient, Pool>()
let parking: HTMLElement | null = null

function poolOf(client: BridgeClient): Pool {
  let pool = pools.get(client)
  if (!pool) {
    pool = { entries: new Map(), snapshots: new Map(), left: null }
    pools.set(client, pool)
  }
  return pool
}

/** Out of layout: a 0×0 box never fits, so a parked terminal never shrinks its PTY. */
function parkingLot(): HTMLElement {
  if (!parking) {
    parking = document.createElement("div")
    parking.style.display = "none"
    document.body.append(parking)
  }
  return parking
}

function remember(pool: Pool, key: string, html: string): void {
  pool.snapshots.delete(key)
  pool.snapshots.set(key, html)
  for (const old of pool.snapshots.keys()) {
    if (pool.snapshots.size <= SNAPSHOTS_MAX) break
    pool.snapshots.delete(old)
  }
}

function drop(pool: Pool, entry: Entry, keepSnapshot: boolean): void {
  pool.entries.delete(entry.key)
  if (entry.leaving !== null) window.clearTimeout(entry.leaving)
  entry.leaving = null
  if (keepSnapshot) remember(pool, entry.key, entry.handle.snapshot())
  else pool.snapshots.delete(entry.key)
  entry.handle.dispose()
  entry.box.remove()
}

function evict(pool: Pool): void {
  const parked = [...pool.entries.values()].filter((e) => e.slot.parkedAt !== null)
  parked.sort((a, b) => (a.slot.parkedAt ?? 0) - (b.slot.parkedAt ?? 0))
  for (const entry of parked.slice(0, Math.max(0, parked.length - PARKED_MAX))) drop(pool, entry, true)
}

export interface Leased {
  readonly handle: TermHandle
  /** The view is going away: park the terminal (or dispose it, for a second view of one stream). */
  release(): void
}

/** A parked terminal for this stream can be shown at once, before fonts or anything else load. */
export function hasParked(client: BridgeClient, taskId: string, tabId: string, leafId?: string): boolean {
  return poolOf(client).entries.get(streamKey(taskId, tabId, leafId))?.slot.parkedAt != null
}

export function leaseTerminal(
  o: Omit<MountOpts, keyof TermBinding | "el" | "snapshot" | "onPainted"> & { readonly host: HTMLElement },
  binding: TermBinding,
): Leased {
  const pool = poolOf(o.client)
  const key = streamKey(o.taskId, o.tabId, o.leafId)
  const parked = pool.entries.get(key)
  if (parked && parked.slot.parkedAt !== null) {
    const { slot, handle, box } = parked
    slot.parkedAt = null
    slot.binding = binding
    // It was leaving a moment ago and is the one on screen again: keep it, let the rest go.
    if (parked.leaving !== null) {
      window.clearTimeout(parked.leaving)
      parked.leaving = null
      box.classList.remove("is-leaving")
    }
    pool.left = null
    settleLeaving(pool)
    o.host.append(box)
    binding.setNotice(slot.notice)
    binding.onScrolled(slot.scrolled)
    handle.term.refresh(0, handle.term.rows - 1)
    if (o.focusOnMount) handle.term.focus()
    return { handle, release: () => park(pool, parked) }
  }

  const box = document.createElement("div")
  box.className = TERM_BOX
  o.host.append(box)
  adoptLeft(pool, o.host)
  // A stream already on screen elsewhere gets its own, unpooled terminal.
  const pooled = !parked
  const slot: Slot = { binding, notice: { kind: "none" }, scrolled: 0, parkedAt: null }
  let entry: Entry | null = null
  const snapshot = pooled ? pool.snapshots.get(key) : undefined
  if (snapshot) pool.snapshots.delete(key)
  const handle = mountTerminal({
    ...o,
    el: box,
    snapshot,
    onPainted: () => settleLeaving(pool),
    setNotice: (notice) => {
      slot.notice = notice
      slot.binding?.setNotice(notice)
    },
    onScrolled: (lines) => {
      slot.scrolled = lines
      slot.binding?.onScrolled(lines)
    },
    onFocusChange: (focused) => slot.binding?.onFocusChange(focused),
    // Parked, the exit has no view to close its pane; it goes, and the next view attaches afresh.
    onExit: (code) => {
      if (slot.binding) slot.binding.onExit(code)
      else if (entry && pool.entries.get(key) === entry) drop(pool, entry, false)
    },
    copyText: (text) => slot.binding?.copyText(text) ?? Promise.resolve(false),
    pasteImage: () => slot.binding?.pasteImage() ?? Promise.resolve(),
  })
  if (!pooled) {
    return {
      handle,
      release: () => {
        handle.dispose()
        box.remove()
      },
    }
  }
  const leased: Entry = { key, handle, box, slot, leaving: null }
  entry = leased
  pool.entries.set(key, leased)
  return { handle, release: () => park(pool, leased) }
}

function park(pool: Pool, entry: Entry): void {
  const { slot } = entry
  if (pool.entries.get(entry.key) !== entry || slot.parkedAt !== null) return
  slot.binding?.onFocusChange(false)
  slot.binding = null
  entry.handle.term.blur()
  slot.parkedAt = performance.now()
  parkingLot().append(entry.box)
  pool.left = entry
  evict(pool)
}

/** The terminal that left is shown over the cold one that replaces it, so the pane keeps its last frame until the replay paints. */
function adoptLeft(pool: Pool, host: HTMLElement): void {
  const left = pool.left
  pool.left = null
  if (!left || left.slot.parkedAt === null || performance.now() - left.slot.parkedAt > ADOPT_WITHIN_MS) return
  if (pool.entries.get(left.key) !== left) return
  left.box.classList.add("is-leaving")
  host.append(left.box)
  left.leaving = window.setTimeout(() => settle(pool, left), LEAVING_MAX_MS)
}

/** A leaving terminal goes back to the parking lot: the new one has painted, took the screen, or waited long enough. */
function settle(pool: Pool, entry: Entry): void {
  if (entry.leaving === null) return
  window.clearTimeout(entry.leaving)
  entry.leaving = null
  entry.box.classList.remove("is-leaving")
  if (pool.entries.get(entry.key) === entry && entry.slot.parkedAt !== null) parkingLot().append(entry.box)
}

function settleLeaving(pool: Pool): void {
  for (const entry of pool.entries.values()) settle(pool, entry)
}
