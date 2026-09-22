/**
 * `~/.rove/secrets.json` — the one file Rove keeps credentials in.
 *
 * Rove's habit, everywhere else, is not to hold anyone's keys: the engine
 * adapters DETECT the vendor's own login (`engine/account-detect.ts` reads
 * codex's auth file) and report it, so the credential stays where its owner
 * put it. That works because every engine ships a CLI that stores its own.
 * A classifier endpoint does not, which leaves a key with nowhere to live
 * but an environment variable — and a long-lived TUI cannot be handed one
 * after it started. Hence this file, and hence its narrow shape: a flat
 * string map, nothing else, no schema to grow.
 *
 * Three rules it exists to keep:
 *
 *   1. **The environment still wins.** `$TYPESAFE_API_KEY` set in the shell
 *      overrides whatever is stored, so CI and a one-off `KEY=… rove …` keep
 *      behaving the way anyone would expect them to.
 *   2. **Never beside the settings.** `state.json` is opened by `rove
 *      config`, hand-edited, and pasted whole into bug reports. A key that
 *      lived there would leak by ordinary helpfulness, not by mistake.
 *   3. **Never rendered.** No UI caller is handed a stored secret. They ask
 *      {@link secretStatus}, whose `hint` is a {@link secretHint} tail —
 *      enough to answer "is the right key in there", useless to anyone
 *      reading over a shoulder or a screen share.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { secretsPath } from "../env.ts"

/** How much of a key the hint shows. Enough to recognise, not to use. */
const HINT_TAIL = 4

function readAll(): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(secretsPath(), "utf8")
  } catch {
    // Absent is the normal state — nobody has stored a secret yet.
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v
    return out
  } catch {
    // Corrupt: treat as empty rather than throwing on a path that runs while
    // someone is creating a task. A bad file is replaced by the next write,
    // and the worst case is one classification that does not happen.
    return {}
  }
}

function writeAll(next: Record<string, string>): void {
  const path = secretsPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  // Mode on the TEMP file, not a chmod after the rename: between a 0644
  // create and a later chmod there is a window where the key is world
  // readable, and it is exactly the window an attacker would want.
  writeFileSync(tmp, JSON.stringify(next), { encoding: "utf8", mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * The stored value for `name`, or undefined. Callers that want the
 * environment to win should use {@link resolveSecret}.
 */
export function readSecret(name: string): string | undefined {
  const v = readAll()[name]
  return v?.trim() ? v.trim() : undefined
}

/**
 * The effective secret: the environment first, then the file. An env var set
 * to an EMPTY string counts as unset rather than as an override — that is
 * what `export FOO=` in a shell profile means in practice, and reading it as
 * "deliberately blank" would silently disable a key the user had saved.
 */
export function resolveSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[name]?.trim() || readSecret(name)
}

/** Where the effective secret came from — what the Settings row reports. */
export type SecretSource = "env" | "file" | "none"

export interface SecretStatus {
  readonly source: SecretSource
  /** Tail of the STORED value; empty when nothing is stored. */
  readonly hint: string
}

/**
 * Everything a settings row needs about one secret, from ONE read.
 *
 * Source and hint as separate calls meant two `readFileSync`s per render,
 * and a settings screen re-renders on every cursor move. The file is small
 * enough that neither was slow, which is exactly why it would never have
 * been noticed.
 */
export function secretStatus(name: string, env: NodeJS.ProcessEnv = process.env): SecretStatus {
  const stored = readAll()[name]?.trim()
  const hint = stored ? secretHint(stored) : ""
  if (env[name]?.trim()) return { source: "env", hint }
  return { source: stored ? "file" : "none", hint }
}

/**
 * A safe rendering of a stored secret: the last few characters, nothing
 * more. Enough to tell two keys apart when someone asks "did I paste the
 * production one"; useless on its own.
 */
export function secretHint(value: string): string {
  const v = value.trim()
  return v.length <= HINT_TAIL ? "…" : `…${v.slice(-HINT_TAIL)}`
}

/** Store (or, with an empty value, remove) one secret. */
export function writeSecret(name: string, value: string): void {
  const all = readAll()
  const v = value.trim()
  if (v) all[name] = v
  else delete all[name]
  if (Object.keys(all).length === 0) {
    // Nothing left to hold: take the file away rather than leaving an empty
    // object behind, so its absence keeps meaning "no secrets stored".
    try {
      unlinkSync(secretsPath())
    } catch (err) {
      // Already gone is the whole point — clearing a key nobody stored must
      // not CREATE the file it is supposed to remove. Anything else (a
      // permission failure, a read-only home) is real and belongs to the
      // caller: writing an empty object instead would report success and
      // fail again for the same reason.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err
    }
    return
  }
  writeAll(all)
}
