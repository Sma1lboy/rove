/**
 * Foreground-process identity for a terminal tab — "what engine is
 * actually running in this shell right now", answered from the process
 * tree instead of the OSC window title.
 *
 * The OSC title is structurally wrong for this: an engine's title is
 * free-form activity text it writes for HUMANS ("✳ Claude Code" at launch,
 * then a summary of what it's doing), so a claude session whose summary
 * mentions "codex" identifies as codex — a substring collision, not an
 * identity.
 *
 * A process tree can't collide like that: we walk the PTY shell's
 * descendants and ask each one's ARGV[0] (the executable, never its
 * arguments) whether it is a registered engine binary. That also sees
 * through user wrappers — `claudecpa` is a zsh function running
 * `cc-switch start claude …`, whose own argv[0] is `cc-switch`, but its
 * child is the real `claude.exe`, and the walk keeps going.
 */

import { basename } from "node:path"
import type { VendorId } from "../types/vendor"
import { engineEntry, identifiableEngineIds } from "./registry"

/** One line of `ps -A -o pid=,ppid=,args=`. */
export type ProcRow = {
  readonly pid: number
  readonly ppid: number
  /** Full command line, argv joined by spaces (what `ps` prints). */
  readonly args: string
}

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
 * The vendor a command line IS, or null. Only the executable position
 * counts — scanning arguments is what made the title heuristic wrong
 * (`cc-switch start claude …` is cc-switch, not claude; its claude CHILD
 * is what identifies, and the tree walk finds that one).
 *
 * Asks about every id the registry can name state-free
 * ({@link identifiableEngineIds}), not just the built-ins: a running
 * OpenCode answering `null` here is not "no engine", it is this function
 * not having been asked about OpenCode — and every consumer of the walk
 * reads that `null` as a POSITIVE no-engine verdict.
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
 * The lineage half of "am I really running inside this tab":
 * `$KOBE_TASK_ID` is an ordinary env var and inherits down the whole
 * process tree, so a background daemon forked out of an engine tab keeps
 * that identity for as long as it lives. A pid chain can't be inherited —
 * a process that detached (ppid reparented to 1) simply stops reaching the
 * tab's shell, which is exactly the case we must refuse.
 *
 * The walk is bounded by the row count: a `ps` snapshot is a forest, but a
 * malformed/racy one could still hand us a ppid cycle.
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
 * Breadth-first hunt for an engine among `rootPid`'s descendants —
 * shallowest wins, so a wrapper's engine child is found before that
 * engine's own helper processes (claude spawns `claude bg-pty-host`
 * subprocesses; the session itself is nearer the shell).
 */
export function foregroundEngineIn(rows: readonly ProcRow[], rootPid: number): ForegroundEngine | null {
  const kids = childrenIndex(rows)
  const queue = [...(kids.get(rootPid) ?? [])]
  while (queue.length > 0) {
    const row = queue.shift()
    if (!row) break
    const vendor = vendorFromArgv(row.args)
    if (vendor) return { vendor, argv: row.args, pid: row.pid }
    queue.push(...(kids.get(row.pid) ?? []))
  }
  return null
}

/**
 * Is ANY engine process running under `rootPid`? The delivery gate's
 * question — is an agent still the pane's foreground process? kobe's
 * keepAlive wrapper keeps a tab's PTY alive after its engine exits,
 * so "session alive" never proves an engine is there — and pasting a prompt
 * into the fallback SHELL executes it as commands. Vendor-agnostic on
 * purpose: any engine may receive text (cross-vendor send is legitimate);
 * only a bare shell must not. `extraLaunch` supplies a custom engine's full
 * launch argv; both it and the process row are normalized through the same
 * wrapper/path parser before comparison.
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

/** Injectable so tests never shell out. */
export type PsSnapshot = () => Promise<string>

/**
 * A running `ps`: the text it will produce, and the kill the deadline needs.
 * Injectable separately from {@link PsSnapshot} so a test can stand up a child
 * that never exits — the failure this deadline exists for.
 */
export interface PsProcess {
  readonly text: Promise<string>
  kill(): void
}

export type PsSpawn = () => PsProcess

/**
 * `ps -A` answers in ~20ms on a healthy machine, so 5s only fires on a
 * genuinely stuck process table — wide enough to never cost a true answer.
 *
 * It has to be bounded at all because nothing downstream can time this out:
 * every caller wraps the probe in try/catch, which catches a THROW and not a
 * hang, so an unbounded await here freezes whichever gate asked until the
 * process is restarted.
 */
export const PS_PROBE_TIMEOUT_MS = 5_000

/**
 * The probe could not answer — distinct from "it answered, no engine". Callers
 * that report to a human must say "couldn't look", never invent an absence.
 */
export class PsProbeUnavailableError extends Error {
  constructor(reason: string) {
    super(`process probe unavailable: ${reason}`)
    this.name = "PsProbeUnavailableError"
  }
}

const bunPsSpawn: PsSpawn = () => {
  const proc = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,args="], { stdout: "pipe", stderr: "ignore" })
  return { text: new Response(proc.stdout).text(), kill: () => proc.kill() }
}

/** {@link psSnapshot} with its two seams exposed, for tests. */
export async function psSnapshotWith(spawn: PsSpawn, timeoutMs = PS_PROBE_TIMEOUT_MS): Promise<string> {
  const proc = spawn()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
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
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const psSnapshot: PsSnapshot = () => psSnapshotWith(bunPsSpawn)

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
    return foregroundEngineIn(parsePsSnapshot(await snapshot()), rootPid)
  } catch {
    return null
  }
}
