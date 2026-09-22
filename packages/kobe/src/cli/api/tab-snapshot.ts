/**
 * Tab snapshots for sessions the CLI started. The sidebar renders a task's
 * tabs from `terminalTabs.<taskId>`; without a snapshot, a headlessly
 * started engine (`api add --prompt`, `api send`, a routine) is invisible.
 *
 * Seeding is WRITE-ONCE: a mounted TUI owns tab state (ordinals, titles,
 * splits, closes), and `api send` into an open task reuses its session, so
 * overwriting would clobber live state with a one-tab stub.
 */

import type { PtySessionExit } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { engineLaunchArgv } from "../../engine/engine-presets.ts"
import { loadStateFile, patchStateFile, updateStateFile } from "../../state/store.ts"
import { terminalTabsKey } from "../../tui-react/workspace/terminal-tabs-persist.ts"
import {
  type TabsState,
  type TerminalTab,
  closeTab,
  initialTabs,
  setTabTitle,
} from "../../tui/workspace/terminal-tabs-core.ts"
import type { VendorId } from "../../types/vendor.ts"

/** A death as `pty-exits.json` records it, joined onto a tab row. */
export type TabExit = PtySessionExit & {
  readonly tail?: readonly string[]
  readonly layer?: "pty" | "engine"
  /** `at` is when the daemon DISCOVERED this death — set on engine deaths
   *  reconciled at boot, where nothing on disk carries the real clock. */
  readonly atApproximate?: true
}

/**
 * One `get-task` tab row: persisted snapshot fields (same mapping as
 * `inspect`) joined with the liveness of the tab's OWN session
 * (`<taskId>::<tabId>`) — what an agent reads to pick a `send --tab` target.
 */
export interface TaskTabRow {
  readonly id: string
  readonly kind: TerminalTab["kind"]
  readonly title: string | null
  readonly vendor: string | null
  readonly liveVendor: string | null
  readonly lastTitle: string | null
  readonly autoTitle: string | null
  /** Is the tab's PTY SESSION alive. `null` = the pty host could not be
   *  asked ("couldn't look", not a dead tab). */
  readonly alive: boolean | null
  /** Is an ENGINE PROCESS running in the session tree. keepAlive `exec`s a
   *  login shell where an engine exits, so `alive: true, engineAlive: false`
   *  is a bare shell prompt. `null` = nothing walked it, never "no engine". */
  readonly engineAlive: boolean | null
  /** How the engine or session died; null while healthy or unknown. Live
   *  host exit wins, else the durable record; `tail` rides along only when
   *  the record describes the same death. `layer` says which process:
   *  - `"pty"` — the session child of a DEAD tab. Abnormal exits only. A
   *    `code` recovered from the wrapper's `Engine exited (code N)` banner
   *    is the engine's; `signal` is the session's.
   *  - `"engine"` — the engine gone from a still-ALIVE session. Clean exits
   *    reported too: code 0 (human quit) vs 143 (SIGTERM) is why callers ask. */
  readonly exit: TabExit | null
  /** True only on rows from a LIVE session the snapshot doesn't list. The
   *  pty host is the truth; divergence must render as a row, not vanish. */
  readonly unregistered?: true
}

/**
 * The task's engine launch argv for the liveness walk. Without it a CUSTOM
 * engine (a wrapper no vendor table names) walks as "no engine", and a
 * cleanup loop would treat live work as finished.
 */
export function taskEngineArgv(task: { readonly command?: string; readonly vendor?: string }): readonly string[] {
  return engineLaunchArgv({ command: task.command, vendor: task.vendor as VendorId | undefined })
}

/** The slice of a `pty.list` row the liveness joins below need. */
export interface TaskSessionRow {
  readonly key: string
  readonly alive?: boolean
  readonly exit?: PtySessionExit | null
  /** Spawn argv. Absent fails only the argv half of the engine-tab
   *  judgement, never the label half. */
  readonly command?: readonly string[]
}

