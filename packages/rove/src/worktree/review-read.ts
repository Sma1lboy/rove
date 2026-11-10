/**
 * What a reviewer reads from a task's worktree: its file list, its changed
 * files against the task's base, and one file's diff preview. One
 * implementation for every surface — the bridge reads a local task's worktree
 * through it, and the `worktree-files` / `worktree-diff` / `worktree-diff-file`
 * verbs run it inside the daemon that owns the worktree, which is how a hub
 * reads a task on another machine.
 */

import { isAbsolute, normalize } from "node:path"
import { ApiError } from "../cli/api/types.ts"
import { type PreviewData, loadPreviewData } from "../tui/ops/preview-core.ts"
import { type StatusEntry, listFiles, resolveBase, statusFiles, statusFilesBranch } from "../tui/panes/filetree/git.ts"
import { runWorktreeGit } from "./content.ts"

export type DiffScope = "branch" | "working"
/** What a preview can compare: a `DiffScope`, or `task` = everything since the base, uncommitted work included. */
export type PreviewScope = DiffScope | "task"

/** One changed file, flattened out of the TUI's collapsible status tree. */
export interface DiffFileRow {
  readonly path: string
  readonly status: string
  readonly added: number | null
  readonly deleted: number | null
  readonly scope: DiffScope
}

export interface WorktreeDiff {
  /** The ref branch changes are measured against; null when none resolves. */
  readonly base: string | null
  readonly files: readonly DiffFileRow[]
}

function flatten(entries: readonly StatusEntry[], scope: DiffScope): DiffFileRow[] {
  return entries.flatMap((e): DiffFileRow[] =>
    e.children?.length
      ? flatten(e.children, scope)
      : [{ path: e.path, status: e.status, added: e.added ?? null, deleted: e.deleted ?? null, scope }],
  )
}

/** Tracked plus untracked-not-ignored files, worktree-relative. */
export function worktreeFiles(worktreePath: string): Promise<string[]> {
  return listFiles(worktreePath)
}

/** Committed-on-branch changes against the base, then uncommitted ones — the TUI changes pane's base ladder (PR base first). */
export async function worktreeDiff(worktreePath: string, prBaseRef?: string): Promise<WorktreeDiff> {
  const base = await resolveBase(worktreePath, prBaseRef)
  const [branch, working] = await Promise.all([
    base ? statusFilesBranch(worktreePath, base) : Promise.resolve([]),
    statusFiles(worktreePath),
  ])
  return { base, files: [...flatten(branch, "branch"), ...flatten(working, "working")] }
}

/** git scopes a diff to the worktree, but a `code` preview reads the file itself: only a path inside it. */
export function isWorktreeRelative(path: string): boolean {
  return !isAbsolute(path) && !normalize(path).split(/[\\/]/).includes("..")
}

/** A ref the diff can be compared against, as the picker lists it. */
export interface DiffRefs {
  readonly branches: readonly string[]
  /** Remote-tracking branches, `origin/main` style. */
  readonly remotes: readonly string[]
  readonly tags: readonly string[]
  /** Recent commits of the worktree's own branch, newest first. */
  readonly commits: readonly { readonly sha: string; readonly subject: string }[]
}

const REF_LIST_LIMIT = 200
const COMMIT_LIST_LIMIT = 30

async function listRefs(worktreePath: string, pattern: string): Promise<string[]> {
  const res = await runWorktreeGit(worktreePath, [
    "for-each-ref",
    "--format=%(refname:short)",
    `--count=${REF_LIST_LIMIT}`,
    pattern,
  ])
  return res.status === 0 ? res.stdout.split("\n").filter((l) => l.length > 0 && !l.endsWith("/HEAD")) : []
}

/** Local branches, remote branches, tags and the branch's recent commits: what "compare against" can name. */
export async function worktreeRefs(worktreePath: string): Promise<DiffRefs> {
  const [branches, remotes, tags, log] = await Promise.all([
    listRefs(worktreePath, "refs/heads"),
    listRefs(worktreePath, "refs/remotes"),
    listRefs(worktreePath, "refs/tags"),
    runWorktreeGit(worktreePath, ["log", `--max-count=${COMMIT_LIST_LIMIT}`, "--format=%h%x09%s"]),
  ])
  const commits =
    log.status === 0
      ? log.stdout
          .split("\n")
          .filter((l) => l.includes("\t"))
          .map((l) => ({ sha: l.slice(0, l.indexOf("\t")), subject: l.slice(l.indexOf("\t") + 1) }))
      : []
  return { branches, remotes, tags, commits }
}

/** The ref as git names it when it resolves to a commit in this worktree's repository; null when it does not (or looks like an option). */
export async function checkRef(worktreePath: string, ref: string): Promise<string | null> {
  const typed = ref.trim()
  if (typed.length === 0 || typed.startsWith("-") || /[\s\0]/.test(typed)) return null
  const res = await runWorktreeGit(worktreePath, ["rev-parse", "--verify", "--quiet", `${typed}^{commit}`])
  return res.status === 0 ? typed : null
}

/** One file's preview: its working-tree diff, its committed diff against the base, or (`task`) everything since the base. `opts.base` names the ref `task` compares against instead of the task's base. */
export async function worktreeDiffFile(
  worktreePath: string,
  path: string,
  scope: PreviewScope,
  prBaseRef?: string,
  opts: { ignoreWhitespace?: boolean; base?: string } = {},
): Promise<PreviewData> {
  if (!isWorktreeRelative(path)) throw new ApiError("path must be relative to the worktree", "BAD_ARGS")
  const { base: asked, ...preview } = opts
  if (asked !== undefined && scope !== "task") throw new ApiError("--base only applies to --scope task", "BAD_ARGS")
  if (scope === "working") return loadPreviewData(worktreePath, path, undefined, preview)
  let base: string | null
  if (asked !== undefined) {
    base = await checkRef(worktreePath, asked)
    if (!base) throw new ApiError(`${asked} is not a commit in this repository`, "BAD_REF")
  } else base = await resolveBase(worktreePath, prBaseRef)
  if (!base) throw new ApiError("could not resolve a base branch for this task", "NO_BASE")
  return loadPreviewData(worktreePath, path, scope === "task" ? { base, working: true } : { base }, preview)
}
