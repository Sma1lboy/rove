/**
 * Engine deaths from the pty-host's durable exit records — TWO consumers.
 *
 * The PTY host is a separate process with no daemon-socket connection, but it
 * already persists every abnormal child exit to `pty-exits.json`
 * (`pty-exit-store.ts`). The daemon watches that file, diffs records by
 * `key + at`, and per NEW record:
 *
 *   1. fires a `session.exited` PLUGIN event (plugin-host only), and
 *   2. writes the tab's activity state to `dead` in the registry — the half
 *      that reaches the UI. Without it a killed engine (SIGTERM: no Stop, no
 *      SessionEnd, no hook of any kind) folded into idle and the tab rendered
 *      exactly like a shell that never ran anything.
 *
 * The first read after daemon start is baseline, mirroring the plugin event
 * reducer's first-snapshot rule: pre-existing corpses must not re-fire.
 */

import type { PluginHost } from "../plugins/runtime.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { AttentionInboxStore } from "./attention-inbox.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"
import { defaultPtyExitsPath } from "./paths.ts"
import { ENGINE_EXIT_BANNER, type PtyExitRecord, readPtyExitStore } from "./pty-exit-store.ts"

const DEBOUNCE_MS = 250
/** Session key shape: `taskId::tabId` (pty registry convention). */
const KEY_RE = /^(.+?)::(.+)$/

export interface PtyExitWatchOptions {
  readonly homeDir?: string
  readonly plugins: () => Pick<PluginHost, "handleUiReport"> | null
  /** Activity registry — where a death becomes the tab's live badge. */
  readonly activity?: Pick<DaemonActivityRegistry, "recordEngineDeath">
  /** Attention Inbox — where a death becomes a durable episode, so it is
   *  still findable after the badge scrolls out of view. */
  readonly inbox?: Pick<AttentionInboxStore, "recordEngineDeath">
  readonly log?: (line: string) => void
  /** Test seam. */
  readonly path?: string
}

export function startPtyExitWatch(opts: PtyExitWatchOptions): () => void {
  const path = opts.path ?? defaultPtyExitsPath(opts.homeDir)
  const seen = new Map<string, string>()
  /** True once ONE read succeeded. The first successful read is the baseline
   *  (everything in it predates this daemon), whether that happens below at
   *  start or on a later sweep because the file was unreadable at start. */
  let baselined = false

  const sweep = (): void => {
    const host = opts.plugins()
    // No host = don't mark records seen, so a fire is deferred, not lost.
    // (Unreachable today — server.ts only starts the watch with a live host —
    // but cheap insurance against a future caller.)
    if (!host) return
    const { records, readable } = readPtyExitStore(path)
    // An unreadable read is NOT an empty file, and acting on one is how up to
    // MAX_RECORDS engines that died days ago all come back at once: the prune
    // below would empty `seen`, and the next sweep would then re-fire every
    // record on disk — carrying its ORIGINAL `at`, so the corpses sort to the
    // head of the oldest-first Inbox, above whatever actually needs a person.
    // Wait for a readable one instead; the file is rewritten often enough.
    if (!readable) return
    // Keyed by the STORE key, not `record.key`. The engine layer writes under
    // `<session key>#engine` while the record inside still carries the bare
    // session key, so keying by the latter both collides the pty and engine
    // records for one tab and fails the prune test below — deleting the entry
    // on the same sweep that created it, and re-firing the same death on every
    // sweep forever (duplicate plugin events, an Attention Inbox episode that
    // goes unread again each time anything else writes the file).
    for (const [storeKey, record] of Object.entries(records)) {
      if (seen.get(storeKey) === record.at) continue
      seen.set(storeKey, record.at)
      // Absorb silently until the baseline exists — same first-snapshot rule
      // as the start-up read below. Losing one notification to a daemon that
      // booted during an unreadable moment beats announcing fifty deaths that
      // already happened.
      if (!baselined) continue
      host.handleUiReport({ kind: "session.exited", ...exitReport(record) })
      publishDeath(record)
    }
    baselined = true
    // The file caps at 50 records; prune dropped keys so `seen` tracks it.
    for (const key of seen.keys()) if (!(key in records)) seen.delete(key)
  }

  /** Turn a death record into the tab's `dead` activity state + Inbox item. */
  const publishDeath = (record: PtyExitRecord): void => {
    const registry = opts.activity
    if (!registry && !opts.inbox) return
    const death = engineDeathOf(record)
    if (!death) return
    const { taskId, tabId, exit, at } = death
    registry?.recordEngineDeath(taskId, tabId, exit, at)
    opts.inbox
      ?.recordEngineDeath(taskId, tabId, { exit }, at)
      .catch((err) => opts.log?.(`pty-exit inbox: ${String(err)}`))
  }

  // Watch BEFORE the baseline read: the trigger's
  // baseline stamp is taken synchronously in here, so a crash record
  // written before it lands in the baseline below (predates this daemon)
  // and one written after it flips the stamp and sweeps — a record can
  // never fall between the two and lose its `session.exited` forever.
  const stop = startFileWatchTrigger({
    filePath: path,
    debounceMs: DEBOUNCE_MS,
    onTrigger: sweep,
    onError: (err) => opts.log?.(`pty-exit watch: ${String(err)}`),
  })
  // Baseline: everything already on disk predates this daemon. An unreadable
  // file here leaves `baselined` false, and the first sweep that CAN read it
  // takes the baseline instead — never an empty one.
  const initial = readPtyExitStore(path)
  if (initial.readable) {
    for (const [storeKey, record] of Object.entries(initial.records)) seen.set(storeKey, record.at)
    baselined = true
  }
  return stop
}

