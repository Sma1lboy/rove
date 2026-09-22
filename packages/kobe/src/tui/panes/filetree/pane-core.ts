/** Framework-free file tree logic: pure functions over `Row`, plus one fs.watch helper. */

import { watch } from "node:fs"
import type { FileStatus } from "./git"
import type { Row } from "./rows"

/** Theme token, not a color, so a theme switch recolours existing rows. */
export function statusToken(s: FileStatus): "warning" | "success" | "error" | "textMuted" | "info" {
  switch (s) {
    case "M":
      return "warning"
    case "A":
      return "success"
    case "D":
      return "error"
    case "?":
      return "textMuted"
    case "R":
    case "C":
    case "U":
    case "T":
      return "info"
  }
}

/**
 * One sentence from a `git.ts` error (`git ls-files ... (cwd=/foo) exited with
 * code 128: fatal: …`). `t` is the caller's reactive translate fn.
 */
export function summarizeGitError(raw: string, t: (key: string) => string): string {
  const kind = classifyGitError(raw)
  if (kind) return t(`files.error.${kind}`)
  // Fallback: strip the leading `git <args> (cwd=...)` boilerplate.
  const colon = raw.indexOf(": ")
  if (colon >= 0 && raw.startsWith("git ")) return raw.slice(colon + 2).trim() || t("files.error.gitFailed")
  return raw.trim() || t("files.error.gitFailed")
}

type GitErrorKind = "notGitRepo" | "pathMissing" | "permissionDenied" | "gitNotInstalled"

/** The recognised shape of `raw`, or null when only the generic fallback fits. */
function classifyGitError(raw: string): GitErrorKind | null {
  const m = raw.toLowerCase()
  if (m.includes("not a git repository")) return "notGitRepo"
  if (m.includes("does not exist") || m.includes("enoent")) return "pathMissing"
  if (m.includes("permission denied") || m.includes("eacces")) return "permissionDenied"
  if (m.includes("git: not found") || m.includes("command not found")) return "gitNotInstalled"
  return null
}

/** Offer `r` only where a retry can change the answer; not for no-repo or no-git. */
export function gitErrorIsRetryable(raw: string): boolean {
  const kind = classifyGitError(raw)
  return kind !== "notGitRepo" && kind !== "gitNotInstalled"
}

/** `+N` / `-N` column widths (sign included) across visible rows, so `-` columns align. */
export type StatWidths = { added: number; deleted: number }

export function computeStatWidths(rows: readonly Row[]): StatWidths {
  let added = 0
  let deleted = 0
  for (const row of rows) {
    if (row.kind !== "status") continue
    if (row.added != null) added = Math.max(added, String(row.added).length + 1)
    if (row.deleted != null) deleted = Math.max(deleted, String(row.deleted).length + 1)
  }
  return { added, deleted }
}

/** Cells left for a Changes-tab path; tail-truncated so only leading dirs elide. */
export function computePathBudget(paneWidth: number, w: StatWidths): number {
  const stats = (w.added > 0 ? w.added + 1 : 0) + (w.deleted > 0 ? w.deleted + 1 : 0)
  // row padding (2) + status glyph (1) + gap (1) + stats + scrollbar (1) + slack (1).
  return Math.max(8, paneWidth - 6 - stats)
}

/** A missing count renders as blanks so columns stay aligned. */
export function statCell(value: number | null | undefined, width: number, sign: "+" | "-"): string {
  // U+2212 minus, as the sidebar's −N; same 1-cell width as "-".
  const glyph = sign === "-" ? "−" : sign
  return value == null ? " ".repeat(width) : `${glyph}${value}`.padStart(width)
}

export function toggleDir(expanded: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(expanded)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

/** Hierarchy keypress result; callers treat `null` as no-op. */
export type NavAction = { type: "expand" | "collapse"; path: string } | { type: "cursor"; index: number }

/** `l`: expand a closed dir, step into an open one, no-op on files — purely
 * structural so roaming never pulls a file into preview (`enter` opens).
 * Changes-tab untracked dirs (status rows with `fileCount`) behave the same. */
export function expandOrDescendAction(rows: readonly Row[], cursorIndex: number): NavAction | null {
  const row = rows[cursorIndex]
  if (!row) return null
  if (row.kind === "status") {
    if (row.fileCount == null) return null
    if (!row.expanded) return { type: "expand", path: row.path }
    return cursorIndex + 1 < rows.length ? { type: "cursor", index: cursorIndex + 1 } : null
  }
  if (row.kind !== "dir") return null
  if (!row.expanded && row.hasChildren) return { type: "expand", path: row.path }
  if (row.expanded && cursorIndex + 1 < rows.length) return { type: "cursor", index: cursorIndex + 1 }
  return null
}

/** `h`: collapse an open dir, else jump to the parent dir. Changes-tab
 * untracked dirs collapse too; other status rows are flat and no-op. */
export function collapseOrParentAction(rows: readonly Row[], cursorIndex: number): NavAction | null {
  const row = rows[cursorIndex]
  if (!row) return null
  if (row.kind === "dir" && row.expanded) return { type: "collapse", path: row.path }
  if (row.kind === "status") {
    return row.fileCount != null && row.expanded ? { type: "collapse", path: row.path } : null
  }
  if (row.kind !== "dir" && row.kind !== "file") return null
  const targetDepth = row.depth - 1
  if (targetDepth < 0) return null
  for (let j = cursorIndex - 1; j >= 0; j--) {
    const candidate = rows[j]
    if (!candidate) continue
    if (candidate.kind === "dir" && candidate.depth === targetDepth) return { type: "cursor", index: j }
  }
  return null
}

/** scrollTop keeping the cursor visible (rows are height 1, so y = index); null = don't scroll. */
export function followScrollTop(scrollTop: number, viewportHeight: number, cursorIndex: number): number | null {
  if (viewportHeight <= 0) return null
  if (cursorIndex < scrollTop) return cursorIndex
  if (cursorIndex >= scrollTop + viewportHeight) return cursorIndex - viewportHeight + 1
  return null
}

/** `.git` internals and node_modules churn are noise. */
export function watchEventRelevant(filename: string): boolean {
  if (filename === ".git" || filename.startsWith(".git/") || filename.startsWith(".git\\")) return false
  if (filename.startsWith("node_modules/") || filename.startsWith("node_modules\\")) return false
  return true
}

type EventedWatcher = ReturnType<typeof watch> & { on(event: "error", listener: (err: Error) => void): void }

/**
 * Recursive worktree watch, trailing debounce; returns a disposer. Errors
 * degrade to manual `r`. Callers honor `ROVE_FILETREE_WATCH=0` for repos too
 * big to watch.
 *
 * Known window, deliberately open: macOS FSEvents arms asynchronously, so a
 * write right after this call may be missed. Stat-polling a whole worktree
 * (as the daemon's single-file watchers do) is disproportionate for a
 * best-effort pane; a miss is stale until the next event or `r`.
 */
export function watchWorktree(path: string, onChange: () => void, debounceMs = 500): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let watcher: EventedWatcher | null = null
  try {
    watcher = watch(path, { recursive: true }, (_event, filename) => {
      if (filename == null) return
      if (!watchEventRelevant(filename.toString())) return
      if (debounceTimer != null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        onChange()
      }, debounceMs)
    }) as EventedWatcher
    watcher.on("error", () => {
      // Swallowed: `r` is the escape hatch.
    })
  } catch {
    // Unwatchable path: manual refresh only.
  }
  return () => {
    if (debounceTimer != null) clearTimeout(debounceTimer)
    if (watcher != null) watcher.close()
  }
}
