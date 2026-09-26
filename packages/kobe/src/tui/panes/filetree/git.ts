/**
 * Git reads for the file tree pane: {@link listFiles} (gitignore-respecting
 * file list) and {@link statusFiles} (porcelain status + line counts).
 *
 * Kept apart from `src/orchestrator/worktree/git.ts`, which carries worktree
 * lifecycle invariants (`GitCommandError` etc.) a pane must not couple to.
 *
 * - Git runs through `src/worktree/content.ts`, so local and remote worktrees
 *   share one ExecHost-backed read path. Args are always an array, never a shell string.
 * - `cwd` is required: tasks run in different worktrees concurrently, so never `process.cwd()`.
 * - Non-zero exit throws, so the pane shows an error state instead of stale data.
 */

import { parseNumstatRows, parsePorcelainRows, unquoteGitPath } from "@/lib/git-parsers"
import { readWorktreeFile, runWorktreeGit } from "../../../worktree/content.ts"

/**
 * Which diff the Changes tab shows:
 *   - `working`: uncommitted work only (`git status` / `diff HEAD`).
 *   - `branch`:  `git diff <base>...HEAD`. Engines commit when green, so a
 *                finished task's whole output only shows up here.
 */
export type GitScope = "working" | "branch"

/** `git status` two-char code collapsed to one char. `T` = typechange (file <-> symlink). */
export type FileStatus = "M" | "A" | "D" | "?" | "R" | "C" | "U" | "T"

/** A single row from `git status --porcelain`. */
export type StatusEntry = {
  /** Path relative to the worktree root. */
  path: string
  /** Single-char status indicator (see {@link FileStatus}). */
  status: FileStatus
  /** Lines added vs HEAD. `null` for binary or unknown (untracked
   * counted via wc, see {@link statusFiles}). */
  added?: number | null
  /** Lines deleted vs HEAD. `null` for binary or unknown. */
  deleted?: number | null
  /** Untracked DIRECTORY rows only (path ends `/`): the untracked files
   * beneath it, rendered when the row is expanded. */
  children?: StatusEntry[]
}

/** A row from `git diff HEAD --numstat -z`. */
export type NumstatEntry = {
  path: string
  /** `null` for binary files (git emits `-`). */
  added: number | null
  /** `null` for binary files (git emits `-`). */
  deleted: number | null
}

/** Throws on non-zero exit. */
async function runGit(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
  if (!cwd) throw new Error("git(): cwd is required")
  const result = await runWorktreeGit(cwd, args, { signal })
  const exitCode = result.status ?? -1
  if (exitCode !== 0) {
    const stderr = (result.stderr ?? "").trim()
    const stdout = (result.stdout ?? "").trim()
    throw new Error(
      `git ${args.join(" ")} (cwd=${cwd}) exited with code ${exitCode}: ${stderr || stdout || "(no output)"}`,
    )
  }
  return result.stdout ?? ""
}

/** Tracked + untracked-not-ignored files, worktree-relative, de-duplicated and sorted. */
export async function listFiles(worktreePath: string, signal?: AbortSignal): Promise<string[]> {
  const out = await runGit(
    ["ls-files", "--cached", "--others", "--exclude-standard", "--full-name"],
    worktreePath,
    signal,
  )
  // git octal-escapes non-ASCII path bytes by default (`文档/笔记.md` arrives
  // as `"\346\226\207…"`, quotes and all), so unquote like the porcelain parser.
  const lines = out.split("\n").map((l) => unquoteGitPath(l.replace(/\r$/, "")))
  // --cached + --others can list the same file twice during merges.
  const set = new Set<string>()
  for (const line of lines) {
    if (line.length > 0) set.add(line)
  }
  return Array.from(set).sort()
}

/**
 * `git status --porcelain` rows (see {@link parseStatusEntries}) with +/-
 * counts merged from `git diff HEAD --numstat`; untracked files are counted on
 * disk. Count failures leave cells blank.
 */
