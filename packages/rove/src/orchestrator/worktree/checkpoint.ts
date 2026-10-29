/**
 * Checkpoints: file-only undo points for a managed task's worktree.
 *
 * Same technique as {@link salvageWorktree} — a throwaway index seeded from
 * HEAD, `add -A`, `write-tree`, `commit-tree` — so the real index, HEAD and the
 * branch are never touched. Unlike salvage, `.gitignore` is honoured in full:
 * a checkpoint covers what the agent edits, not `node_modules/` or `.env`.
 *
 *     refs/rove/checkpoints/<taskId>/<n>   commit whose tree = the working tree
 *
 * Refs live in the repo's common gitdir, so removing the worktree does not
 * remove them; {@link deleteTaskCheckpoints} does, when the task goes.
 *
 * Rewind is files-only and undoable: it checkpoints the current state first,
 * then lets git rewrite the tree with `read-tree --reset -u` over a throwaway
 * index seeded with that snapshot — git deletes exactly the paths the snapshot
 * has and the target lacks, so ignored files are never in its way.
 */

import type {
  CheckpointRecord,
  RewindResult,
  TakeCheckpointResult,
} from "@sma1lboy/rove-daemon/daemon/checkpoint-contracts"
import type { ExecHost } from "../../exec/exec-host.ts"
import type { GitRunOpts, GitRunResult } from "./git.ts"

/** The git primitive checkpoints borrow from the manager (same shape as `SalvageDeps`). */
export interface CheckpointDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
}

/** Newest checkpoints kept per task. */
export const CHECKPOINT_RETENTION = 100

const REF_ROOT = "refs/rove/checkpoints"

/** Thrown with a `CODE: reason` message — the shape the CLI's `splitDaemonCode` parses. */
export class CheckpointError extends Error {
  constructor(
    readonly code: "CHECKPOINT_NOT_FOUND" | "CHECKPOINT_FAILED",
    reason: string,
  ) {
    super(`${code}: ${reason}`)
    this.name = "CheckpointError"
  }
}

export function checkpointRef(taskId: string, n: number): string {
  return `${REF_ROOT}/${taskId}/${n}`
}

// `git commit-tree` refuses without an identity, and a fresh sandbox HOME has none.
const FALLBACK_IDENTITY = {
  GIT_AUTHOR_NAME: "Rove",
  GIT_AUTHOR_EMAIL: "rove@localhost",
  GIT_COMMITTER_NAME: "Rove",
  GIT_COMMITTER_EMAIL: "rove@localhost",
}

/** Parse `rove checkpoint <n> [tabId] <iso>`; ids and the stamp hold no spaces. */
function parseSubject(subject: string): { at: string; tabId?: string } {
  const parts = subject.trim().split(/\s+/).slice(3)
  const at = parts.pop() ?? ""
  return parts[0] ? { at, tabId: parts[0] } : { at }
}

/** Every checkpoint of `taskId`, oldest first (numeric order, not ref-name order). */
export async function listCheckpoints(
  deps: CheckpointDeps,
  exec: ExecHost,
  cwd: string,
  taskId: string,
): Promise<CheckpointRecord[]> {
  const prefix = `${REF_ROOT}/${taskId}/`
  const out = await deps.runGit(
    exec,
    ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(tree)%09%(subject)", prefix],
    {
      cwd,
      allowFail: true,
      readOnly: true,
    },
  )
  if (out.exitCode !== 0) return []
  const records: CheckpointRecord[] = []
  for (const line of out.stdout.split("\n")) {
    const [ref, commit, tree, subject = ""] = line.split("\t")
    const n = Number(ref?.slice(prefix.length))
    if (!ref || !commit || !tree || !Number.isInteger(n)) continue
    records.push({ n, ref, commit, tree, ...parseSubject(subject) })
  }
  return records.sort((a, b) => a.n - b.n)
}

/** The `160000` (gitlink) paths of `tree`: their contents are never captured. */
async function gitlinkPaths(exec: ExecHost, deps: CheckpointDeps, cwd: string, tree: string): Promise<string[]> {
  const out = await deps.runGit(exec, ["ls-tree", "-r", tree], { cwd, allowFail: true, readOnly: true })
  if (out.exitCode !== 0) return []
  return out.stdout
    .split("\n")
    .filter((line) => line.startsWith("160000 "))
    .map((line) => line.slice(line.indexOf("\t") + 1))
    .filter((p) => p.length > 0)
}

/**
 * Run `body` with a throwaway index inside the git dir (never in the worktree,
 * where `add -A` would capture it), removed afterwards.
 */
