/**
 * Who may become a PROJECT — the gate every path minting a `kind:"main"` row
 * or a `savedRepos` entry passes through. The mutators apply it themselves, so
 * no caller can forget it.
 *
 * Rows that slip through are UNREMOVABLE: `task.delete` refuses a main row
 * ("remove the repo from saved repos instead") while `rove remove` refuses a
 * repo never in `savedRepos`.
 *
 * Not a taste filter (that's the user's Forget action): it rejects only paths
 * structurally incapable of being a project — throwaway dirs and Rove's own
 * state. Stricter for INFERRED projects than named ones ({@link ProjectIntent}).
 *
 * Pure path logic; no import of `repos.ts` (which imports this). The "is it a
 * git repo" question is injected, keeping `git` out of bulk scans.
 */

import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathSyntax, pathWithin } from "@sma1lboy/kobe-daemon/path-identity"
import { homeDir, legacyKobeStateDir, roveStateDir } from "../env.ts"

/** Why a path may not become a project. `null` = eligible. */
export type ProjectRejection = "notAbsolute" | "notGitRepo" | "temporary" | "roveInternal" | "insideSandbox"

/**
 * Path segments that never hold a durable project. By SEGMENT, not prefix:
 * `.dev-sandbox` sits inside whichever checkout/worktree ran `dev:sandbox`.
 */
const THROWAWAY_SEGMENTS = new Set([".dev-sandbox", ".scratch"])

/** Synthetic remote-project key. Duplicated from `repos.ts` to stay out of its import cycle. */
function isRemoteKey(key: string): boolean {
  return key.startsWith("ssh://")
}

/** Is `candidate` at or below `root`? String-only, so a deleted directory answers the same. */
function isInside(candidate: string, root: string): boolean {
  return pathWithin(root, candidate) !== null
}

/**
 * Rove's own state dirs: `~/.rove` (worktrees, plugins, issue assets), legacy
 * `~/.kobe`, and the config dir. A repo inside a task worktree is a test
 * fixture that dies with the task.
 */
function roveInternalRoots(): readonly string[] {
  return [roveStateDir(), legacyKobeStateDir(), join(homeDir(), ".config", "rove")]
}

/**
 * How the path was offered:
 *
 *   - `"explicit"` — the user named it (`rove add`, `rove .` on a repo root);
 *     a `/tmp` checkout is their call and `rove remove` undoes it (tests build
 *     fixture repos there).
 *   - `"derived"` — Rove inferred it (`createTask`, worktree adopt); nobody
 *     sees these rows appear, and they outlive their tasks.
 *
 * Only `temporary` differs between the two.
 */
export type ProjectIntent = "explicit" | "derived"

/**
 * Rejection from PATH SHAPE only, decided before any fs question so a deleted
 * fixture still reports `temporary` (what a cleanup scan needs), not
 * `notGitRepo` (which reads like a moved user repo).
 */
export function pathRejection(absPath: string, intent: ProjectIntent = "derived"): ProjectRejection | null {
  const raw = absPath.trim()
  if (!raw) return "notAbsolute"
  // ssh:// keys are validated by the remote-add flow; local rules don't apply.
  if (isRemoteKey(raw)) return null
  const syntax = pathSyntax(raw)
  if (!syntax.isAbsolute(raw)) return "notAbsolute"
  if (
    syntax
      .normalize(raw)
      .split(syntax.sep)
      .some((s) => THROWAWAY_SEGMENTS.has(s))
  )
    return "insideSandbox"
  // Before `temporary`: a test with `ROVE_HOME_DIR` in a tmpdir would otherwise hide the specific reason.
  for (const root of roveInternalRoots()) {
    if (isInside(raw, root)) return "roveInternal"
  }
  if (intent === "derived" && (isInside(raw, tmpdir()) || isInside(raw, "/tmp") || isInside(raw, "/private/tmp"))) {
    return "temporary"
  }
  return null
}

/**
 * Path shape plus "is it a git repo". Omit `isRepo` (`isGitRepo` from
 * `repos.ts`) to skip the subprocess in a scan over stale records.
 */
export function projectRejection(
  absPath: string,
  isRepo?: (p: string) => boolean,
  intent: ProjectIntent = "derived",
): ProjectRejection | null {
  const shape = pathRejection(absPath, intent)
  if (shape) return shape
  const raw = absPath.trim()
  if (isRemoteKey(raw)) return null
  if (isRepo && !isRepo(raw)) return "notGitRepo"
  return null
}

/** One-line reason for a rejection — CLI stderr, daemon errors, toasts. */
export function rejectionReason(rejection: ProjectRejection): string {
  switch (rejection) {
    case "notAbsolute":
      return "not an absolute path"
    case "notGitRepo":
      return "not a git repository"
    case "temporary":
      return "inside a temporary directory"
    case "roveInternal":
      return "inside Rove's own state directory"
    case "insideSandbox":
      return "inside a sandbox or scratch directory"
  }
}
