/**
 * Tab snapshots for sessions the CLI started, and the CLI's tab edits. The
 * sidebar renders a task's tabs from the daemon's tab store; without a row, a
 * headlessly started engine (`api add --prompt`, `api send`, a routine) is
 * invisible.
 *
 * The daemon owns every task's tabs (`tabs-store.ts`): it mints ids from one
 * counter, applies edits in arrival order and persists `terminalTabs.<taskId>`
 * in state.json itself. So the writers here never touch state.json: each is a
 * `tabs.apply` of operations, and the read half (`readTabsSnapshot`) keeps
 * reading the file the daemon writes.
 *
 * Seeding is WRITE-ONCE (`seed` is ignored when a record exists): a mounted
 * TUI owns tab state (ordinals, titles, splits, closes), and `api send` into
 * an open task reuses its session, so overwriting would clobber live state
 * with a one-tab stub.
 */

import type { PtySessionExit } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type SharedTabs, type TabOp, diffTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { engineLaunchArgv } from "../../engine/engine-presets.ts"
import { loadStateFile } from "../../state/store.ts"
import { terminalTabsKey } from "../../state/tabs-persistence.ts"
import {
  type TabsState,
  type TerminalTab,
  closeTab,
  initialTabs,
  setTabTitle,
  tabPtyKeyFor,
} from "../../tui/workspace/terminal-tabs-core.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { type WireSplit, wireSplit } from "./split-wire.ts"

/** The slice of a daemon client the tab writers need. */
export type TabsRpc = Pick<DaemonRpc, "request">

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
  /** Present while the tab is split: the layout, one pane per hosted shell (`<taskId>::<tabId>::leaf-N`). */
  readonly split?: WireSplit
  /** A viewport tab (`EngineTab.ptyTask`): the task whose session this tab only shows; liveness is that session's. */
  readonly viewOf?: string
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

/** A `tabs.apply` / `tabs.get` answer. */
interface DaemonTabsReply {
  readonly state: SharedTabs | null
  readonly rev: number
  readonly opened?: readonly (string | null)[]
}

/** The daemon's tabs as the TUI's reducers take them. `activeId` is only the last focus any client reported. */
function asTabsState(state: SharedTabs | null | undefined): TabsState | undefined {
  if (!state || !Array.isArray(state.tabs)) return undefined
  return { ...state, activeId: state.activeId ?? state.tabs[0]?.id ?? "" } as unknown as TabsState
}

const asShared = (state: TabsState): SharedTabs => state as unknown as SharedTabs

/** One `tabs.apply`; the state the daemon answers with after every op, and the ids its `open`s produced. */
export async function applyTabOps(
  client: TabsRpc,
  taskId: string,
  ops: readonly TabOp[],
): Promise<{ state: TabsState | undefined; opened: readonly (string | null)[] }> {
  const reply = await client.request<DaemonTabsReply>("tabs.apply", { taskId, ops })
  return { state: asTabsState(reply?.state), opened: reply?.opened ?? [] }
}

/**
 * The task's tabs as the daemon holds them NOW (`tabs.get`). Edits read this,
 * not state.json: the daemon persists on a short debounce, so the file can
 * trail a change the daemon already applied.
 */
export async function readDaemonTabs(client: TabsRpc, taskId: string): Promise<TabsState | undefined> {
  return asTabsState((await client.request<DaemonTabsReply>("tabs.get", { taskId }))?.state)
}

/**
 * Edit the daemon's copy with one of the TUI's reducers and send the
 * difference (`diffTabs`): id-keyed ops, so an edit another client made in
 * between survives. `edit` returning the same object sends nothing; a task
 * with no tabs record is never edited.
 */
async function editTabs(client: TabsRpc, taskId: string, edit: (state: TabsState) => TabsState): Promise<void> {
  const before = await readDaemonTabs(client, taskId)
  if (!before) return
  const next = edit(before)
  if (next === before) return
  const ops = diffTabs(asShared(before), asShared(next))
  if (ops.length > 0) await applyTabOps(client, taskId, ops)
}

/**
 * Remove one tab via ctrl+w's transition (emptying the strip leaves its
 * re-seed hint); undefined when the daemon's tabs don't name it.
 */
export async function closeTabsSnapshot(
  client: TabsRpc,
  taskId: string,
  tabId: string,
): Promise<TerminalTab | undefined> {
  let closing: TerminalTab | undefined
  await editTabs(client, taskId, (state) => {
    closing = state.tabs.find((tab) => tab.id === tabId)
    if (!closing) return state
    // Closed as the focused one: `activeId` is only some client's last focus,
    // and the last tab's close must record `reopenAs` either way.
    const { state: next, closedId } = closeTab({ ...state, activeId: tabId }, tabId, { allowEmpty: true })
    if (!closedId) closing = undefined
    return closedId ? next : state
  })
  return closing
}

/**
 * Set one tab's user title via f2's transition (empty clears to default).
 * False = the daemon's tabs don't name the tab (the one miss `rename --tab`
 * reports).
 */
