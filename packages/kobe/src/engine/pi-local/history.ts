/**
 * The pi family's session store: where a session lives, and how a worktree
 * maps to its sessions.
 *
 * Layout (identical in pi 0.80.6 and omp 18.1.17):
 *
 *   <agentDir>/sessions/<encoded-cwd>/<ISO timestamp>_<session uuid>.jsonl
 *
 * `<agentDir>` is `~/.pi/agent` / `~/.omp/agent` unless `PI_CODING_AGENT_DIR`
 * says otherwise (`../vendor-home.ts`).
 *
 * The DIRECTORY NAME is the unstable part, and the two CLIs disagree:
 *
 *   pi   writes the absolute form: `--<abs path, `/`→`-`>--`
 *        (its `getDefaultSessionDirPath`, verbatim).
 *   omp  writes a HOME-relative form when the cwd is under `$HOME`
 *        (`-<rel>`) or the temp root (`-tmp-<rel>`), and falls back to the
 *        absolute form outside both — but its own store still contains
 *        absolute-named dirs written by earlier versions (verified against
 *        `~/.omp/agent/sessions` on 2026-09-11, where a session made in
 *        `/tmp/...` landed in `--private-tmp-...--`), and 17.2.5–17.2.8 used
 *        a hashed name it later migrated away from.
 *
 * So the reader derives EVERY name those rules can produce for one worktree
 * and unions them. All candidates describe the SAME directory, so this cannot
 * mix two worktrees together; it can only miss one written by a future
 * encoder, which degrades to "no history" rather than to wrong history.
 */

import { realpathSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import type { Message } from "@/types/engine"
import { readTextFileIfRegular } from "../file-bounds.ts"
import { vendorAgentDir } from "../vendor-home.ts"
import { parsePiSessionRaw } from "./history-parse.ts"

/** The pi-family vendors this store serves. */
export type PiStoreVendor = "pi" | "omp"

export interface PiHistoryDeps {
  home(): string
  env(name: string): string | undefined
  tmpdir(): string
  /** Canonical path, falling back to the input when it cannot be resolved. */
  realpath(p: string): string
  readdir(p: string): Promise<readonly string[]>
  stat(p: string): Promise<{ readonly mtimeMs: number; readonly isFile: boolean } | null>
  readFile(p: string): Promise<string | null>
}

const defaultPiHistoryDeps: PiHistoryDeps = {
  home: () => homedir(),
  env: (name) => process.env[name],
  tmpdir: () => tmpdir(),
  realpath: (p) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  },
  readdir: async (p) => readdir(p),
  stat: async (p) => {
    try {
      const s = await stat(p)
      return { mtimeMs: s.mtimeMs, isFile: s.isFile() }
    } catch {
      return null
    }
  },
  readFile: (p) => readTextFileIfRegular(p),
}

/** One session file on disk. */
interface PiSessionFile {
  readonly sessionId: string
  readonly path: string
  readonly mtimeMs: number
}

/** `<agentDir>/sessions`. */
function piSessionsRoot(vendor: PiStoreVendor, deps: PiHistoryDeps = defaultPiHistoryDeps): string {
  return path.join(vendorAgentDir(vendor, { env: deps.env, home: deps.home }), "sessions")
}