async function withTempIndex<T>(
  deps: CheckpointDeps,
  exec: ExecHost,
  cwd: string,
  body: (
    gitIdx: (args: readonly string[], extraEnv?: Record<string, string>) => Promise<GitRunResult>,
    indexPath: string,
  ) => Promise<T>,
): Promise<T> {
  const name = `rove-ckpt-index-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const indexPath = (
    await deps.runGit(exec, ["rev-parse", "--git-path", name], { cwd, allowFail: true, readOnly: true })
  ).stdout.trim()
  if (!indexPath) throw new CheckpointError("CHECKPOINT_FAILED", `${cwd} is not a git work tree`)
  try {
    return await body(
      (args, extraEnv) =>
        deps.runGit(exec, args, { cwd, allowFail: true, env: { GIT_INDEX_FILE: indexPath, ...extraEnv } }),
      indexPath,
    )
  } finally {
    await exec.run(["rm", "-f", indexPath], { cwd }).catch(() => undefined)
  }
}

/** The tree of the working tree: tracked edits + untracked, minus ignored. */
async function snapshotTree(
  deps: CheckpointDeps,
  exec: ExecHost,
  cwd: string,
  head: string,
): Promise<{ tree: string; uncaptured: string[] }> {
  const tree = await withTempIndex(deps, exec, cwd, async (gitIdx, indexPath) => {
    // Seed from the worktree's real index: it carries stat data, so `add -A`
    // only rehashes files that changed, and it lists every tracked path, so
    // `.gitignore` cannot hide a tracked file (an empty index would snapshot
    // it as a deletion). No index yet: seed from HEAD, which has the paths but
    // no stat data. `cp -p` keeps the index's mtime: git treats an entry as
    // possibly stale ("racily clean") only when it is not older than the index
    // file, so a fresh mtime would let a same-size edit made just after the
    // last index write look unchanged.
    const real = (
      await deps.runGit(exec, ["rev-parse", "--git-path", "index"], { cwd, allowFail: true, readOnly: true })
    ).stdout.trim()
    const copied =
      real !== "" && (await exec.run(["cp", "-p", real, indexPath], { cwd }).catch(() => undefined))?.exitCode === 0
    if (!copied && head && (await gitIdx(["read-tree", head])).exitCode !== 0)
      throw new CheckpointError("CHECKPOINT_FAILED", "read-tree failed")
    if ((await gitIdx(["add", "-A"])).exitCode !== 0)
      throw new CheckpointError("CHECKPOINT_FAILED", "git add -A failed")
    const written = (await gitIdx(["write-tree"])).stdout.trim()
    if (!written) throw new CheckpointError("CHECKPOINT_FAILED", "write-tree failed")
    return written
  })
  return { tree, uncaptured: await gitlinkPaths(exec, deps, cwd, tree) }
}

async function headCommit(deps: CheckpointDeps, exec: ExecHost, cwd: string): Promise<string> {
  const out = await deps.runGit(exec, ["rev-parse", "--verify", "-q", "HEAD"], { cwd, allowFail: true, readOnly: true })
  return out.exitCode === 0 ? out.stdout.trim() : ""
}

/**
 * Snapshot the working tree as checkpoint `max(n) + 1`, unless it already equals
 * the latest checkpoint's tree. Prunes past {@link CHECKPOINT_RETENTION}.
 * Throws {@link CheckpointError}; the daemon trigger logs, the verbs report.
 */
export async function takeCheckpoint(
  deps: CheckpointDeps,
  exec: ExecHost,
  worktreePath: string,
  taskId: string,
  opts: { readonly tabId?: string; readonly now?: Date } = {},
): Promise<TakeCheckpointResult> {
  const head = await headCommit(deps, exec, worktreePath)
  const { tree, uncaptured } = await snapshotTree(deps, exec, worktreePath, head)

  const existing = await listCheckpoints(deps, exec, worktreePath, taskId)
  const latest = existing[existing.length - 1]
  if (latest && latest.tree === tree) return { created: false, checkpoint: latest }

  const at = (opts.now ?? new Date()).toISOString()
  const hasIdentity =
    (await deps.runGit(exec, ["var", "GIT_COMMITTER_IDENT"], { cwd: worktreePath, allowFail: true, readOnly: true }))
      .exitCode === 0
  for (let n = (latest?.n ?? 0) + 1, attempt = 0; attempt < 5; n++, attempt++) {
    const message = ["rove checkpoint", n, opts.tabId, at].filter((p) => p !== undefined && p !== "").join(" ")
    const commitArgs = head ? ["commit-tree", tree, "-p", head, "-m", message] : ["commit-tree", tree, "-m", message]
    const commit = await deps.runGit(exec, commitArgs, {
      cwd: worktreePath,
      allowFail: true,
      ...(hasIdentity ? {} : { env: FALLBACK_IDENTITY }),
    })
    const sha = commit.stdout.trim()
    if (commit.exitCode !== 0 || !sha)
      throw new CheckpointError("CHECKPOINT_FAILED", `commit-tree failed: ${commit.stderr.trim()}`)
    const ref = checkpointRef(taskId, n)
    // Empty old value = create-only, so a concurrent writer can never be overwritten.
    if (
      (await deps.runGit(exec, ["update-ref", ref, sha, ""], { cwd: worktreePath, allowFail: true })).exitCode === 0
    ) {
      await pruneCheckpoints(deps, exec, worktreePath, taskId).catch(() => undefined)
      return {
        created: true,
        checkpoint: { n, ref, commit: sha, tree, at, ...(opts.tabId ? { tabId: opts.tabId } : {}) },
        uncaptured,
      }
    }
  }
  throw new CheckpointError("CHECKPOINT_FAILED", `could not allocate a checkpoint number for ${taskId}`)
}

async function deleteRefs(deps: CheckpointDeps, exec: ExecHost, cwd: string, refs: readonly string[]): Promise<void> {
  for (const ref of refs) await deps.runGit(exec, ["update-ref", "-d", ref], { cwd, allowFail: true })
}

/** Drop all but the newest `keep` checkpoints of `taskId`; returns how many went. */
export async function pruneCheckpoints(
  deps: CheckpointDeps,
  exec: ExecHost,
  cwd: string,
  taskId: string,
  keep: number = CHECKPOINT_RETENTION,
): Promise<number> {
  const all = await listCheckpoints(deps, exec, cwd, taskId)
  const doomed = all.slice(0, Math.max(0, all.length - keep))
  await deleteRefs(
    deps,
    exec,
    cwd,
    doomed.map((c) => c.ref),
  )
  return doomed.length
}

/** Remove every checkpoint ref of a deleted task; returns how many went. */
export async function deleteTaskCheckpoints(
  deps: CheckpointDeps,
  exec: ExecHost,
  cwd: string,
  taskId: string,
): Promise<number> {
  const all = await listCheckpoints(deps, exec, cwd, taskId)
  await deleteRefs(
    deps,
    exec,
    cwd,
    all.map((c) => c.ref),
  )
  return all.length
}

/**
 * Re-key `fromId`'s checkpoints under `toId` when a workspace changes owner (a
 * deleted owner's heir inherits the directory, and the history with it). An
 * existing `toId` ref is never overwritten; returns how many moved.
 */
export async function moveTaskCheckpoints(
  deps: CheckpointDeps,
  exec: ExecHost,
  cwd: string,
  fromId: string,
  toId: string,
): Promise<number> {
  let moved = 0
  for (const c of await listCheckpoints(deps, exec, cwd, fromId)) {
    const created = await deps.runGit(exec, ["update-ref", checkpointRef(toId, c.n), c.commit, ""], {
      cwd,
      allowFail: true,
    })
    if (created.exitCode !== 0) continue
    await deleteRefs(deps, exec, cwd, [c.ref])
    moved++
  }
  return moved
}

/**
 * Make the working tree equal checkpoint `n`'s tree, files only. Checkpoints the
 * current state first (reported as `undo`) so the rewind is itself undoable.
 * HEAD and the branch stay; the index is reset to HEAD.
 */
export async function rewindTo(
  deps: CheckpointDeps,
  exec: ExecHost,
  worktreePath: string,
  taskId: string,
  n: number,
  opts: { readonly now?: Date } = {},
): Promise<RewindResult> {
  const target = (await listCheckpoints(deps, exec, worktreePath, taskId)).find((c) => c.n === n)
  if (!target) throw new CheckpointError("CHECKPOINT_NOT_FOUND", `task ${taskId} has no checkpoint ${n}`)

  // Unchanged since the latest checkpoint → that one already is the undo point.
  const taken = await takeCheckpoint(deps, exec, worktreePath, taskId, { now: opts.now })
  const undo = taken.checkpoint
  const uncaptured = taken.created ? taken.uncaptured : []

  await withTempIndex(deps, exec, worktreePath, async (gitIdx) => {
    // The seed names every path currently on disk; `--reset -u` then removes
    // those the target lacks and writes those it has.
    if ((await gitIdx(["read-tree", undo.tree])).exitCode !== 0)
      throw new CheckpointError("CHECKPOINT_FAILED", "read-tree (current) failed")
    const res = await gitIdx(["read-tree", "--reset", "-u", target.tree])
    if (res.exitCode !== 0) throw new CheckpointError("CHECKPOINT_FAILED", `read-tree failed: ${res.stderr.trim()}`)
  })

  // The real index goes back to HEAD; the branch has not moved.
  const head = await headCommit(deps, exec, worktreePath)
  await deps.runGit(exec, head ? ["reset", "-q"] : ["read-tree", "--empty"], { cwd: worktreePath, allowFail: true })
  return { target, undo, uncaptured }
}
