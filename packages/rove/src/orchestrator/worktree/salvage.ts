/**
 * Salvage: make a force-delete recoverable.
 *
 * `git worktree remove --force` deletes uncommitted edits AND untracked files.
 * Three callers reach it without a fresh dirty check — queued task deletion
 * (its `force` frozen a daemon restart ago), scratch-shell teardown, and the
 * worktrees page's force retry on a pre-confirm row. Salvage first writes what
 * is about to be destroyed into the repo's object database.
 *
 * Not `git stash create`: `-u` is silently ignored (two parents, no untracked
 * tree), and a never-added new file is the easiest to lose. Built by hand:
 *
 *     GIT_INDEX_FILE=<throwaway> git read-tree HEAD  → so git knows what's TRACKED
 *                                git add -A          → tracked edits + untracked
 *     git write-tree                                 → a tree of the whole worktree
 *     git commit-tree <tree> -p HEAD                 → a commit rooted at real history
 *     git update-ref refs/rove/salvage/<slug> <c> "" → a named, gc-proof anchor
 *
 * `git add -A` honours `.gitignore`, keeping `node_modules/` out but also real
 * work (`HANDOFF.md`, `.scratch/**`, `.env*`, `.rove/*` are gitignored in this
 * repo). A second `git add -f` pass restores ignored entries small enough to
 * be a person's work ({@link smallIgnoredPaths}).
 *
 * The ref is the point: a dangling commit is findable only via `git fsck` and
 * expires with gc; `git for-each-ref refs/rove/salvage` lists snapshots by
 * branch and timestamp — what a user who lost work remembers.
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
   * Paths NOT captured: submodules and nested worktrees, staged as a `160000`
   * gitlink (a SHA, never the files), so uncommitted work inside is lost while
   * the ref reports success. Non-empty = the caller must say recovery won't
   * cover these paths.
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

/**
 * A branch name as one ref-name component, keeping everything
 * `git check-ref-format` allows.
 *
 * Replaces only what git forbids — control chars, space, `~^:?*[\`, `..`,
 * `@{`, leading/trailing `.` or `-` — plus `/`, so every snapshot stays one
 * level under `refs/rove/salvage/`. UTF-8 survives intact (ref names are
 * bytes); an ASCII allowlist would collapse e.g. Chinese names to `detached`.
 *
 * `.lock` needs no handling: forbidden only at a component's END, and
 * `-<stamp>` always follows the slug.
 */
