/**
 * Which engine is running in a tab's shell, answered from the process tree,
 * not the OSC title: a title is free-form text for humans, so a claude
 * session whose summary mentions "codex" would read as codex.
 *
 * The walk asks each descendant's ARGV[0] (never its arguments) whether it is
 * a registered engine binary, and sees through wrappers: `claudecpa` runs
 * `cc-switch start claude …` (argv[0] `cc-switch`), whose child is the real
 * `claude.exe`.
 */

import { basename } from "node:path"
import { recordSpawn } from "../lib/spawn-profile.ts"
import { loadStateFile } from "../state/store.ts"
import type { VendorId } from "../types/vendor"
import { type ProcRow, PsProbeUnavailableError } from "./process-rows.ts"
import { engineEntry, identifiableEngineIds } from "./registry"

export { type ProcRow, PsProbeUnavailableError } from "./process-rows.ts"

/** The live engine found running inside a tab's shell. */
export type ForegroundEngine = {
  readonly vendor: VendorId
  /** The command line as `ps` reports it — replayed on restart. */
  readonly argv: string
  readonly pid: number
}

/**
 * Interpreters/launchers that are never the identity themselves: their
 * argv[0] says nothing, the interesting name is the next token (`node
 * …/codex.js`) or a child process (`env FOO=1 claude`).
 */
const WRAPPERS = new Set(["node", "bun", "npx", "deno", "sh", "zsh", "bash", "env", "script"])

/** Strip the launcher suffixes a binary may carry (`claude.exe`). */
function binaryName(token: string): string {
  return basename(token).replace(/\.(exe|js|mjs|cjs)$/, "")
}

/** Resolve the executable identity from launch argv, through known wrappers. */
function executableNameFromArgv(argv: readonly string[]): string | null {
  for (const token of argv.slice(0, 8)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue
    const name = binaryName(token)
    if (WRAPPERS.has(name)) continue
    return name || null
  }
  return null
}

/**
 * The vendor a command line IS, or null. Only the executable position counts
 * (`cc-switch start claude …` is cc-switch; its claude CHILD identifies).
 *
 * Covers every id {@link identifiableEngineIds} can name, not just the
 * built-ins: consumers read `null` as a POSITIVE no-engine verdict.
 */
export function vendorFromArgv(commandLine: string): VendorId | null {
  const name = executableNameFromArgv(commandLine.trim().split(/\s+/))
  if (!name) return null
  // defaultCommand[0] is the launch binary; processNames covers engines
  // that rewrite their process title post-launch (kimi → `kimi-co`).
  return (
    identifiableEngineIds().find((v) => {
      const entry = engineEntry(v)
      return entry.defaultCommand[0] === name || entry.processNames?.includes(name) === true
    }) ?? null
  )
}

/** Parse `ps -A -o pid=,ppid=,args=` output; unparsable lines are skipped. */
export function parsePsSnapshot(text: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] })
  }
  return rows
}

function childrenIndex(rows: readonly ProcRow[]): Map<number, ProcRow[]> {
  const kids = new Map<number, ProcRow[]>()
  for (const row of rows) {
    const list = kids.get(row.ppid)
    if (list) list.push(row)
    else kids.set(row.ppid, [row])
  }
  return kids
}

/**
 * Is `ancestorPid` anywhere on `pid`'s parent chain (or `pid` itself)?
 *
 * The lineage half of "am I really inside this tab": `$KOBE_TASK_ID`
 * inherits into anything forked from the tab, including a detached daemon; a
 * pid chain does not (reparented to 1 → stops reaching the shell), which is
 * the case we must refuse.
 *
 * Bounded by row count: a racy snapshot can hold a ppid cycle.
 */
export function hasAncestor(rows: readonly ProcRow[], pid: number, ancestorPid: number): boolean {
  const parents = new Map(rows.map((r) => [r.pid, r.ppid]))
  let cur = pid
  for (let hops = 0; hops <= rows.length; hops++) {
    if (cur === ancestorPid) return true
    const next = parents.get(cur)
    if (next === undefined || next <= 1) return false
    cur = next
  }
  return false
}

/**
 * Launch binaries of the user's CUSTOM engine presets, keyed by the
 * executable name a `ps` row would carry.
 *
 * {@link vendorFromArgv} stops at {@link identifiableEngineIds} (state-free),
 * so user presets (`customEngineIds` + `engineCommand.<id>`) need this; a
 * null walk would cost a live custom-engine tab its turn detector, state dot
 * and name.
 *
 * Read from state.json, not registered at boot, because the walk runs in
 * three processes (TUI probe, daemon activity observer, `api inspect`) with
 * no shared registration step. One `readFileSync` per walk that finds no
 * built-in, never per `ps` row.
 */
function customEngineBinaries(): ReadonlyMap<string, VendorId> {
  const state = loadStateFile()
  const ids = state.customEngineIds
  const out = new Map<string, VendorId>()
  if (!Array.isArray(ids)) return out
  for (const id of ids) {
    if (typeof id !== "string" || id.trim().length === 0) continue
    const command = state[`engineCommand.${id}`]
    const argv = typeof command === "string" && command.trim().length > 0 ? command.trim().split(/\s+/) : [id]
    const name = executableNameFromArgv(argv)
    if (name) out.set(name, id)
  }
  return out
}

/** Shallowest descendant of `rootPid` that `identify` names, or null. */
function walkDescendants(
  rows: readonly ProcRow[],
  rootPid: number,
  identify: (args: string) => VendorId | null,
): ForegroundEngine | null {
  const kids = childrenIndex(rows)
  const queue = [...(kids.get(rootPid) ?? [])]
  while (queue.length > 0) {
    const row = queue.shift()
    if (!row) break
    const vendor = identify(row.args)
    if (vendor) return { vendor, argv: row.args, pid: row.pid }
    queue.push(...(kids.get(row.pid) ?? []))
  }
  return null
}