/** A path encoded the way BOTH CLIs encode the absolute form. */
function encodeAbsolute(p: string): string {
  return `--${p.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
}

/**
 * omp's relative form, verbatim from its `encodeRelativeSessionDirName`: the
 * separator is inserted only when the prefix does not already end in one
 * (`-` + `i/kobe` → `-i-kobe`, not `--i-kobe`).
 */
function encodeRelative(prefix: string, relative: string): string {
  const encoded = relative.replace(/[/\\:]/g, "-")
  if (!encoded) return prefix
  return prefix.endsWith("-") ? `${prefix}${encoded}` : `${prefix}-${encoded}`
}

/** True when `p` is `root` itself or lives beneath it. */
function within(root: string, p: string): string | null {
  const rel = path.relative(root, p)
  if (rel === "") return ""
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel
}

/**
 * Every directory name the two encoders can produce for `worktree`, newest
 * rule first. Pure apart from the injected `realpath`.
 */
export function sessionDirNamesForWorktree(
  vendor: PiStoreVendor,
  worktree: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): readonly string[] {
  const resolved = deps.realpath(worktree)
  const names: string[] = []
  const add = (name: string) => {
    if (!names.includes(name)) names.push(name)
  }
  if (vendor === "omp") {
    const home = within(deps.realpath(deps.home()), resolved)
    if (home !== null) add(encodeRelative("-", home))
    const temp = within(deps.realpath(deps.tmpdir()), resolved)
    if (temp !== null) add(encodeRelative("-tmp", temp))
  }
  // Always last, and always present: pi's only form, and omp's fallback for a
  // path outside home and the temp root.
  add(encodeAbsolute(resolved))
  return names
}

/** The session uuid in a `<timestamp>_<uuid>.jsonl` filename. */
export function sessionIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(".jsonl")) return null
  const base = fileName.slice(0, -".jsonl".length)
  const separator = base.lastIndexOf("_")
  const id = separator >= 0 ? base.slice(separator + 1) : base
  return id.length > 0 ? id : null
}

/** Every session file for `worktree`, OLDEST-first. Never throws. */
async function worktreeSessionFiles(
  vendor: PiStoreVendor,
  worktree: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): Promise<readonly PiSessionFile[]> {
  const root = piSessionsRoot(vendor, deps)
  const out: PiSessionFile[] = []
  for (const dirName of sessionDirNamesForWorktree(vendor, worktree, deps)) {
    const dir = path.join(root, dirName)
    let entries: readonly string[]
    try {
      entries = await deps.readdir(dir)
    } catch {
      continue /* that encoder's directory was never written */
    }
    for (const entry of entries) {
      const sessionId = sessionIdFromFileName(entry)
      if (!sessionId) continue
      const file = path.join(dir, entry)
      const info = await deps.stat(file)
      if (!info?.isFile) continue
      out.push({ sessionId, path: file, mtimeMs: info.mtimeMs })
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs)
}

export async function listSessionIdsForWorktree(
  vendor: PiStoreVendor,
  worktree: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): Promise<readonly string[]> {
  return (await worktreeSessionFiles(vendor, worktree, deps)).map((f) => f.sessionId)
}

export async function latestTranscriptMtimeForWorktree(
  vendor: PiStoreVendor,
  worktree: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): Promise<number> {
  return (await worktreeSessionFiles(vendor, worktree, deps)).at(-1)?.mtimeMs ?? 0
}

/** Absolute path of `sessionId`'s transcript under `worktree`, or null. */
export async function transcriptPath(
  vendor: PiStoreVendor,
  sessionId: string,
  worktree: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): Promise<string | null> {
  const files = await worktreeSessionFiles(vendor, worktree, deps)
  return files.find((f) => f.sessionId === sessionId)?.path ?? null
}

/**
 * Locate `sessionId` anywhere in the store. The history contract's
 * `readHistory` carries no worktree (a session outlives the path it was made
 * in), so the search walks the session root — one `readdir` per directory and
 * a filename comparison, no file reads.
 */
export async function findSessionFile(
  vendor: PiStoreVendor,
  sessionId: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): Promise<string | null> {
  const root = piSessionsRoot(vendor, deps)
  let dirs: readonly string[]
  try {
    dirs = await deps.readdir(root)
  } catch {
    return null
  }
  for (const dir of dirs) {
    let entries: readonly string[]
    try {
      entries = await deps.readdir(path.join(root, dir))
    } catch {
      continue
    }
    const match = entries.find((entry) => sessionIdFromFileName(entry) === sessionId)
    if (match) return path.join(root, dir, match)
  }
  return null
}

/** Parse one session's transcript into neutral messages; `[]` when missing. */
export async function readHistory(
  vendor: PiStoreVendor,
  sessionId: string,
  deps: PiHistoryDeps = defaultPiHistoryDeps,
): Promise<readonly Message[]> {
  const file = await findSessionFile(vendor, sessionId, deps)
  if (!file) return []
  const raw = await deps.readFile(file)
  if (raw === null) return []
  return parsePiSessionRaw(file, raw, sessionId).messages
}
