/**
 * Codex workspace trust. Codex gates a never-seen directory
 * behind its own trust prompt; the store is `~/.codex/config.toml` —
 * `[projects."<abspath>"] trust_level = "trusted"`. Pre-trusting a
 * Rove-created worktree is the same trust domain as the repo the user
 * already runs sessions in, and the only headless-viable answer.
 *
 * Append-only: a `[projects.*]` table at EOF attaches to nothing, so the
 * rest of the user's config is never parsed or rewritten.
 *
 * Concurrency: an unguarded read-check-append lets two spawns for the SAME
 * worktree (a retried launch, TUI and daemon at once) both append the
 * table. Duplicate TOML keys make codex
 * reject the ENTIRE config — every codex task on the machine fails, not
 * just the raced one. Two layers prevent that:
 *
 *   1. A lock file next to the config serializes Rove writers. The
 *      config is a user-home-level file, so the lock lives beside it in
 *      `~/.codex/`, never in a repo. The critical section is a
 *      read-plus-append of one small file — held for milliseconds.
 *   2. Self-heal under the lock: any duplicate `[projects."…"]` stanza
 *      in the EXACT shape we write (header line immediately followed by
 *      our trust line) is deduped — later copies dropped, first kept —
 *      before the header check. This backstops what the lock cannot:
 *      a stale lock left by a killed process, or codex's own rewrites.
 *      (`codex mcp add` and friends rewrite config.toml, but a codex
 *      session run never writes it — the engine doesn't race us; only
 *      user-run management commands do, and they don't take our lock.)
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const TRUST_LINE = 'trust_level = "trusted"'
const LOCK_NAME = "config.toml.rove.lock"
/**
 * Longest we'll wait for a rival Rove writer. Its critical section is
 * milliseconds, so this only ever elapses on a stale lock (holder
 * crashed) — after which we proceed WITHOUT the lock: correctness no
 * longer depends on it (the self-heal dedupes whatever a missed race
 * produced); it only spares us the repair.
 */
const LOCK_TIMEOUT_MS = 5_000
const LOCK_POLL_MS = 10

export function trustCodexWorktree(worktreePath: string, home: string = homedir()): void {
  const dir = path.join(home, ".codex")
  const file = path.join(dir, "config.toml")
  // JSON.stringify doubles as a TOML basic-string quoter for the path.
  const header = `[projects.${JSON.stringify(worktreePath)}]`
  mkdirSync(dir, { recursive: true })
  withConfigLock(path.join(dir, LOCK_NAME), () => {
    let text = readConfig(file)
    const healed = dedupeOurTrustStanzas(text)
    if (healed.changed) {
      text = healed.text
      writeFileSync(file, text)
    }
    if (text.includes(header)) return
    if (!existsSync(file)) writeFileSync(file, "")
    const lead = text.length > 0 && !text.endsWith("\n") ? "\n" : ""
    appendFileSync(file, `${lead}\n${header}\n${TRUST_LINE}\n`)
  })
}

function readConfig(file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch {
    // No config yet — the append below creates it.
    return ""
  }
}

/**
 * Drop later copies of any duplicate `[projects."…"]` stanza in the
 * exact shape we append (header line immediately followed by our trust
 * line). Those are the only duplicates Rove can create. Duplicates in
 * any other shape are the user's own content and are left verbatim —
 * TOML would reject them, but silently rewriting user content is worse
 * than leaving a parse error the user can see. The first occurrence of
 * a stanza is kept: identical text, identical meaning.
 */
function dedupeOurTrustStanzas(text: string): { text: string; changed: boolean } {
  const lines = text.split("\n")
  const seenHeaders = new Set<string>()
  const out: string[] = []
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith("[projects.")) {
      if (seenHeaders.has(line)) {
        if (lines[i + 1] === TRUST_LINE) {
          // Our stanza, duplicated by a missed race — drop header + body.
          changed = true
          i++
          continue
        }
        // Not our shape: keep it rather than mangle user content.
      } else {
        seenHeaders.add(line)
      }
    }
    out.push(line)
  }
  return { text: out.join("\n"), changed }
}

/**
 * Serialize Rove writers via atomic create-or-fail (`wx`): exactly one
 * contender holds the lock. The lock records the holder's PID for
 * forensics. Waits up to {@link LOCK_TIMEOUT_MS} for a live holder;
 * past that, runs `fn` unprotected (see the timeout's doc above).
 */
function withConfigLock(lockPath: string, fn: () => void): void {
  let fd: number | undefined
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      fd = openSync(lockPath, "wx")
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      if (Date.now() >= deadline) {
        fd = undefined
        break
      }
      sleepSync(LOCK_POLL_MS)
    }
  }
  if (fd === undefined) {
    fn()
    return
  }
  try {
    writeFileSync(fd, String(process.pid))
    fn()
  } finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    } catch {
      // Already unlinked (forced takeover raced us) — nothing to release.
    }
  }
}

/** Portable synchronous sleep — the trust path is sync end-to-end. */
function sleepSync(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // busy-wait; waits here are ~10ms
  }
}