/**
 * Breadth-first hunt for an engine among `rootPid`'s descendants —
 * shallowest wins, so a wrapper's engine child is found before that
 * engine's own helper processes (claude spawns `claude bg-pty-host`
 * subprocesses; the session itself is nearer the shell).
 *
 * Custom presets are a SECOND pass: a preset usually wraps a real engine, and
 * the built-in underneath carries the adapter knowledge (history,
 * status-prefix rules, turn hints). The preset's binary answers only when the
 * tree names no built-in.
 */
export function foregroundEngineIn(rows: readonly ProcRow[], rootPid: number): ForegroundEngine | null {
  const builtin = walkDescendants(rows, rootPid, vendorFromArgv)
  if (builtin) return builtin
  const custom = customEngineBinaries()
  if (custom.size === 0) return null
  return walkDescendants(
    rows,
    rootPid,
    (args) => custom.get(executableNameFromArgv(args.trim().split(/\s+/)) ?? "") ?? null,
  )
}

/**
 * Is ANY engine process running under `rootPid`? The delivery gate: the
 * keepAlive wrapper keeps a PTY alive after its engine exits, and a prompt
 * pasted into the fallback SHELL runs as commands. Vendor-agnostic on
 * purpose (cross-vendor send is legitimate); only a bare shell must not
 * receive text. `extraLaunch` is a custom engine's launch argv, normalized by
 * the same wrapper/path parser as the rows.
 */
export function engineProcessIn(
  rows: readonly ProcRow[],
  rootPid: number,
  extraLaunch?: string | readonly string[],
): boolean {
  if (foregroundEngineIn(rows, rootPid)) return true
  const expected = extraLaunch
    ? executableNameFromArgv(typeof extraLaunch === "string" ? [extraLaunch] : extraLaunch)
    : null
  if (!expected) return false
  const kids = childrenIndex(rows)
  const queue = [...(kids.get(rootPid) ?? [])]
  while (queue.length > 0) {
    const row = queue.shift()
    if (!row) break
    const executable = executableNameFromArgv(row.args.trim().split(/\s+/))
    if (executable === expected) return true
    queue.push(...(kids.get(row.pid) ?? []))
  }
  return false
}

/**
 * Injectable so tests never shell out.
 *
 * `anchors`: each tab shell the walk descends from, plus the caller when it
 * checks its own ancestry. POSIX ignores them; Windows needs them to repair
 * links an exited npm shim took with it (see `win-process-snapshot.ts`).
 * Optional so zero-argument stubs still satisfy the type.
 */
export type PsSnapshot = (anchors?: readonly number[]) => Promise<string>

/**
 * A running `ps` and the kill the deadline needs; injectable so a test can
 * stand up a child that never exits.
 */
export interface PsProcess {
  readonly text: Promise<string>
  kill(): void
}

export type PsSpawn = () => PsProcess

/**
 * `ps -A` answers in ~20ms, so 5s only fires on a stuck process table.
 * Bounded because callers' try/catch catches a throw, not a hang: an
 * unbounded await freezes the asking gate until restart.
 */
export const PS_PROBE_TIMEOUT_MS = 5_000

const bunPsSpawn: PsSpawn = () => {
  recordSpawn("engine.foregroundWalk", ["ps", "-A", "-o", "pid=,ppid=,args="])
  const proc = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,args="], { stdout: "pipe", stderr: "ignore" })
  return { text: new Response(proc.stdout).text(), kill: () => proc.kill() }
}

/**
 * {@link psSnapshot} with its two seams exposed, for tests.
 *
 * Zero parseable rows is a FAILED probe, not an empty machine (`ps` itself is
 * always listed): it throws like the timeout, an "unknown" no gate may
 * restate as "no engine". Guards e.g. Git for Windows' Cygwin `ps`, which
 * rejects `-A` with empty stdout.
 */
export async function psSnapshotWith(spawn: PsSpawn, timeoutMs = PS_PROBE_TIMEOUT_MS): Promise<string> {
  const proc = spawn()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const text = await Promise.race([
      proc.text,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Kill first: an abandoned `ps` holding a pipe nobody reads is how a
          // one-off hang becomes a permanent leak in a long-lived daemon.
          try {
            proc.kill()
          } catch {
            /* already gone */
          }
          reject(new PsProbeUnavailableError(`ps did not answer within ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
    if (parsePsSnapshot(text).length === 0) throw new PsProbeUnavailableError("ps returned no usable rows")
    return text
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * One process-table snapshot, in `pid ppid args` text. POSIX runs `ps`;
 * win32 runs the CIM + ConPTY walk in `win-process-snapshot.ts`.
 */
export const psSnapshot: PsSnapshot = async (anchors) => {
  if (process.platform !== "win32") return psSnapshotWith(bunPsSpawn)
  const { defaultWinProcessProbe, winProcessSnapshot } = await import("./win-process-snapshot.ts")
  // Own budget (`WIN_PROBE_TIMEOUT_MS`): PowerShell + CIM is ~0.8s vs ~20ms.
  return winProcessSnapshot(anchors ?? [], defaultWinProcessProbe())
}

/**
 * The engine running under `rootPid` (a tab's PTY shell), or null when
 * the shell is just sitting at its prompt. Null on any `ps` failure —
 * an identity we can't read is "no engine", never a guess.
 */
export async function foregroundEngine(
  rootPid: number,
  snapshot: PsSnapshot = psSnapshot,
): Promise<ForegroundEngine | null> {
  try {
    return foregroundEngineIn(parsePsSnapshot(await snapshot([rootPid])), rootPid)
  } catch {
    return null
  }
}
