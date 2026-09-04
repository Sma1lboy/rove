/**
 * Who is allowed to become a PROJECT — the one gate every path that mints a
 * `kind:"main"` row or a `savedRepos` entry passes through.
 *
 * The sidebar's project list grew to 12 rows on a machine whose `savedRepos`
 * held 2. `ensureMainTask` is called by `createTask`, by the worktree
 * coordinator, by the issue-chat flow and by quick-fork, and none of them
 * asked whether the path deserved a permanent row: test fixtures under
 * `/tmp`, a repo inside `.dev-sandbox`, and a checkout nested in Rove's own
 * worktrees dir all became permanent sidebar entries. Worse, they became
 * UNREMOVABLE — `task.delete` refuses a main row ("remove the repo from
 * saved repos instead") while `rove remove` refuses a repo that was never in
 * `savedRepos`, which is precisely the set these rows belong to.
 *
 * Validation is NOT the caller's job: of the eight call sites, exactly one
 * would remember. So the rule lives here and the mutators apply it
 * themselves — a caller cannot forget a check it does not perform.
 *
 * Deliberately NOT a taste filter: "I'm not working on codefox right now" is
 * the user's Forget action, not this function's call. It rejects only paths
 * structurally incapable of being someone's project — throwaway directories,
 * and Rove's own state.
 *
 * And it is stricter about a project Rove INFERRED than one the user asked
 * for by name (see {@link ProjectIntent}). Every leaked row was inferred; a
 * `rove add` on a `/tmp` checkout is a deliberate, reversible choice, and
 * banning it would also ban every test that builds its fixture repo there.
 *
 * Pure path logic, no fs and no import of `repos.ts` (which imports THIS
 * module). The one filesystem question — "is this a git repo" — is injected
 * by the caller, which also keeps the `git` subprocess out of bulk scans.
 */

import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { homeDir, legacyKobeStateDir, roveStateDir } from "../env.ts"

/** Why a path may not become a project. `null` = eligible. */
export type ProjectRejection = "notAbsolute" | "notGitRepo" | "temporary" | "roveInternal" | "insideSandbox"

/**
 * Path segments that can never hold a durable project.
 *
 * Matched by SEGMENT rather than by prefix: `.dev-sandbox` lives inside the
 * Rove checkout, so a prefix rule would hard-code this repo's location, and
 * an agent running `dev:sandbox` from a worktree produces a different
 * absolute path every time.
 */
const THROWAWAY_SEGMENTS = new Set([".dev-sandbox", ".scratch"])

/** True for a synthetic remote-project key. One `startsWith`, duplicated
 *  from `repos.ts` rather than imported so this module stays out of the
 *  cycle — `repos.ts` calls into here. */
function isRemoteKey(key: string): boolean {
  return key.startsWith("ssh://")
}

/** Is `candidate` at or below `root`? Pure string comparison on resolved
 *  paths — no fs access, so it answers the same way for a directory that has
 *  since been deleted. */
function isInside(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/**
 * Rove's own state directories — `~/.rove` (worktrees, plugins, issue
 * assets), the pre-rename `~/.kobe`, and the config dir. A repo checked out
 * INSIDE a task worktree is the clearest case: it is a fixture some test
 * created under the worktree it was handed, and it dies with that task.
 */
function roveInternalRoots(): readonly string[] {
  return [roveStateDir(), legacyKobeStateDir(), join(homeDir(), ".config", "rove")]
}

/* Checked BEFORE the `temporary` rule: a test that redirects `ROVE_HOME_DIR`
 * into a tmpdir puts Rove's own state under `/tmp`, and reporting that as
 * "temporary" would hide the more specific reason. */

/**
 * How the path was offered, which decides how strict the gate is.
 *
 *   - `"explicit"` — the user asked for this exact path (`rove add`,
 *     `rove .` on a repo root). A checkout under `/tmp` is unusual but it is
 *     THEIR call, and `rove remove` can undo it.
 *   - `"derived"` — Rove inferred a project while doing something else
 *     (`createTask`, worktree adopt). This is where the leak lived: nobody
 *     asked for these rows, nobody saw them appear, and they outlived the
 *     tasks that spawned them.
 *
 * Only `temporary` differs between the two. Everything else — Rove's own
 * state dir, a sandbox path, a non-repo — is wrong under any intent.
 */
export type ProjectIntent = "explicit" | "derived"

/**
 * Why `absPath` may not become a project, considering PATH SHAPE only.
 *
 * Structural rejections are deliberately decided before any filesystem
 * question, so a fixture that has already been deleted still reports
 * `temporary` — the answer a cleanup scan needs — rather than `notGitRepo`,
 * which reads like a user's repo that merely moved.
 */
export function pathRejection(absPath: string, intent: ProjectIntent = "derived"): ProjectRejection | null {
  const raw = absPath.trim()
  if (!raw) return "notAbsolute"
  // A remote project's key is a synthetic ssh:// URL validated by the
  // remote-add flow — none of the local path rules can speak about it.
  if (isRemoteKey(raw)) return null
  if (!isAbsolute(raw)) return "notAbsolute"
  if (raw.split(sep).some((s) => THROWAWAY_SEGMENTS.has(s))) return "insideSandbox"
  for (const root of roveInternalRoots()) {
    if (isInside(raw, root)) return "roveInternal"
  }
  if (intent === "derived" && (isInside(raw, tmpdir()) || isInside(raw, "/tmp") || isInside(raw, "/private/tmp"))) {
    return "temporary"
  }
  return null
}

/**
 * The full gate: path shape plus "is it actually a git repo".
 *
 * `isRepo` is injected (callers pass `isGitRepo` from `repos.ts`) so this
 * module stays import-free of the module that calls it, and so a scan over
 * stale records can skip the subprocess by omitting it.
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
