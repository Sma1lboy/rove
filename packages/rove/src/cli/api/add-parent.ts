/**
 * Where `add` hangs a new task in the tree: under the calling rove session,
 * under `--parent`, or at top level. The placement also picks the create RPC:
 * a child cut from its parent's branch tip or sharing its directory is
 * `task.spawn`; everything else is `task.create`.
 */

import { resolvePtyOwner } from "@sma1lboy/rove-daemon/daemon/cwd-task"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { lineageRootId } from "@sma1lboy/rove-daemon/task-tree"
import { isRemoteRepoKey } from "../../state/repos.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { verifiedSelfSession } from "./dispatcher.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/** The parent-related flags of one `add` call, checked for contradictions before anything is created. */
export interface ParentFlags {
  readonly parent?: string
  readonly noParent: boolean
  readonly noWorktree: boolean
  readonly isolateIn?: string
  /** A shared-directory or linked-repo child takes its repo from the parent, so `--repo` and friends do not apply. */
  readonly takesParentRepo: boolean
}

/** How a new task relates to its parent; `top` = no parent. */
export type Placement =
  | { readonly kind: "top" }
  /** `task.create` with a parent: the repo's default base, or the caller's explicit one. */
  | { readonly kind: "nested"; readonly parentId: string }
  /** `task.spawn` with a worktree cut from the parent's current tip. */
  | { readonly kind: "cut"; readonly parentId: string; readonly isolateIn?: string }
  /** `task.spawn` sharing the parent's directory. */
  | { readonly kind: "shared"; readonly parentId: string }

export function parentFlags(ctx: VerbContext): ParentFlags {
  const { args } = ctx
  const parent = args.str("parent")
  const noParent = args.bool("no-parent") === true
  const noWorktree = args.bool("no-worktree") === true
  const isolateIn = args.str("isolate-in")
  const has = (flag: string) => args.str(flag) !== undefined || args.bool(flag) === true
  const conflict = (a: string, b: string): never => {
    throw new ApiError(`--${a} and --${b} conflict`, "CONFLICTING_FLAGS", helpStep("add"))
  }
  if (parent && noParent) conflict("parent", "no-parent")
  if (noWorktree && isolateIn) conflict("no-worktree", "isolate-in")
  for (const [flag, on] of [
    ["no-worktree", noWorktree],
    ["isolate-in", isolateIn !== undefined],
  ] as const) {
    if (!on) continue
    if (noParent) conflict(flag, "no-parent")
    // The child runs in the parent's directory or its linked repo: a repo of its own, a fork point or a fleet cannot apply.
    for (const other of ["repo", "fork", "base-for", "workspace"]) if (has(other)) conflict(flag, other)
  }
  if (noWorktree) {
    for (const other of ["base-branch", "branch", "worktree-name", "count", "agents"]) {
      if (has(other)) conflict("no-worktree", other)
    }
  }
  return { parent, noParent, noWorktree, isolateIn, takesParentRepo: noWorktree || isolateIn !== undefined }
}

/**
 * The task to hang the new one under, or null for top level.
 *
 * `--parent ID` always wins. Otherwise a verified rove session nests the task
 * under itself — but only where the sidebar would show it in the repo the
 * caller asked for: a task in another repo, or under a routine session, stays
 * top level rather than vanishing into someone else's tree. The CLI process
 * itself is the only caller that has a session; a transport (another machine's
 * hub, the bridge) never nests.
 *
 * A child that takes its parent's repo (`--no-worktree`, `--isolate-in`) has
 * no top-level fallback: no parent is an error.
 */
export async function resolveAddParent(
  ctx: VerbContext,
  daemon: DaemonRpc,
  flags: ParentFlags,
  repo: string | undefined,
): Promise<SerializedTask | null> {
  if (flags.parent) return await getParent(daemon, flags.parent)
  if (flags.noParent) return null
  if (!ctx.caller.cli || ctx.caller.forwarded) return requireOrNull(flags)
  const self = await verifiedSelfSession()
  if (!self) return requireOrNull(flags)
  // The tree is advisory, like in `ownSession`: unreadable, the task stays top level.
  const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list", {}).catch(() => ({ tasks: [] }))
  const caller = tasks.find((task) => task.id === resolvePtyOwner(tasks, self.taskId, self.tabId))
  if (!caller) return requireOrNull(flags)
  if (flags.takesParentRepo) return caller
  const root = tasks.find((task) => task.id === lineageRootId(tasks, caller.id))
  if (!root || root.routine || isRemoteRepoKey(root.repo) || repo === undefined) return null
  return samePath(await ctx.runtime.resolveRepoRoot(root.repo), repo) ? caller : null
}

function requireOrNull(flags: ParentFlags): null {
  if (!flags.takesParentRepo) return null
  const flag = flags.noWorktree ? "--no-worktree" : "--isolate-in"
  throw new ApiError(
    `${flag} needs a parent and the caller is not a verified rove session — pass --parent ID`,
    "MISSING_TARGET",
    helpStep("add"),
  )
}

async function getParent(daemon: DaemonRpc, taskId: string): Promise<SerializedTask> {
  try {
    return (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
  } catch {
    throw new ApiError(`no task ${taskId} on this machine — a parent must live beside its child`, "PARENT_NOT_FOUND", {
      hint: "list the ids with `rove api list`",
      nextCommandArgs: ["api", "list"],
    })
  }
}

/**
 * What the create looks like once the parent is known. A child cuts from its
 * parent's tip only when nothing else names the fork point: not `--base-branch`,
 * not `--fork` or `--workspace`, not a multi-repo task, and the repo is the parent's own.
 */
export async function placeAdd(
  ctx: VerbContext,
  parent: SerializedTask | null,
  flags: ParentFlags,
  create: { repo: string; fork: boolean; baseRef?: string; multiRepo: boolean; ownWorkspace?: boolean },
): Promise<Placement> {
  if (!parent) return { kind: "top" }
  const parentId = parent.id
  if (flags.noWorktree) return { kind: "shared", parentId }
  if (flags.isolateIn) return { kind: "cut", parentId, isolateIn: flags.isolateIn }
  const tip =
    !create.fork &&
    // `task.spawn` cuts a git worktree: a backend of the caller's choosing nests through `task.create` instead.
    !create.ownWorkspace &&
    !create.baseRef &&
    !create.multiRepo &&
    !isRemoteRepoKey(parent.repo) &&
    samePath(await ctx.runtime.resolveRepoRoot(parent.repo), create.repo)
  return tip ? { kind: "cut", parentId } : { kind: "nested", parentId }
}

/** The create RPC for a placement, with the `task.create` payload reshaped for it. */
export function placedRequest(
  placement: Placement,
  create: Record<string, unknown>,
): { method: "task.create" | "task.spawn"; payload: Record<string, unknown> } {
  if (placement.kind === "top") return { method: "task.create", payload: create }
  if (placement.kind === "nested") {
    return { method: "task.create", payload: { ...create, parentTaskId: placement.parentId } }
  }
  // `task.spawn` takes the repo from the parent, and has no fork or extra repos.
  const { repo: _repo, extraRepos: _extra, forkFrom: _fork, ...rest } = create
  const payload = { ...rest, parentTaskId: placement.parentId }
  if (placement.kind === "shared") return { method: "task.spawn", payload: { ...payload, worktree: false } }
  return {
    method: "task.spawn",
    payload: {
      ...payload,
      worktree: true,
      // The checkout waits for the first prompt, like every `add`.
      lazy: true,
      ...(placement.isolateIn ? { isolateIn: placement.isolateIn } : {}),
    },
  }
}
