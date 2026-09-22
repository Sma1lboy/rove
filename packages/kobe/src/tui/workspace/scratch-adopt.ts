/**
 * Pure scratch-task adoption decision over caller-canonicalized facts. A
 * scratch shell earns a project home only when its cwd is in a git repo AND a
 * coding harness is confirmed live (foreground walk; a bare `cd` is browsing).
 * Then it de-dupes against existing tasks so no second row is minted:
 *
 *   1. cwd at/inside a MANAGED task's worktree → FOLD into it as a tab.
 *      Checked first: `resolveMainRepoRoot` maps a linked worktree to the
 *      MAIN checkout, so rule 2 would misfold into the main task.
 *   2. cwd, or the repo root adopt would pin (a subdir shell), equals a
 *      main/dir task's directory → FOLD. Main rows win over dir rows.
 *   3. No owner → adopt into the repo; an UNFAMILIAR repo also gets the
 *      save-as-project hint (about savedRepos, not the move).
 *   4. No repo, or no live harness → stay in Scratch.
 */

import { pathWithin, samePath } from "@sma1lboy/kobe-daemon/path-identity"

/** A non-scratch task that could already own the shell's cwd. */
export interface ScratchOwnerTask {
  readonly id: string
  readonly kind: "main" | "task" | "dir"
  /** The task's directory (worktreePath), canonicalized like `cwd`. */
  readonly dir: string
}

export interface ScratchAdoptInput {
  /** The scratch shell's live cwd, canonicalized; null when unreadable. */
  readonly cwd: string | null
  /** The cwd's repo MAIN root; null outside a git work tree or unreadable. */
  readonly repoRoot: string | null
  readonly harnessLive: boolean
  /** Known project roots: savedRepos + every existing task's repo. */
  readonly knownRepos: ReadonlySet<string>
  readonly ownerTasks: readonly ScratchOwnerTask[]
}

export type ScratchAdoptDecision =
  | { readonly kind: "stay" }
  /** The cwd already belongs to `taskId` — fold the shell in, mint nothing. */
  | { readonly kind: "fold"; readonly taskId: string }
  | { readonly kind: "adopt"; readonly repo: string; readonly known: boolean }

export function decideScratchAdopt(input: ScratchAdoptInput): ScratchAdoptDecision {
  if (!input.repoRoot || !input.harnessLive) return { kind: "stay" }
  const owners = input.ownerTasks.filter((task) => task.dir !== "")
  if (input.cwd) {
    const cwd = input.cwd
    const managed = owners.find((task) => task.kind === "task" && pathWithin(task.dir, cwd) !== null)
    if (managed) return { kind: "fold", taskId: managed.id }
  }
  for (const kind of ["main", "dir"] as const) {
    const owned = owners.find(
      (task) => task.kind === kind && (samePath(task.dir, input.cwd) || samePath(task.dir, input.repoRoot)),
    )
    if (owned) return { kind: "fold", taskId: owned.id }
  }
  return {
    kind: "adopt",
    repo: input.repoRoot,
    known: [...input.knownRepos].some((repo) => samePath(repo, input.repoRoot)),
  }
}