function branchRefSlug(branch: string | null): string {
  return (
    (branch ?? "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: git defines its refname rules over exactly these bytes.
      .replace(/[\u0000-\u0020\u007f~^:?*[\\/]+/g, "-")
      .replace(/@\{/g, "-")
      .replace(/\.{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "detached"
  )
}

/** `refs/rove/salvage/<branch>-<utc-stamp>`. Shared with {@link anchorBranchTip}
 *  so every lost-work snapshot is under one `for-each-ref`.
 *
 *  Preferred, not unique: the stamp resolves to the second and the slug is
 *  lossy (`feat/login` = `feat-login`); {@link createSalvageRef} avoids collisions. */
export function salvageRef(branch: string | null, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  return `refs/rove/salvage/${branchRefSlug(branch)}-${stamp}`
}

/**
 * Write `commit` under `preferred`, NEVER over a ref that already exists.
 *
 * `git update-ref <ref> <new>` overwrites unconditionally, and a batch delete
 * lands several force-removes in one second — the overwritten snapshot would
 * dangle while its caller was told the work was saved.
 *
 * An EMPTY `<oldvalue>` makes it create-only (git refuses "reference already
 * exists"); empty rather than the all-zero OID, which is hash-length
 * dependent. Numbered suffixes find the next free name. Returns the ref
 * written, or null.
 */
async function createSalvageRef(
  git: (args: readonly string[]) => Promise<GitRunResult>,
  preferred: string,
  commit: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const ref = attempt === 1 ? preferred : `${preferred}-${attempt}`
    if ((await git(["update-ref", ref, commit, ""])).exitCode === 0) return ref
  }
  return null
}

/**
 * Snapshot everything in `worktreePath` that a force-remove would destroy.
 *
 * Null when clean or when the snapshot failed — log "no snapshot", don't
 * abort. NEVER throws: it must not turn a requested deletion into an error.
 */
export async function salvageWorktree(
  deps: SalvageDeps,
  exec: ExecHost,
  worktreePath: string,
  now: Date = new Date(),
): Promise<SalvageRecord | null> {
  const git = (args: readonly string[]) => deps.runGit(exec, args, { cwd: worktreePath, allowFail: true })
  try {
    // Skip only when nothing tracked, untracked OR salvageable-ignored is
    // uncommitted. Porcelain alone is blind to `.gitignore`d entries like
    // `HANDOFF.md` / `.scratch/**`, which would make the `add -f` pass
    // unreachable for exactly the worktrees it exists for.
    const status = await git(["status", "--porcelain"])
    if (status.exitCode !== 0) return null
    // `"unknown"` degrades to a snapshot without ignored files: salvage never
    // fails the removal. The DELETE GATE (`manager-remove.ts`) reads the same
    // probe and must do the opposite.
    const probe = await smallIgnoredPaths(exec, worktreePath)
    const ignored = probe === "unknown" ? [] : probe
    if (status.stdout.trim().length === 0 && ignored.length === 0) return null

    // Throwaway index in the worktree's git dir: never touches the real index, dies with the worktree.
    const indexPath = (await git(["rev-parse", "--git-path", "rove-salvage-index"])).stdout.trim()
    if (!indexPath) return null
    const withIndex = (args: readonly string[]) =>
      deps.runGit(exec, args, { cwd: worktreePath, allowFail: true, env: { GIT_INDEX_FILE: indexPath } })

    // Parent on HEAD so `git show <ref>` diffs against real history; an unborn
    // branch gets a root commit instead of losing the files.
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim()
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()

    try {
      // Seed from HEAD first. With an EMPTY index every path counts as
      // untracked, so `.gitignore` makes `add -A` skip TRACKED files it covers
      // (a committed `dist/README.md`, `server.log` under `*.log`), and the
      // `add -f` pass can't restore them (`status --ignored` shows tracked
      // files as ` M`, never `!!`) — they'd be snapshotted as DELETIONS.
      if (head && (await withIndex(["read-tree", head])).exitCode !== 0) return null
      if ((await withIndex(["add", "-A"])).exitCode !== 0) return null
      // `-f` overrides `.gitignore` for person-sized ignored work. Best-effort:
      // failure keeps the tracked+untracked snapshot.
      if (ignored.length > 0) await withIndex(["add", "-f", "--", ...ignored])
      const tree = (await withIndex(["write-tree"])).stdout.trim()
      if (!tree) return null

      const message = `rove salvage: force-removed worktree ${worktreePath}`
      const commitArgs = head ? ["commit-tree", tree, "-p", head, "-m", message] : ["commit-tree", tree, "-m", message]
      const commit = (await withIndex(commitArgs)).stdout.trim()
      if (!commit) return null

      const ref = await createSalvageRef(git, salvageRef(branch && branch !== "HEAD" ? branch : null, now), commit)
      if (!ref) return null
      // Name the gitlinks the recovery can't restore rather than imply full capture.
      return { ref, commit, uncaptured: await gitlinkPaths(git, tree) }
    } finally {
      // No debris if the caller's remove also fails. Plain `rm` (`git rm` only
      // unstages tracked paths) via the exec seam, so remote cleans up over ssh.
      await exec.run(["rm", "-f", indexPath], { cwd: worktreePath }).catch(() => undefined)
    }
  } catch {
    return null
  }
}
