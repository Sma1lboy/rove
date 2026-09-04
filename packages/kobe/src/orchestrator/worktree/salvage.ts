/**
 * Salvage: make a force-delete recoverable.
 *
 * `remove(path, { force: true })` runs `git worktree remove --force`, which
 * deletes uncommitted edits AND untracked files with no copy anywhere. Three
 * callers reach it without a fresh dirty check — the queued task deletion
 * (whose `force` was frozen a daemon restart ago), the scratch-shell teardown,
 * and the worktrees page's force retry on a row captured before the confirm.
 * Salvage runs first and writes what is about to be destroyed into the repo's
 * object database, so "gone" becomes "recoverable".
 *
 * Why not `git stash create`: it CANNOT capture untracked files. `-u` is
 * accepted and silently ignored (the resulting commit has two parents, no
 * untracked tree) — and a new file nobody has `git add`ed yet is exactly the
 * kind most easily lost. So the snapshot is built by hand:
 *
 *     GIT_INDEX_FILE=<throwaway> git add -A   → stages tracked edits + untracked
 *     git write-tree                          → a tree of the whole worktree
 *     git commit-tree <tree> -p HEAD          → a commit rooted at real history
 *     git update-ref refs/rove/salvage/<slug> → a named, gc-proof anchor
 *
 * `git add -A` honours `.gitignore` — which keeps `node_modules/` out, and
 * ALSO threw away real work: `HANDOFF.md`, `.scratch/**`, `.env*` and
 * `.rove/*` are all gitignored in this very repo. So a second, forced `git
 * add -f` pass adds back the ignored entries small enough to be a person's
 * work rather than a dependency tree ({@link smallIgnoredPaths}).
 *
 * The ref (not just the loose object) is the point: a dangling commit is
 * findable only via `git fsck` and expires with gc, while
 * `git for-each-ref refs/rove/salvage` lists every snapshot by branch and
 * timestamp — the two things a user who just lost work actually has.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import type { GitRunOpts, GitRunResult } from "./git.ts"
import { smallIgnoredPaths } from "./salvage-ignored.ts"

/** The git primitives salvage borrows from the manager. */
export interface SalvageDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
}

/** A recorded snapshot: the ref a user recovers from, and the commit it names. */
export interface SalvageRecord {
  readonly ref: string
  readonly commit: string
  /**
   * Paths the snapshot could NOT capture: submodules and nested worktrees.
   * `git add` stages those as a `160000` gitlink — a commit SHA, never the
   * files — so uncommitted work inside one is in neither the snapshot tree nor
   * the commit that SHA names, while the ref itself reports success. Empty for
   * an ordinary snapshot; non-empty is the caller's cue to say so, because the
   * recovery commands do not work for these paths.
   */
  readonly uncaptured: readonly string[]
}

/** The `160000` (gitlink) entries of `tree` — submodules and nested worktrees,
 *  recorded as a commit SHA rather than their contents. */
async function gitlinkPaths(git: (args: readonly string[]) => Promise<GitRunResult>, tree: string): Promise<string[]> {
  const out = await git(["ls-tree", "-r", tree])
  if (out.exitCode !== 0) return []
  return out.stdout
    .split("\n")
    .filter((line) => line.startsWith("160000 "))
    .map((line) => line.slice(line.indexOf("\t") + 1))
    .filter((p) => p.length > 0)
}

/** `refs/rove/salvage/<branch>-<utc-stamp>` — a ref name git accepts, keyed by
 *  the two things a user remembers: which branch, and roughly when. Exported
 *  so {@link anchorBranchTip} writes into the SAME namespace: a user who lost
 *  work has one place to look and one `for-each-ref` to run, whether the loss
 *  was a force-removed worktree or a squash-landed branch. */
export function salvageRef(branch: string | null, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const slug = (branch ?? "detached").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
  return `refs/rove/salvage/${slug || "detached"}-${stamp}`
}