/** The task's persisted `terminalTabs.<taskId>` snapshot; undefined when absent/malformed/unreadable. */
export function readTabsSnapshot(taskId: string): TabsState | undefined {
  try {
    const snap = loadStateFile()[terminalTabsKey(taskId)] as TabsState | undefined
    return snap && Array.isArray(snap.tabs) ? snap : undefined
  } catch {
    return undefined
  }
}

/**
 * Remove one persisted tab via ctrl+w's transition; undefined when the
 * snapshot doesn't name it. The fresh-state transaction keeps a stale CLI
 * read from overwriting a newer TUI tab list.
 */
export function closeTabsSnapshot(taskId: string, tabId: string): TerminalTab | undefined {
  let closing: TerminalTab | undefined
  const key = terminalTabsKey(taskId)
  updateStateFile((store) => {
    const state = store[key] as TabsState | undefined
    if (!state || !Array.isArray(state.tabs)) return false
    closing = state.tabs.find((tab) => tab.id === tabId)
    if (!closing) return false
    const { state: next, closedId } = closeTab(state, tabId, { allowEmpty: true })
    if (!closedId) {
      closing = undefined
      return false
    }
    store[key] = next
    return undefined
  })
  return closing
}

/**
 * Set one tab's user title via f2's transition (empty clears to default).
 * False = the snapshot doesn't name the tab (the one miss `rename --tab`
 * reports). Transactional like {@link closeTabsSnapshot}.
 */
export function renameTabsSnapshot(taskId: string, tabId: string, title: string): boolean {
  let found = false
  const key = terminalTabsKey(taskId)
  updateStateFile((store) => {
    const state = store[key] as TabsState | undefined
    if (!state || !Array.isArray(state.tabs)) return false
    if (!state.tabs.some((tab) => tab.id === tabId)) return false
    found = true
    const next = setTabTitle(state, tabId, title)
    // Same object = already named that; don't rewrite.
    if (next === state) return false
    store[key] = next
    return undefined
  })
  return found
}

const aliveKeysOf = (sessions: readonly TaskSessionRow[]): Set<string> =>
  new Set(sessions.filter((s) => s.alive).map((s) => s.key))

/**
 * Tab ids with a LIVE `<taskId>::<tabId>` session the snapshot doesn't list
 * (any path that opens a session without writing the snapshot). Split leaves
 * (`::leaf-N`) belong to their tab, matching `joinTaskTabs`' exact-key rule.
 */
export function unregisteredTabIds(
  snapshot: TabsState | undefined,
  taskId: string,
  sessions: readonly TaskSessionRow[],
): string[] {
  const known = new Set((snapshot?.tabs ?? []).map((t) => t.id))
  const prefix = `${taskId}::`
  const out: string[] = []
  for (const s of sessions) {
    if (!s.alive || !s.key.startsWith(prefix)) continue
    const tabId = s.key.slice(prefix.length)
    if (tabId.includes("::")) continue // split leaf — its tab is the row
    if (!known.has(tabId) && !out.includes(tabId)) out.push(tabId)
  }
  return out
}

/** Abnormal death only — exit 0 without a signal is not worth surfacing. */
const abnormalExit = (exit: PtySessionExit | null | undefined): PtySessionExit | null =>
  exit && (exit.code !== 0 || exit.signal !== null) ? exit : null

/**
 * Persisted tabs joined with session liveness. Exact-key match on purpose:
 * split leaves (`<taskId>::<tabId>::leaf-N`) never make the tab read alive.
 * `persistedExits` (durable `pty-exits.json`, keyed by session key) answers
 * "how did it die" after the host is gone; a live host's exit wins.
 *
 * `liveVendors` is a fresh foreground-walk verdict per key (vendor = running
 * NOW, null = walked and engine-free, absent = couldn't look). On alive rows
 * it overrides the recorded `liveVendor`, which only a mounted TUI writes
 * and so goes stale for never-opened tasks.
 */