export async function statusFiles(worktreePath: string, signal?: AbortSignal): Promise<StatusEntry[]> {
  // git collapses a FULLY-untracked directory into one `?? dir/` row (never one
  // that also holds tracked files). Keep it collapsed so an untracked asset dump
  // doesn't drown tracked changes; its files attach as expandable `children`.
  const out = await runGit(["status", "--porcelain"], worktreePath, signal)
  const entries = parseStatusEntries(out)
  let stats: Map<string, { added: number | null; deleted: number | null }> = new Map()
  try {
    const diffOut = await runGit(["diff", "--no-color", "--numstat", "-z", "HEAD"], worktreePath, signal)
    stats = new Map(parseNumstat(diffOut).map((n) => [n.path, { added: n.added, deleted: n.deleted }]))
  } catch {
    // Unborn branch: no HEAD to diff. Every tracked change is staged then, so
    // the staged diff gives real counts; if that fails too, cells stay blank.
    try {
      const cachedOut = await runGit(["diff", "--no-color", "--numstat", "-z", "--cached"], worktreePath, signal)
      stats = new Map(parseNumstat(cachedOut).map((n) => [n.path, { added: n.added, deleted: n.deleted }]))
    } catch {
      stats = new Map()
    }
  }
  const merged = entries.map((e) => {
    const s = stats.get(e.path)
    if (s) return { ...e, added: s.added, deleted: s.deleted }
    return e
  })
  // On failure the dir row stays bare (no children, no count) — still valid.
  if (merged.some(isUntrackedDir)) {
    try {
      const others = (await runGit(["ls-files", "--others", "--exclude-standard", "--full-name"], worktreePath, signal))
        .split("\n")
        .filter((l) => l.length > 0)
      attachUntrackedChildren(merged, others)
    } catch {
      // ls-files failed — dir rows render without a count.
    }
  }
  // Untracked files never appear in `git diff --numstat`: count lines on disk
  // (all added, 0 deleted), in parallel so a big drop doesn't serialize reads.
  const untracked: StatusEntry[] = []
  for (const e of merged) {
    if (e.status !== "?") continue
    if (e.children) untracked.push(...e.children)
    else if (e.added == null && !e.path.endsWith("/")) untracked.push(e)
  }
  if (untracked.length > 0) {
    await Promise.all(
      untracked.map(async (e) => {
        const added = await countAddedLines(worktreePath, e.path, signal)
        if (added != null) {
          e.added = added
          e.deleted = 0
        }
      }),
    )
  }
  // Roll children's counts up onto the dir row. All-binary children leave it blank.
  for (const e of merged) {
    if (!e.children) continue
    let sum = 0
    let counted = false
    for (const c of e.children) {
      if (c.added != null) {
        sum += c.added
        counted = true
      }
    }
    if (counted) {
      e.added = sum
      e.deleted = 0
    }
  }
  return merged
}

/** An untracked-directory status row (default-mode `?? dir/`). */
function isUntrackedDir(e: StatusEntry): boolean {
  return e.status === "?" && e.path.endsWith("/")
}

/** Mutates each untracked-dir entry in place, attaching the `ls-files --others` paths beneath it. */
export function attachUntrackedChildren(entries: StatusEntry[], others: readonly string[]): void {
  for (const e of entries) {
    if (!isUntrackedDir(e)) continue
    e.children = others.filter((p) => p.startsWith(e.path)).map((p) => ({ path: p, status: "?" as const }))
  }
}

/** How long a resolved base is reused across pane mounts, i.e. task switches. */
const BASE_TTL_MS = 5 * 60_000

type ResolvedBase = {
  base: string | null
  /** HEAD sha the answer was computed against; `undefined` when it came from an `origin/*` rung, which HEAD can't change. */
  head?: string | null
}

const baseCache = new Map<string, ResolvedBase & { at: number }>()

/** Test seam. */
export function resetBaseCache(): void {
  baseCache.clear()
}

/**
 * Base ref for the Branch scope. Order: `prBaseRef` (from `task.prStatus`, the
 * only persisted base), `origin/HEAD`, `origin/main` / `origin/master` (as
 * `daemon-worktree-adapter`'s `defaultRef`), then LOCAL `main` / `master` so a
 * remoteless repo's committed work is still reachable. `null` when nothing
 * resolves (orphan branch, or the default branch is checked out here); the
 * caller stays in working scope and says so.
 *
 * Memoised per worktree for {@link BASE_TTL_MS}: the pane resolves on every
 * mount, and the ladder is up to six `git` spawns. A local answer depends on
 * HEAD (a first commit makes `main` a base), so it is reused only while
 * `rev-parse HEAD` still matches.
 */
export async function resolveBase(
  worktreePath: string,
  prBaseRef?: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (prBaseRef && prBaseRef.trim().length > 0) return prBaseRef.trim()
  const hit = baseCache.get(worktreePath)
  if (hit && Date.now() - hit.at < BASE_TTL_MS) {
    if (hit.head === undefined) return hit.base
    if ((await revParse("HEAD", worktreePath, signal)) === hit.head) return hit.base
  }
  const resolved = await resolveBaseUncached(worktreePath, signal)
  // An aborted ladder reads every rung as absent; its answer is not an answer.
  if (!signal?.aborted) baseCache.set(worktreePath, { ...resolved, at: Date.now() })
  return resolved.base
}

async function resolveBaseUncached(worktreePath: string, signal?: AbortSignal): Promise<ResolvedBase> {
  try {
    const head = (await runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], worktreePath, signal)).trim()
    if (head.length > 0) return { base: head }
  } catch {
    // No origin/HEAD (never fetched, or no remote) — fall through to guesses.
  }
  for (const guess of ["origin/main", "origin/master"]) {
    try {
      await runGit(["rev-parse", "--verify", "--quiet", guess], worktreePath, signal)
      return { base: guess }
    } catch {
      // rev-parse --verify exits non-zero when the ref is absent; try next.
    }
  }
  const head = await revParse("HEAD", worktreePath, signal)
  for (const guess of ["main", "master"]) {
    const sha = await revParse(guess, worktreePath, signal)
    // A local default that IS HEAD makes `main...HEAD` empty by construction.
    if (sha != null && sha !== head) return { base: guess, head }
  }
  return { base: null, head }
}

