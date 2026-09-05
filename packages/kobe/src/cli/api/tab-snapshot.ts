/**
 * Publish a tab snapshot for a session the CLI started.
 *
 * The sidebar tree renders a worktree's tabs by reading the task's
 * `terminalTabs.<taskId>` snapshot (see `tui-react/workspace/
 * terminal-tabs-shared.ts`). That snapshot was only ever written by a MOUNTED
 * `TerminalTabs` — so a task started headlessly (`kobe api add --prompt`,
 * `kobe api send`, a routine firing) ran a perfectly live engine that the
 * tree could not see: `knownTaskTabs` returned null and the worktree row got
 * no children at all. Since headless start is how agent-driven work enters
 * kobe, that was most of the fleet rendering as empty worktrees.
 *
 * Same fix the issue-chat background spawn already applies
 * (`tui/workspace/issue-chat-spawn.ts` — "persist so a visit attaches, not
 * respawns"); this is that precedent applied to the CLI's own launch path.
 *
 * Deliberately WRITE-ONCE: it seeds the first engine tab for a task with no
 * snapshot and never touches an existing one. A mounted TUI owns tab state
 * for real (ordinals, titles, splits, closes), and a CLI process must not
 * fight it — `kobe api send` into a task you have open in the TUI reuses that
 * session, so overwriting here would clobber live state with a one-tab stub.
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

/**
 * One tab row `get-task` returns: the persisted snapshot fields the sidebar
 * renders from (same mapping as `inspect`'s tabs section) joined with whether
 * the tab's OWN hosted session (`<taskId>::<tabId>`) is alive right now — the
 * discovery read an agent needs to pick a `send --tab tab-N` target.
 */
/** A death as `pty-exits.json` records it, joined onto a tab row. */
export type TabExit = PtySessionExit & {
  readonly tail?: readonly string[]
  readonly layer?: "pty" | "engine"
  /** `at` is when the daemon DISCOVERED this death, not when it happened —
   *  set on engine deaths reconciled at daemon boot, where the wrapper's
   *  banner proves the death but nothing on disk carries its clock. */
  readonly atApproximate?: true
}

export interface TaskTabRow {
  readonly id: string
  readonly kind: TerminalTab["kind"]
  readonly title: string | null
  readonly vendor: string | null
  readonly liveVendor: string | null
  readonly lastTitle: string | null
  readonly autoTitle: string | null
  /** Is the tab's hosted PTY SESSION alive. `null` means the pty host could
   *  not be asked, which is "couldn't look" and not a dead tab — the whole
   *  inventory is unknown then, and a caller acting on `false` here would be
   *  acting on a fact nobody established. */
  readonly alive: boolean | null
  /** Is an ENGINE PROCESS running inside this tab's session tree — the fact
   *  `alive` cannot report. keepAlive `exec`s a login shell where an engine
   *  exits, so `alive: true, engineAlive: false` is a tab holding a bare
   *  zsh prompt. `null` means nothing walked it (a `ps` that failed), never
   *  "no engine": a reader must not turn "couldn't look" into a verdict. */
  readonly engineAlive: boolean | null
  /** How this tab's engine or session died; null while it is healthy, or
   *  while nothing could be established. Joined from the live host when
   *  present, else the durable exit records — `tail` (the exit-time output
   *  lines the durable record keeps) rides along whenever the record
   *  describes the same death.
   *
   *  `layer` names WHICH process this describes, without which `code` and
   *  `signal` cannot be read together:
   *  - `"pty"` — the tab's own session child, on a DEAD tab. Abnormal exits
   *    only (a clean exit 0 stays null, by the no-noise rule). A `code`
   *    recovered from the wrapper's `Engine exited (code N)` banner belongs
   *    to the engine, while `signal` belongs to the session that outlived it.
   *  - `"engine"` — the AI process gone from a tab whose SESSION IS STILL
   *    ALIVE (`alive: true, engineAlive: false`), which is what keepAlive's
   *    login shell leaves behind. Reported for a clean engine exit too: `code
   *    0` is "the human quit their agent" and `code 143` is "it was
   *    SIGTERMed", and telling those apart is the whole reason a fleet reader
   *    asks. */
  readonly exit: TabExit | null
  /** Present (true) only on rows derived from a LIVE pty session the
   *  persisted snapshot does not list — an otherwise invisible engine. The
   *  snapshot is a record of intent; the pty host holds the truth, and a
   *  divergence must render as a row, not vanish. */
  readonly unregistered?: true
}