export function joinTaskTabs(
  snapshot: TabsState | undefined,
  taskId: string,
  /** `null` = the pty host could not be asked; every liveness field is then `null`. */
  sessions: readonly TaskSessionRow[] | null,
  persistedExits: Readonly<Record<string, TabExit>> = {},
  liveVendors?: ReadonlyMap<string, string | null>,
  engineAlive?: ReadonlyMap<string, boolean>,
): TaskTabRow[] {
  const unknown = sessions === null
  const rows0 = sessions ?? []
  const alive = aliveKeysOf(rows0)
  const sessionExits = new Map(rows0.map((s) => [s.key, s.exit]))
  // The live host's exit wins (fresher if the key was reopened) but has no
  // tail; merge the durable record's tail only for the SAME death (`at`
  // matches), so a stale record never captions a newer one.
  const deadExit = (key: string): TaskTabRow["exit"] => {
    const ex = abnormalExit(sessionExits.get(key) ?? persistedExits[key])
    if (!ex) return null
    const record = persistedExits[key]
    const sameDeath = record?.at === ex.at
    const tail = sameDeath ? record?.tail : undefined
    // A signalled session's wait status has no code; the same-death record
    // recovered the engine's from the wrapper banner.
    const code = ex.code ?? (sameDeath ? (record?.code ?? null) : null)
    // Bare session key = PTY layer (engine records live under `<key>#engine`);
    // legacy records without the field are PTY too.
    const layer = record?.layer ?? "pty"
    return { code, signal: ex.signal, at: ex.at, layer, ...(tail && tail.length > 0 ? { tail } : {}) }
  }
  // ENGINE-layer death under a still-alive session (records under
  // `<key>#engine`). No abnormal-exit filter: every engine disappearance is
  // recorded, and code 0 ("quit on purpose") is an answer callers want.
  const engineExit = (key: string): TaskTabRow["exit"] => {
    const record = persistedExits[`${key}#engine`]
    if (!record) return null
    const { code, signal, at, tail, atApproximate } = record
    return {
      code,
      signal,
      at,
      layer: "engine",
      ...(atApproximate ? { atApproximate } : {}),
      ...(tail && tail.length > 0 ? { tail } : {}),
    }
  }
  const rows: TaskTabRow[] = (snapshot?.tabs ?? []).map((t) => {
    const key = `${taskId}::${t.id}`
    const isAlive = unknown ? null : alive.has(key)
    const walked = isAlive === true && liveVendors?.has(key) === true ? (liveVendors.get(key) ?? null) : undefined
    // Gated on the WALK, not the record: a tab that started a new engine
    // still holds its old death record.
    const engineIsAlive = engineAliveOf(key, isAlive, engineAlive)
    return {
      id: t.id,
      kind: t.kind,
      title: t.title ?? null,
      vendor: (t as { vendor?: string }).vendor ?? null,
      liveVendor: walked !== undefined ? walked : (t.liveVendor ?? null),
      lastTitle: t.lastTitle ?? null,
      autoTitle: t.autoTitle ?? null,
      alive: isAlive,
      engineAlive: engineIsAlive,
      // A session death wins: it is the later event and took the engine with it.
      exit: isAlive === false ? deadExit(key) : engineIsAlive === false ? engineExit(key) : null,
    }
  })
  // Unlisted live sessions still get a row. kind "engine": headless paths
  // only ever start engines (same assumption as the sidebar orphan backstop).
  for (const tabId of unregisteredTabIds(snapshot, taskId, rows0)) {
    rows.push({
      id: tabId,
      kind: "engine",
      title: null,
      vendor: null,
      liveVendor: null,
      lastTitle: null,
      autoTitle: null,
      alive: true,
      engineAlive: engineAliveOf(`${taskId}::${tabId}`, true, engineAlive),
      exit: null,
      unregistered: true,
    })
  }
  return rows
}