/**
 * One death record as the tab + exit the activity badge and the Attention
 * Inbox speak. Null when the key names no tab (task-level records have
 * nothing to badge) or the timestamp is unparseable — a death with no clock
 * can't be arbitrated against a hook claim, and guessing `now` would let an
 * OLD record bury a live engine.
 *
 * Shared with the observer's boot reconciler, which re-publishes a badge this
 * daemon's in-memory registry never saw: both must caption the same death the
 * same way.
 */
export function engineDeathOf(record: PtyExitRecord): {
  taskId: string
  tabId: string
  exit: { code: number | null; signal: string | null; lastLine?: string }
  at: number
} | null {
  const match = KEY_RE.exec(record.key)
  const taskId = match?.[1]
  const tabId = match?.[2]
  if (!taskId || !tabId) return null
  const at = Date.parse(record.at)
  if (!Number.isFinite(at)) return null
  const lastLine = lastErrorLine(record.tail)
  return { taskId, tabId, exit: { code: record.code, signal: record.signal, ...(lastLine ? { lastLine } : {}) }, at }
}

/**
 * The one line that explains a death.
 *
 * The last non-blank line is right for a PTY-layer record, where the dying
 * process really did write last — the 403 / auth / quota text. It is wrong
 * for an ENGINE-layer one: keepAlive `exec`s a login shell AFTER printing its
 * banner, so the tail ends in that shell's prompt, and "your agent died" got
 * captioned with a fragment of someone's zsh theme (broken Nerd Font
 * surrogate pairs included) while the cause sat two lines above. The banner
 * is a string Rove itself printed, so it can be matched exactly rather than
 * trying to recognise "a prompt" generically — prefer it wherever the tail
 * has one.
 */
export function lastErrorLine(tail: readonly string[]): string | undefined {
  let last: string | undefined
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? "").trim()
    if (line.length === 0) continue
    if (ENGINE_EXIT_BANNER.test(line)) return line
    last ??= line
  }
  return last
}

function exitReport(record: PtyExitRecord): { taskId?: string; detail: Record<string, unknown> } {
  const match = KEY_RE.exec(record.key)
  return {
    ...(match?.[1] ? { taskId: match[1] } : {}),
    detail: {
      key: record.key,
      ...(match?.[2] ? { tabId: match[2] } : {}),
      pid: record.pid,
      code: record.code,
      signal: record.signal,
      exitedAt: record.at,
      tail: record.tail,
    },
  }
}