/**
 * The task's own engine launch argv, for the liveness walk. Passing it is
 * what lets a CUSTOM engine — a wrapper script no vendor table names — read
 * as running; without it that task walks as "no engine" and an unattended
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
 * Remove one persisted tab with the same pure transition ctrl+w uses.
 * Returns the removed tab, or undefined when the current snapshot does not
 * name it. The fresh-state transaction prevents a stale CLI snapshot from
 * overwriting a newer TUI tab list.
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
 * Set one persisted tab's user title, with the same pure transition f2 uses.
 * Returns whether the snapshot named the tab — false covers "no such tab" and
 * "task has never opened any", which is the one case `rename --tab` reports
 * as a miss. An empty title clears back to the tab's default name.
 *
 * The fresh-state transaction is what keeps a stale CLI read from overwriting
 * a newer TUI tab list, exactly as {@link closeTabsSnapshot} does.
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
    // Same object = already named that. Abort the transaction rather than
    // rewrite an identical snapshot.
    if (next === state) return false
    store[key] = next
    return undefined
  })
  return found
}

const aliveKeysOf = (sessions: readonly TaskSessionRow[]): Set<string> =>
  new Set(sessions.filter((s) => s.alive).map((s) => s.key))

/**
 * Tab ids with a LIVE `<taskId>::<tabId>` pty session the snapshot does not
 * list — the reconciliation read for an invisible engine (a canonical-spawn
 * fallback, an older kobe, any future path that opens a session without
 * writing the snapshot). Split leaves (`::leaf-N` suffix) belong to their
 * tab and never count on their own, matching `joinTaskTabs`' exact-key rule.
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
 * Persisted tabs joined with hosted-session liveness. Exact-key match on
 * purpose: a split's extra shell leaves (`<taskId>::<tabId>::leaf-N`) never
 * make the tab itself read alive — only the tab's own session does.
 * `persistedExits` (the durable `pty-exits.json` records, keyed by session
 * key) answers "how did it die" after the host itself is gone; a live host's
 * in-memory exit wins when both exist.
 *
 * `liveVendors` is a fresh foreground-walk verdict per session
 * key — the same tri-state the TUI's live-engine store speaks: a vendor =
 * that engine runs under the session's shell NOW, null = walked and
 * engine-free, absent = couldn't look. Where it answers it overrides the
 * RECORDED `liveVendor` (a snapshot written only by a mounted TUI, so it
 * goes stale for tasks never opened): a user-typed `claude` in a shell tab
 * reads as live claude, and a ctrl+C'd engine reads as a plain shell. A
 * dead session's verdict is meaningless — only alive rows take it.
 */
export function joinTaskTabs(
  snapshot: TabsState | undefined,
  taskId: string,
  /** `null` = the pty host could not be asked; every liveness field on every
   *  row then reports `null` rather than a verdict nobody checked. */
  sessions: readonly TaskSessionRow[] | null,
  persistedExits: Readonly<Record<string, TabExit>> = {},
  liveVendors?: ReadonlyMap<string, string | null>,
  engineAlive?: ReadonlyMap<string, boolean>,
): TaskTabRow[] {
  const unknown = sessions === null
  const rows0 = sessions ?? []
  const alive = aliveKeysOf(rows0)
  const sessionExits = new Map(rows0.map((s) => [s.key, s.exit]))
  // Death cause + tail for one dead tab. The live host's in-memory exit wins
  // (fresher when the key was reopened) but carries no output; the durable
  // record has the exit-time tail — merge it in only when both describe the
  // SAME death (`at` matches), so a stale record never captions a newer one.
  const deadExit = (key: string): TaskTabRow["exit"] => {
    const ex = abnormalExit(sessionExits.get(key) ?? persistedExits[key])
    if (!ex) return null
    const record = persistedExits[key]
    const sameDeath = record?.at === ex.at
    const tail = sameDeath ? record?.tail : undefined
    // The live host's in-memory exit wins on freshness but carries only a
    // wait status, and a signalled session has no code in one. The durable
    // record for the SAME death recovered the engine's from the wrapper's
    // banner — take that rather than report `code: null` beside a tail that
    // spells the number out.
    const code = ex.code ?? (sameDeath ? (record?.code ?? null) : null)
    // Keyed by the bare session key, so this row is structurally the PTY
    // layer (engine-layer records live under `<key>#engine`); a legacy
    // record predating the field is PTY-layer too.
    const layer = record?.layer ?? "pty"
    return { code, signal: ex.signal, at: ex.at, layer, ...(tail && tail.length > 0 ? { tail } : {}) }
  }
  // The ENGINE-layer death of a tab whose SESSION IS STILL ALIVE — the case
  // `deadExit` cannot describe twice over: it only ran for `alive === false`,
  // and it looks records up under the bare session key while engine records
  // live under `<key>#engine`. So `layer: "engine"` — which `TaskTabRow.exit`
  // is typed for and `docs/API.md` documents — could never appear on a row
  // from `get-task` or `collect`, and an agent polling a fleet read "no
  // engine, no reason" while `inspect` printed the code and the tail. No
  // abnormal-exit filter: the store already decided every engine
  // disappearance is worth recording, and code 0 is the "quit on purpose"
  // answer the caller came for.
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
    // Gated on the WALK, not on the record's existence: a tab that has since
    // started a new engine still holds its old death record, and captioning a
    // live engine with it would be the same lie in the other direction.
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
      // A pty-layer death of the session itself wins: it is the later and
      // larger event, and it took the engine's tab with it.
      exit: isAlive === false ? deadExit(key) : engineIsAlive === false ? engineExit(key) : null,
    }
  })
  // Live sessions the snapshot doesn't know still get a row — the discovery
  // read must show every engine that exists, not just the registered ones.
  // "engine" is the same assumption the sidebar's orphan backstop documents:
  // headless paths only ever start engines.
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