/** Engine found in the session tree; `null` when nothing walked it (see `TaskTabRow.engineAlive`). */
function engineAliveOf(
  key: string,
  isAlive: boolean | null,
  engineAlive: ReadonlyMap<string, boolean> | undefined,
): boolean | null {
  if (isAlive === null) return null
  if (!isAlive) return false
  return engineAlive?.has(key) === true ? (engineAlive.get(key) ?? null) : null
}

/**
 * Seed the canonical first engine tab when the task has no snapshot. Never
 * throws — sidebar visibility must not fail a good session start.
 *
 * `sessionId` (the pinned conversation id, passed only after a successful
 * delivery, hence `spawned`) makes a later dead-reattach `--resume` it.
 */
export function publishCliTabSnapshot(taskId: string, sessionId?: string | null): void {
  if (!taskId) return
  try {
    const key = terminalTabsKey(taskId)
    if (loadStateFile()[key] !== undefined) return
    // One active engine tab `tab-1`, matching the CLI launch's PTY key
    // (`engineSessionKey` → `<taskId>::tab-1`).
    const seeded = initialTabs()
    patchStateFile({
      [key]: sessionId
        ? {
            ...seeded,
            tabs: seeded.tabs.map((t): TerminalTab => (t.kind === "engine" ? { ...t, sessionId, spawned: true } : t)),
          }
        : seeded,
    })
  } catch {
    // Unwritable state.json: the tab just stays unlisted until the TUI opens the task.
  }
}

/**
 * Record a `send --tab new` tab's session id after the session started.
 * {@link mintCliTab} runs before the spawn and leaves it unset: claude errors
 * hard on `--resume` of a missing id.
 */
export function markCliTabSession(taskId: string, tabId: string, sessionId: string): void {
  try {
    const key = terminalTabsKey(taskId)
    const existing = loadStateFile()[key] as TabsState | undefined
    if (!existing || !Array.isArray(existing.tabs)) return
    patchStateFile({
      [key]: {
        ...existing,
        tabs: existing.tabs.map(
          (t): TerminalTab => (t.id === tabId && t.kind === "engine" ? { ...t, sessionId, spawned: true } : t),
        ),
      },
    })
  } catch {
    // Same best-effort contract as the snapshot writers above.
  }
}

/**
 * Mint the next engine-tab id for `send --tab new` and append it to the
 * snapshot so the TUI can attach it. Keyed off `nextOrdinal` like the TUI,
 * so CLI and TUI ids never collide; hence it MUST write over an existing
 * snapshot (seeding one first if absent). Returns an id even when the write
 * fails — that only costs sidebar visibility.
 */
export function mintCliTab(taskId: string, vendor?: VendorId, command?: string): string {
  let tabId = "tab-1"
  try {
    const key = terminalTabsKey(taskId)
    const existing = loadStateFile()[key] as TabsState | undefined
    const state = existing && Array.isArray(existing.tabs) && existing.tabs.length > 0 ? existing : initialTabs()
    const ordinal = typeof state.nextOrdinal === "number" && state.nextOrdinal > 1 ? state.nextOrdinal : 2
    tabId = `tab-${ordinal}`
    patchStateFile({
      [key]: {
        ...state,
        // `command`/`vendor` present = tab PINNED to a non-default engine
        // (`vendor` is the field ctrl+e writes); absent = follows the task.
        tabs: [
          ...state.tabs,
          {
            kind: "engine",
            id: tabId,
            title: null,
            ordinal,
            ...(vendor ? { vendor } : {}),
            ...(command ? { engineCommand: command } : {}),
          },
        ],
        activeId: tabId,
        nextOrdinal: ordinal + 1,
      },
    })
  } catch {
    // Time-keyed id cannot collide with ordinal ids.
    tabId = `tab-cli-${Date.now().toString(36)}`
  }
  return tabId
}