export async function renameTabsSnapshot(
  client: TabsRpc,
  taskId: string,
  tabId: string,
  title: string,
): Promise<boolean> {
  let found = false
  await editTabs(client, taskId, (state) => {
    found = state.tabs.some((tab) => tab.id === tabId)
    // Same object = already named that; nothing is sent.
    return found ? setTabTitle(state, tabId, title) : state
  })
  return found
}

/** Store one tab's split tree (`tab-split`); the tab as the daemon answers, undefined once it is gone. */
export async function patchTabSplit(
  client: TabsRpc,
  taskId: string,
  tabId: string,
  tree: TerminalTab["splitTree"],
): Promise<TerminalTab | undefined> {
  const { state } = await applyTabOps(client, taskId, [{ op: "patch", id: tabId, set: { splitTree: tree ?? null } }])
  return state?.tabs.find((t) => t.id === tabId)
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
    const key = tabPtyKeyFor(taskId, t)
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
      ...(t.splitTree ? { split: wireSplit(t.splitTree) as WireSplit } : {}),
      ...(t.kind === "engine" && t.ptyTask ? { viewOf: t.ptyTask.id } : {}),
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
 * Seed the canonical first engine tab when the task has no tabs record (the
 * daemon ignores `seed` over an existing one). Never throws — sidebar
 * visibility must not fail a good session start.
 *
 * `sessionId` (the pinned conversation id, passed only after a successful
 * delivery, hence `spawned`) makes a later dead-reattach `--resume` it.
 */
export async function publishCliTabSnapshot(client: TabsRpc, taskId: string, sessionId?: string | null): Promise<void> {
  if (!taskId) return
  try {
    // One active engine tab `tab-1`, matching the CLI launch's PTY key
    // (`engineSessionKey` → `<taskId>::tab-1`).
    const seeded = initialTabs()
    const state: TabsState = sessionId
      ? {
          ...seeded,
          tabs: seeded.tabs.map((t): TerminalTab => (t.kind === "engine" ? { ...t, sessionId, spawned: true } : t)),
        }
      : seeded
    await applyTabOps(client, taskId, [{ op: "seed", state: asShared(state) }])
  } catch {
    // Daemon refused or unreachable: the tab just stays unlisted until the TUI opens the task.
  }
}

/**
 * Record a CLI-started ENGINE tab's session after it spawned (`spawned`, plus
 * the pinned conversation id when the engine took one). {@link allocateTab}
 * runs before the spawn and leaves both unset: claude errors hard on
 * `--resume` of a missing id. Best-effort: the tabs after the patch, or
 * undefined when nothing was sent or the daemon could not be asked.
 */
export async function markCliTabSession(
  client: TabsRpc,
  taskId: string,
  tabId: string,
  sessionId: string | null,
): Promise<TabsState | undefined> {
  try {
    const tab = (await readDaemonTabs(client, taskId))?.tabs.find((t) => t.id === tabId)
    if (tab?.kind !== "engine") return undefined
    const set = { ...(sessionId ? { sessionId } : {}), spawned: true }
    return (await applyTabOps(client, taskId, [{ op: "patch", id: tabId, set }])).state
  } catch {
    // Same best-effort contract as the seed above.
    return undefined
  }
}

/** A new tab's row before the daemon gives it an id and ordinal. */
export type NewTabRow = TerminalTab extends infer T
  ? T extends TerminalTab
    ? Omit<T, "id" | "ordinal">
    : never
  : never

type OpenRow = Extract<TabOp, { op: "open" }>["row"]

/**
 * Open a tab whose id the DAEMON mints (`open` without an id): one counter
 * for every client, so two allocations — two CLIs, a CLI and a TUI — can
 * never take the same id, and a closed id is never handed out again. A task
 * with no tabs record gets the canonical `tab-1` seeded first in the same
 * apply, so the new tab never lands on the engine's own `<taskId>::tab-1`
 * key. Throws when the daemon refuses (unknown task, no daemon).
 */
export async function allocateTab(client: TabsRpc, taskId: string, row: NewTabRow): Promise<TerminalTab> {
  const { state, opened } = await applyTabOps(client, taskId, [
    { op: "seed", state: asShared(initialTabs()) },
    { op: "open", row: row as unknown as OpenRow },
  ])
  const id = opened[0]
  const tab = id ? state?.tabs.find((t) => t.id === id) : undefined
  if (!tab) throw new Error(`the daemon opened no tab for ${taskId}`)
  return tab
}

/** The task's own `tab-1`, seeded when it has no tabs yet: the tab an engine takes over a task's first conversation. */
export async function seedCanonicalTab(client: TabsRpc, taskId: string): Promise<TerminalTab> {
  const { state } = await applyTabOps(client, taskId, [{ op: "seed", state: asShared(initialTabs()) }])
  const tab = state?.tabs.find((t) => t.id === "tab-1")
  if (!tab) throw new Error(`the daemon holds no tab-1 for ${taskId}`)
  return tab
}