/**
 * Was an ENGINE PROCESS found inside this tab's session tree — `null` when
 * nothing walked it (a dead tab, or a `ps` that failed). Distinct from
 * `alive`, which is the SESSION's liveness: keepAlive leaves a login shell
 * where an engine exited, so a tab can be `alive: true, engineAlive: false`
 * for as long as nobody closes it.
 */
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
 * A task is RUNNING when ANY of its engine tabs has a live hosted session
 * WITH AN ENGINE IN IT — not just the canonical first one, and not merely a
 * live PTY. The old `tab-1`-only rule reported `running:false` while later
 * engine tabs (`send --tab new`, a TUI tab opened after tab-1 closed) were
 * happily alive. The `tab-1` key stays as a snapshot-free floor: it is
 * always an engine tab by construction (`initialTabs`), so it counts even
 * when the snapshot write failed. Non-engine tabs (command/content) never
 * count — same rule delivery uses.
 *
 * `engineAlive` is the process half. Session liveness alone answered `true`
 * for a task whose engine had been reaped hours earlier, because keepAlive
 * keeps the PTY. A tab nothing could walk (`null`) still counts as running:
 * "couldn't look" must never read as stopped.
 */
export function hasLiveEngineTab(
  snapshot: TabsState | undefined,
  taskId: string,
  sessions: readonly TaskSessionRow[],
  engineAlive?: ReadonlyMap<string, boolean>,
): boolean {
  const alive = aliveKeysOf(sessions)
  const counts = (key: string): boolean => alive.has(key) && engineAlive?.get(key) !== false
  if (counts(`${taskId}::tab-1`)) return true
  return (snapshot?.tabs ?? []).some((t) => t.kind === "engine" && counts(`${taskId}::${t.id}`))
}

/**
 * Seed `terminalTabs.<taskId>` with the canonical first engine tab when the
 * task has none. No-op when a snapshot already exists, and never throws — a
 * sidebar-visibility nicety must not fail an otherwise-good session start.
 *
 * `sessionId` is the conversation id the launch pinned (`withClaudeSessionId`)
 * — recording it (with `spawned`, the conversation provably started: the
 * caller only passes it after a successful delivery) makes a later
 * dead-reattach `--resume` this conversation, matching a TUI-spawned tab.
 */
export function publishCliTabSnapshot(taskId: string, sessionId?: string | null): void {
  if (!taskId) return
  try {
    const key = terminalTabsKey(taskId)
    if (loadStateFile()[key] !== undefined) return
    // `initialTabs()` is the same shape a mounting TerminalTabs would write:
    // one engine tab `tab-1`, active — matching the PTY key the CLI launch
    // path uses (`engineSessionKey` → `<taskId>::tab-1`), so the tree's row
    // and the live process agree on which tab this is.
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
    // Unreadable/unwritable state.json: the session is still fine, the tree
    // just won't list its tab until the TUI opens the task.
  }
}

/**
 * Record a CLI-spawned EXTRA tab's pinned session id after its session
 * actually started (the `send --tab new` twin of {@link publishCliTabSnapshot}'s
 * sessionId). mintCliTab runs BEFORE the spawn — it deliberately leaves the
 * id unset so a failed start never claims a resumable conversation that
 * does not exist (claude errors hard on `--resume` of a missing id).
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
 * Mint the next engine-tab id for a CLI-spawned EXTRA tab (`send --tab new`)
 * and append it to the task's persisted snapshot, so a mounted (or later)
 * TUI renders and attaches the tab instead of never knowing it exists.
 *
 * The append mirrors `addTab()`'s shape but keys the id off `nextOrdinal`
 * exactly like the TUI does, so CLI- and TUI-minted ids can never collide —
 * both consume the same monotonic counter from the same snapshot. Unlike
 * {@link publishCliTabSnapshot} this MUST write over an existing snapshot
 * (that's where the counter lives); a task with none gets seeded first.
 *
 * Best-effort like its sibling — but the caller needs the id even when
 * state.json is unwritable, so the id is returned regardless and the
 * snapshot write failure only costs sidebar visibility.
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
        // `command`/`vendor` present = this tab is PINNED to an engine other
        // than the task's default (`send --tab new --command …`); `vendor` is
        // the same field the TUI's ctrl+e pick writes. Absent, the tab
        // follows the task like every other.
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
    // Snapshot write failed: fall back to a time-keyed id that cannot
    // collide with ordinal ids, so the spawn still proceeds.
    tabId = `tab-cli-${Date.now().toString(36)}`
  }
  return tabId
}