/**
 * Snapshot everything in `worktreePath` that a force-remove would destroy.
 *
 * Returns null when there is nothing to save (clean worktree) or when the
 * snapshot could not be taken. NEVER throws: salvage is a safety net around
 * a delete the caller already asked for, so a failure here must not turn a
 * requested deletion into an error. A null return is the caller's cue to log
 * "no snapshot" rather than to abort.
 */
export async function salvageWorktree(
  deps: SalvageDeps,
  exec: ExecHost,
  worktreePath: string,
  now: Date = new Date(),
): Promise<SalvageRecord | null> {
  const git = (args: readonly string[]) => deps.runGit(exec, args, { cwd: worktreePath, allowFail: true })
  try {
    // Nothing uncommitted (tracked, untracked, OR salvageable-ignored) →
    // nothing a force-remove could destroy that HEAD doesn't already hold.
    //
    // `--porcelain` alone CANNOT answer that: it is blind to `.gitignore`d
    // entries, and `HANDOFF.md` / `.scratch/**` — the two places AGENTS.md
    // tells agents to keep cross-session reasoning — are gitignored in this
    // very repo. Returning here on an empty porcelain made the `add -f` pass
    // below (the whole point of `salvage-ignored.ts`) unreachable for exactly
    // the worktrees it exists for.
    const status = await git(["status", "--porcelain"])
    if (status.exitCode !== 0) return null
    const ignored = await smallIgnoredPaths(exec, worktreePath)
    if (status.stdout.trim().length === 0 && ignored.length === 0) return null

    // A throwaway index INSIDE the worktree's own git dir, so staging never
    // touches the real index and the file dies with the worktree either way.
    const indexPath = (await git(["rev-parse", "--git-path", "rove-salvage-index"])).stdout.trim()
    if (!indexPath) return null
    const withIndex = (args: readonly string[]) =>
      deps.runGit(exec, args, { cwd: worktreePath, allowFail: true, env: { GIT_INDEX_FILE: indexPath } })

    try {
      if ((await withIndex(["add", "-A"])).exitCode !== 0) return null
      // Second pass: the ignored entries that are a person's work rather than
      // build output. `-f` is what overrides `.gitignore`; without it the
      // first pass silently dropped them. Best-effort — a failure here leaves
      // the tracked+untracked snapshot the first pass already staged.
      if (ignored.length > 0) await withIndex(["add", "-f", "--", ...ignored])
      const tree = (await withIndex(["write-tree"])).stdout.trim()
      if (!tree) return null

      // Parent the snapshot on HEAD so `git show <ref>` diffs against the
      // real history. An unborn branch has no HEAD — commit a root instead
      // of losing the files.
      const head = (await git(["rev-parse", "HEAD"])).stdout.trim()
      const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
      const message = `rove salvage: force-removed worktree ${worktreePath}`
      const commitArgs = head ? ["commit-tree", tree, "-p", head, "-m", message] : ["commit-tree", tree, "-m", message]
      const commit = (await withIndex(commitArgs)).stdout.trim()
      if (!commit) return null

      const ref = salvageRef(branch && branch !== "HEAD" ? branch : null, now)
      if ((await git(["update-ref", ref, commit])).exitCode !== 0) return null
      // Read back what the tree actually holds. A submodule or nested worktree
      // staged as a `160000` gitlink is a promise the recovery commands cannot
      // keep, so the record says which paths it missed rather than letting the
      // ref imply it caught everything.
      return { ref, commit, uncaptured: await gitlinkPaths(git, tree) }
    } finally {
      // The index file lives in `.git/worktrees/<name>/`, which the removal
      // prunes anyway; clearing it keeps a failed salvage from leaving debris
      // when the caller's remove then also fails. Plain `rm` (not `git rm`,
      // which only unstages TRACKED paths) through the exec seam so a remote
      // worktree cleans up over the same ssh connection.
      await exec.run(["rm", "-f", indexPath], { cwd: worktreePath }).catch(() => undefined)
    }
  } catch {
    return null
  }
}
