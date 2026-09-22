/**
 * `kobe api inspect` — one production-diagnostics read aggregating the
 * identity/activity signals a bug report needs:
 *
 *   - `daemon`    — RAW activity registry (`debug.inspect`): per-tab state,
 *                   probe vendor, armed watchdogs.
 *   - `sessions`  — pty-host inventory JOINED with a process-tree walk per
 *                   session, using the TUI's exact `foregroundEngineIn` so
 *                   CLI and TUI compare 1:1.
 *   - `tabs`      — persisted `terminalTabs.<taskId>` snapshots the sidebar
 *                   renders from.
 *
 * Read-only by contract: no writes, spawns, or daemon startup; a missing
 * daemon/host degrades that section to null. `--task-id` narrows every section.
 */

import { foregroundEngineIn, parsePsSnapshot, psSnapshot } from "../../engine/foreground.ts"
import { loadStateFile } from "../../state/store.ts"
import type { TabsState } from "../../tui/workspace/terminal-tabs-core.ts"
import { F } from "./flags.ts"
import { type TaskSessionRow, unregisteredTabIds } from "./tab-snapshot.ts"
import type { VerbContext, VerbSpec } from "./types.ts"

type PtySessionRow = {
  key: string
  alive?: boolean
  pid?: number | null
  title?: string
  command?: readonly string[]
  exit?: { code: number | null; signal: string | null; at: string } | null
}

/**
 * Best-effort daemon read; null when none runs. Connects non-spawning: a
 * diagnostics read must never spawn the daemon it's inspecting.
 */
async function daemonSection(): Promise<unknown> {
  const { connectIfRunning } = await import("@sma1lboy/kobe-daemon/client/daemon-process")
  let client: Awaited<ReturnType<typeof connectIfRunning>> = null
  try {
    client = await connectIfRunning()
    if (!client) return null
    // biome-ignore lint/suspicious/noExplicitAny: one generic protocol call site, same as simpleRpc.
    return await client.request("debug.inspect" as any, {})
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    client?.close()
  }
}

/** pty.list + a foreground walk per live session pid. */
async function sessionsSection(taskId: string | undefined): Promise<unknown> {
  const [{ KobeDaemonClient }, { defaultPtyHostSocketPath }] = await Promise.all([
    import("@sma1lboy/kobe-daemon/client"),
    import("@sma1lboy/kobe-daemon/daemon/paths"),
  ])
  const client = new KobeDaemonClient(defaultPtyHostSocketPath())
  let sessions: PtySessionRow[]
  try {
    await client.connect()
    const res = await client.request<{ sessions?: PtySessionRow[] }>("pty.list", {})
    sessions = res.sessions ?? []
  } catch {
    return null // no pty host — an honest "couldn't look", not an empty fleet
  } finally {
    client.close()
  }
  // Keys are `<taskId>::<tabId>[::leaf-N]`; the `::` makes this a task match,
  // not a prefix match.
  if (taskId) sessions = sessions.filter((s) => s.key.startsWith(`${taskId}::`))
  // ONE ps snapshot serves every session — same economy as live-engine.ts.
  let rows: ReturnType<typeof parsePsSnapshot> | null = null
  try {
    const pids = sessions.map((s) => s.pid).filter((pid): pid is number => typeof pid === "number" && pid > 0)
    rows = parsePsSnapshot(await psSnapshot(pids))
  } catch {
    rows = null
  }
  return sessions.map((s) => {
    const walkable = rows !== null && typeof s.pid === "number" && s.pid > 0
    const found = walkable && rows ? foregroundEngineIn(rows, s.pid as number) : null
    return {
      key: s.key,
      alive: s.alive,
      pid: s.pid ?? null,
      title: s.title || null,
      // How a dead session died (host memory) — null while alive/unknown.
      exit: s.exit ?? null,
      // Tri-state, same vocabulary as the TUI store: vendor / null (walked,
      // no engine) / "unknown" (no pid or ps failed — couldn't look).
      foreground: walkable ? (found ? { vendor: found.vendor, pid: found.pid, argv: found.argv } : null) : "unknown",
    }
  })
}

/** Durable death records (`pty-exits.json`), readable with no host running;
 *  include the exit-time output tail. `layer: "pty"` is the session's child,
 *  `layer: "engine"` the AI process gone from a live session (`parentAlive:
 *  true`); records without the field are PTY-layer. Newest first. */
async function sessionExitsSection(taskId: string | undefined): Promise<unknown> {
  try {
    const { readPtyExitRecords } = await import("@sma1lboy/kobe-daemon/daemon/pty-exit-store")
    const records = Object.values(readPtyExitRecords()).sort((a, b) => (a.at < b.at ? 1 : -1))
    return taskId ? records.filter((r) => r.key.startsWith(`${taskId}::`)) : records
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Persisted tab snapshots RECONCILED against live sessions: `unregistered`
 * lists alive `<taskId>::tab-N` sessions the snapshot omits, and a task with
 * live sessions but no snapshot still gets an entry — a live engine must
 * never be invisible here. Exported for tests.
 */
export function tabsSection(taskId: string | undefined, sessions: unknown): unknown {
  const live: TaskSessionRow[] = Array.isArray(sessions)
    ? sessions.filter((s): s is TaskSessionRow => typeof (s as { key?: unknown })?.key === "string")
    : []
  try {
    const state = loadStateFile()
    const out: Record<string, unknown> = {}
    const prefix = "terminalTabs."
    for (const [key, value] of Object.entries(state)) {
      if (!key.startsWith(prefix)) continue
      const id = key.slice(prefix.length)
      if (taskId && id !== taskId) continue
      const snap = value as TabsState
      if (!snap || !Array.isArray(snap.tabs)) continue
      const unregistered = unregisteredTabIds(snap, id, live)
      out[id] = {
        activeId: snap.activeId,
        tabs: snap.tabs.map((t) => ({
          id: t.id,
          kind: t.kind,
          title: t.title ?? null,
          vendor: (t as { vendor?: string }).vendor ?? null,
          liveVendor: t.liveVendor ?? null,
          lastTitle: t.lastTitle ?? null,
          autoTitle: t.autoTitle ?? null,
        })),
        ...(unregistered.length > 0 ? { unregistered } : {}),
      }
    }
    // Tasks with live sessions but NO snapshot: every session is unregistered.
    for (const s of live) {
      const id = s.key.split("::")[0] ?? ""
      if (!id || out[id] !== undefined || (taskId && id !== taskId)) continue
      const unregistered = unregisteredTabIds(undefined, id, live)
      if (unregistered.length > 0) out[id] = { activeId: null, tabs: [], unregistered }
    }
    return out
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function inspect(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.str("task-id")
  const [daemon, sessions, sessionExits] = await Promise.all([
    daemonSection(),
    sessionsSection(taskId),
    sessionExitsSection(taskId),
  ])
  return { daemon, sessions, sessionExits, tabs: tabsSection(taskId, sessions), at: new Date().toISOString() }
}

/** Spec half — spread into {@link VERBS} in `verbs.ts`. */
export const INSPECT_VERB: VerbSpec = {
  name: "inspect",
  group: "read",
  summary:
    "Production diagnostics in one read: daemon activity registry (raw states, probe vendors, watchdogs), pty-host sessions joined with a live process-tree engine walk, durable session death records (exit code/signal/output tail), and the persisted tab snapshots the sidebar renders from. Read-only; missing daemon/host degrade to null.",
  flags: [F.taskId(false)],
  offline: true,
  handler: inspect,
}
