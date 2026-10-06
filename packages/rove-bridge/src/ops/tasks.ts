/**
 * The tasks-area op table: reads here, writes in `tasks-write.ts`. Each op wraps one verb,
 * RPC or helper (see `wraps`); nothing forwards a caller-chosen verb or argv.
 */

import { BridgeError } from "../protocol.ts"
import { flag, taskId } from "./args.ts"
import { knownRepo, taskOpDeps } from "./tasks-shared.ts"
import { TASK_WRITE_OPS } from "./tasks-write.ts"
import type { Args, OpContext, OpSpec, OpTable } from "./types.ts"

/** A dead tab's captured output, newest end kept, capped for the phone. */
const TAIL_MAX = 2000

function read(wraps: string, run: OpSpec["run"]): OpSpec {
  return { kind: "read", destructive: false, wraps, run }
}

interface GetTaskResult {
  readonly task: {
    readonly id: string
    readonly title: string
    readonly repo: string
    readonly branch: string
    readonly worktreePath: string
    readonly kind?: string
    readonly status: string
    readonly pinned?: boolean
    readonly vendor?: string
    readonly command?: string
    readonly model?: string
    readonly modelEffort?: string
    readonly prompt?: string
    readonly baseRef?: string
    readonly groupId?: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly prStatus?: {
      readonly number?: number
      readonly url?: string
      readonly lifecycle: string
      readonly checkState: string
      readonly reviewDecision?: string
      readonly mergeable?: string
      readonly baseRef?: string
    }
    readonly report?: { readonly summary?: string; readonly at: string }
  }
}

async function taskGet(args: Args, ctx: OpContext): Promise<unknown> {
  const res = await ctx.api.verb<GetTaskResult>("get-task", [flag("task-id", taskId(args))])
  const t = res.task
  const pr = t.prStatus
  return {
    task: {
      id: t.id,
      title: t.title,
      repo: t.repo,
      branch: t.branch,
      worktreePath: t.worktreePath,
      kind: t.kind ?? "task",
      status: t.status,
      pinned: t.pinned === true,
      ...(t.vendor ? { engine: t.vendor } : {}),
      ...(t.command ? { command: t.command } : {}),
      ...(t.model ? { model: t.model } : {}),
      ...(t.modelEffort ? { effort: t.modelEffort } : {}),
      ...(t.prompt ? { prompt: t.prompt } : {}),
      ...(t.baseRef ? { baseRef: t.baseRef } : {}),
      ...(t.groupId ? { groupId: t.groupId } : {}),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...(pr
        ? {
            pr: {
              ...(pr.number !== undefined ? { number: pr.number } : {}),
              ...(pr.url ? { url: pr.url } : {}),
              lifecycle: pr.lifecycle,
              checkState: pr.checkState,
              ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
              ...(pr.mergeable ? { mergeable: pr.mergeable } : {}),
              ...(pr.baseRef ? { baseRef: pr.baseRef } : {}),
            },
          }
        : {}),
      ...(t.report ? { report: { summary: t.report.summary ?? "", at: t.report.at } } : {}),
    },
  }
}

interface CollectTab {
  readonly id: string
  readonly kind: string
  readonly alive: boolean | null
  readonly exit: {
    readonly code: number | null
    readonly signal: string | null
    readonly layer?: string
    readonly tail?: readonly string[]
  } | null
}

interface CollectRow {
  readonly taskId: string
  readonly running: boolean | null
  readonly activity: { readonly state: string; readonly forMs: number } | null
  readonly changes: { readonly added: number; readonly deleted: number } | null
  readonly base: {
    readonly baseRef: string | null
    readonly ahead: number | null
    readonly behind: number | null
  } | null
  readonly tabs: readonly CollectTab[]
}

/** `collect`'s first row, trimmed to what a phone's info screen draws. */
async function taskInfo(args: Args, ctx: OpContext): Promise<unknown> {
  const id = taskId(args)
  const res = await ctx.api.verb<{ tasks?: readonly CollectRow[] }>("collect", [flag("task-ids", id)])
  const row = res.tasks?.[0]
  if (!row) throw new BridgeError("NOT_FOUND", `no task ${id}`)
  return {
    taskId: row.taskId,
    running: row.running ?? null,
    activity: row.activity ? { state: row.activity.state, forMs: row.activity.forMs } : null,
    changes: row.changes ? { added: row.changes.added, deleted: row.changes.deleted } : null,
    base: row.base ? { baseRef: row.base.baseRef, ahead: row.base.ahead, behind: row.base.behind } : null,
    tabs: (row.tabs ?? []).map((tab) => {
      const exit = tab.exit
      const tail = exit?.tail?.join("\n").slice(-TAIL_MAX)
      return {
        id: tab.id,
        kind: tab.kind,
        alive: tab.alive ?? null,
        ...(exit
          ? { exit: { code: exit.code, signal: exit.signal, ...(exit.layer ? { cause: exit.layer } : {}) } }
          : {}),
        ...(tail ? { tail } : {}),
      }
    }),
  }
}

async function repoBranches(args: Args, ctx: OpContext): Promise<unknown> {
  const repo = await knownRepo(args, ctx)
  return { branches: taskOpDeps.listLocalBranches(repo), current: taskOpDeps.getCurrentBranch(repo) }
}

async function notesList(args: Args, ctx: OpContext): Promise<unknown> {
  const repo = await knownRepo(args, ctx)
  const res = await ctx.api.verb<{ notes?: readonly unknown[] }>("note-list", [flag("repo", repo)])
  return { notes: res.notes ?? [] }
}

async function worktreeAdoptable(args: Args, ctx: OpContext): Promise<unknown> {
  const repo = await knownRepo(args, ctx)
  const res = await ctx.api.rpc<{ worktrees?: readonly unknown[]; unreadable?: readonly string[] }>(
    "worktree.discoverAdoptable",
    { repo },
  )
  return { worktrees: res.worktrees ?? [], unreadable: res.unreadable ?? [] }
}

export const TASK_OPS: OpTable = {
  "task.get": read("verb get-task --task-id", taskGet),
  "task.info": read("verb collect --task-ids (first row, trimmed)", taskInfo),
  "repo.branches": read("helpers listLocalBranches + getCurrentBranch", repoBranches),
  "notes.list": read("verb note-list --repo", notesList),
  "worktree.adoptable": read("rpc worktree.discoverAdoptable", worktreeAdoptable),
  ...TASK_WRITE_OPS,
}