/** `git rev-parse --verify <ref>`, or `null` when the ref does not resolve. */
async function revParse(ref: string, worktreePath: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const out = (await runGit(["rev-parse", "--verify", "--quiet", ref], worktreePath, signal)).trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

/**
 * Branch scope: `git diff <base>...HEAD` (three-dot = vs merge-base, so later
 * commits on the base don't pollute the list), `--name-status` merged with
 * `--numstat` by path. Throws on a bad base so the pane shows its error state.
 */
export async function statusFilesBranch(
  worktreePath: string,
  base: string,
  signal?: AbortSignal,
): Promise<StatusEntry[]> {
  const range = `${base}...HEAD`
  const [nameStatusOut, numstatOut] = await Promise.all([
    runGit(["diff", "--no-color", "--name-status", range], worktreePath, signal),
    runGit(["diff", "--no-color", "--numstat", "-z", range], worktreePath, signal),
  ])
  const counts = new Map(parseNumstat(numstatOut).map((n) => [n.path, { added: n.added, deleted: n.deleted }]))
  const entries: StatusEntry[] = []
  for (const { status, path } of parseNameStatus(nameStatusOut)) {
    const c = counts.get(path)
    entries.push({ path, status, added: c?.added, deleted: c?.deleted })
  }
  return entries
}

/**
 * Parse `git diff --name-status`: `<X>\t<path>`, or `R|C<score>\t<old>\t<new>`
 * (keeps the NEW path). Statuses the pane doesn't colour are dropped.
 */
export function parseNameStatus(raw: string): { status: FileStatus; path: string }[] {
  const out: { status: FileStatus; path: string }[] = []
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    if (line.length === 0) continue
    const tab1 = line.indexOf("\t")
    if (tab1 < 0) continue
    const code = line[0]
    let path: string
    if (code === "R" || code === "C") {
      // R<score>\t<old>\t<new> — take the new (last) field.
      const tab2 = line.indexOf("\t", tab1 + 1)
      path = unquoteGitPath(tab2 < 0 ? line.slice(tab1 + 1) : line.slice(tab2 + 1))
    } else {
      path = unquoteGitPath(line.slice(tab1 + 1))
    }
    if (path.length === 0 || path.endsWith("/")) continue
    const status: FileStatus | null =
      code === "M" || code === "A" || code === "D" || code === "T"
        ? code
        : code === "R"
          ? "R"
          : code === "C"
            ? "C"
            : null
    if (status) out.push({ status, path })
  }
  return out
}

/**
 * Line count of an untracked file (newlines, plus an unterminated last line).
 * `null` for unreadable/binary files so the cell stays blank, not a wrong `+0`.
 */
async function countAddedLines(worktreePath: string, relPath: string, signal?: AbortSignal): Promise<number | null> {
  if (signal?.aborted) return null
  const text = await readWorktreeFile(worktreePath, relPath)
  if (text == null) return null
  // NUL byte => treat as binary; git wouldn't count its lines either.
  if (text.includes("\u0000")) return null
  if (text.length === 0) return 0
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++
  }
  if (!text.endsWith("\n")) count++
  return count
}

/**
 * `git diff --numstat -z` via the shared {@link parseNumstatRows}, which
 * unquotes and pairs renames so counts key by the same path the porcelain `R`
 * row reports. `origPath` is dropped.
 */
export function parseNumstat(raw: string): NumstatEntry[] {
  return parseNumstatRows(raw).map((r) => ({ path: r.path, added: r.added, deleted: r.deleted }))
}

/**
 * `git status --porcelain` via the shared {@link parsePorcelainRows} (which
 * unquotes and resolves `old -> new` renames), then: collapse `XY` to one
 * char, drop uncoloured statuses, skip non-untracked directory rows.
 */
export function parseStatusEntries(raw: string): StatusEntry[] {
  const out: StatusEntry[] = []
  for (const row of parsePorcelainRows(raw)) {
    let status: FileStatus
    if (row.x === "?" && row.y === "?") {
      status = "?"
    } else {
      // Prefer worktree side (Y), else index side (X): "M " (staged) reports M.
      const candidate = row.y !== " " ? row.y : row.x
      if (
        candidate === "M" ||
        candidate === "A" ||
        candidate === "D" ||
        candidate === "R" ||
        candidate === "C" ||
        candidate === "U" ||
        candidate === "T"
      ) {
        status = candidate
      } else {
        // Unknown status pair — skip rather than display garbage.
        continue
      }
    }
    const path = row.path
    if (path.length === 0) continue
    // Keep `?? dir/` ({@link statusFiles} attaches its children); any other dir row is garbage.
    if (path.endsWith("/") && status !== "?") continue
    out.push({ path, status })
  }
  return out
}
