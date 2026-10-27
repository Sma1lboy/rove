/**
 * Task-area write ops: spawn, edit metadata, pin/move, project/notes cleanup, worktree
 * lifecycle and clone. Each op wraps exactly one verb / RPC / helper; every value is shape
 * checked here and verb values are built only with `flag()`.
 */

import { MULTI_REPO_CAP } from "@sma1lboy/rove-daemon/task-tree"
import { BridgeError, optBool, optInt, optStr } from "../protocol.ts"
import { absPath, bool, flag, oneOf, optOneOf, optText, taskId, text } from "./args.ts"
import {
  checkAgentEngines,
  cloneFolder,
  cloneSource,
  effortLevel,
  engineId,
  gitRef,
  knownRepo,
  model,
  optGitRef,
  optModel,
  parseAgents,
  remoteRepoRef,
  taskOpDeps,
} from "./tasks-shared.ts"
import type { Args, OpContext, OpSpec, OpTable } from "./types.ts"

const STATUSES = ["backlog", "in_progress", "in_review", "done", "canceled", "error"] as const
const DIRECTIONS = ["up", "down", "top"] as const
const PROMPT_MAX = 100_000

/** `extraRepos`: the task's other repos in pick order (the first `repo` is the primary), each with an optional base ref. */
function extraRepos(args: Args): Array<{ repo: string; baseRef?: string }> {
  const raw = args.extraRepos
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new BridgeError("BAD_ARGS", "extraRepos must be an array")
  if (raw.length + 1 > MULTI_REPO_CAP) throw new BridgeError("BAD_ARGS", `a task spans at most ${MULTI_REPO_CAP} repos`)
  return raw.map((entry, i) => {
    const item: Args = typeof entry === "object" && entry !== null ? (entry as Args) : {}
    const repo = absPath(item, "repo")
    const baseRef = optGitRef(item, "baseRef")
    if (!repo) throw new BridgeError("BAD_ARGS", `extraRepos[${i}].repo is required`)
    return { repo, ...(baseRef ? { baseRef } : {}) }
  })
}

function write(wraps: string, run: OpSpec["run"], destructive = false): OpSpec {
  // `async` so a refused argument is always a rejection, never a synchronous throw.
  return { kind: "write", destructive, wraps, run: async (args, ctx) => run(args, ctx) }
}

/** The `{}` result of an op whose verb's own reply carries nothing the phone needs. */
async function done(call: Promise<unknown>): Promise<Record<string, never>> {
  await call
  return {}
}

async function spawn(args: Args, ctx: OpContext): Promise<unknown> {
  // Another registered machine: `add` runs in its daemon, against its paths and its engines.
  const machine = optText(args, "machine", 64)
  const repo = machine ? remoteRepoRef(args, "repo") : absPath(args, "repo")
  const title = optText(args, "title", 200)
  const prompt = optText(args, "prompt", PROMPT_MAX)
  const branch = optGitRef(args, "branch")
  const baseBranch = optGitRef(args, "baseBranch")
  const mdl = optModel(args)
  const effort =
    args.effort === undefined || args.effort === null || args.effort === "" ? undefined : effortLevel(args, "effort")
  const count = optInt(args, "count", 1, 10)
  const agentsGiven = args.agents !== undefined && args.agents !== null && args.agents !== ""
  const status = optOneOf(args, "status", STATUSES)
  const pin = optBool(args, "pin")
  const engineGiven = args.engine !== undefined && args.engine !== null && args.engine !== ""
  const extras = extraRepos(args)
  // `--clone` has the machine fetch a repo id it has no checkout of; a path there is already a checkout.
  const clone = optBool(args, "clone")
  if (clone && !machine) throw new BridgeError("BAD_ARGS", "clone needs a machine")
  if (clone && repo.startsWith("/")) throw new BridgeError("BAD_ARGS", "clone needs a repo id, not a path")
  if (extras.length > 0 && machine)
    throw new BridgeError("BAD_ARGS", "a multi-repo task must keep every repo on this machine")

  const parallel = count !== undefined || agentsGiven
  if (count !== undefined && agentsGiven) throw new BridgeError("BAD_ARGS", "count and agents are exclusive")
  if (parallel && !prompt) throw new BridgeError("BAD_ARGS", "count/agents need a prompt")
  if (parallel && branch) throw new BridgeError("BAD_ARGS", "branch cannot be shared by parallel tasks")
  if (agentsGiven && engineGiven) throw new BridgeError("BAD_ARGS", "engine conflicts with agents")
  const plan = agentsGiven ? parseAgents(args) : undefined
  if (plan && !machine) await checkAgentEngines(plan, ctx)
  // This machine's engine list says nothing about another's; that machine's `add` validates it.
  const engine = !engineGiven ? undefined : machine ? text(args, "engine", 64) : await engineId(args, "engine", ctx)

  const argv = [flag("repo", repo)]
  if (clone) argv.push(flag("clone", "true"))
  // Further `--repo`s are the extras; `--base-for REPO=REF` (REPO as a path) is each one's base.
  for (const extra of extras) argv.push(flag("repo", extra.repo))
  for (const extra of extras) if (extra.baseRef) argv.push(flag("base-for", `${extra.repo}=${extra.baseRef}`))
  if (title) argv.push(flag("title", title))
  if (branch) argv.push(flag("branch", branch))
  if (baseBranch) argv.push(flag("base-branch", baseBranch))
  if (engine) argv.push(flag("command", engine))
  if (effort) argv.push(flag("effort", effort))
  if (mdl) argv.push(flag("model", mdl))
  if (count !== undefined) argv.push(flag("count", count))
  if (plan) argv.push(flag("agents", plan.map((p) => `${p.id}:${p.n}`).join(",")))
  if (status) argv.push(flag("status", status))
  if (pin) argv.push(flag("pin", "true"))
  if (prompt) argv.push(flag("prompt", prompt))

  const res = await ctx.api.verb<{
    taskId?: string
    groupId?: string
    tasks?: ReadonlyArray<{ taskId?: string }>
  }>("add", argv, machine)
  // The project's next "New conversation" follows the engine this one was started on.
  if (engine && !machine) taskOpDeps.rememberEngine(repo, engine)
  if (Array.isArray(res.tasks)) {
    const taskIds = res.tasks.flatMap((t) => (typeof t.taskId === "string" ? [t.taskId] : []))
    return { taskIds, ...(res.groupId ? { groupId: res.groupId } : {}) }
  }
  if (typeof res.taskId !== "string") throw new BridgeError("BAD_RESULT", "add returned no task id")
  return { taskIds: [res.taskId] }
}

/** Minimum gap between streamed clone lines; git redraws its counters many times a second. */
const PROGRESS_GAP_MS = 150

async function clone(args: Args, ctx: OpContext): Promise<unknown> {
  const url = await cloneSource(args)
  const parentDir = absPath(args, "parentDir")
  const urlProblem = taskOpDeps.validateGitUrl(url)
  if (urlProblem) throw new BridgeError("BAD_ARGS", urlProblem)
  const given = optStr(args, "folder")
  const folder = cloneFolder(given ?? taskOpDeps.findAvailableFolderName(parentDir, taskOpDeps.deriveFolderName(url)))
  const targetProblem = taskOpDeps.validateCloneTarget(parentDir, folder)
  if (targetProblem) throw new BridgeError("BAD_ARGS", targetProblem)
  let lastSent = 0
  const result = await taskOpDeps.cloneRepo(url, taskOpDeps.resolveCloneTarget(parentDir, folder), (line) => {
    const now = Date.now()
    if (now - lastSent < PROGRESS_GAP_MS) return
    lastSent = now
    ctx.progress?.(line)
  })
  if (!result.ok) throw new BridgeError("CLONE_FAILED", result.error)
  return { path: result.path }
}

async function adopt(args: Args, ctx: OpContext): Promise<unknown> {
  const repo = await knownRepo(args, ctx)
  const worktreePath = absPath(args, "worktreePath")
  const branch = optGitRef(args, "branch")
  const title = optText(args, "title", 200)
  const engine =
    args.engine === undefined || args.engine === null || args.engine === ""
      ? undefined
      : await engineId(args, "engine", ctx)
  // Only a worktree git lists for this repo and Rove has not adopted yet.
  const found = await ctx.api.rpc<{ worktrees?: ReadonlyArray<{ path: string }> }>("worktree.discoverAdoptable", {
    repo,
  })
  if (!(found.worktrees ?? []).some((w) => w.path === worktreePath)) {
    throw new BridgeError("NOT_ADOPTABLE", `${worktreePath} is not an adoptable worktree of ${repo}`)
  }
  const res = await ctx.api.rpc<{ task: { id: string } }>("worktree.adopt", {
    repo,
    worktreePath,
    ...(branch ? { branch } : {}),
    ...(title ? { title } : {}),
    ...(engine ? { vendor: engine } : {}),
  })
  return { taskId: res.task.id }
}

/** A busy refusal arrives as `BridgeError` code `TASK_BUSY` (lifted by `createBridgeApi`), so the page can offer "archive anyway". */
async function archive(args: Args, ctx: OpContext): Promise<unknown> {
  const id = taskId(args)
  const archived = bool(args, "archived")
  const argv = [flag("task-id", id)]
  if (archived && optBool(args, "force")) argv.push(flag("force", "true"))
  const res = await ctx.api.verb<{ ids?: string[] }>(archived ? "archive" : "unarchive", argv)
  return { ids: res.ids ?? [] }
}

export const TASK_WRITE_OPS: OpTable = {
  "task.spawn": write("verb add", spawn),
  "task.rename": write("verb update --task-id --title", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("title", text(a, "title", 200))])),
  ),
  "task.setBranch": write("verb update --task-id --branch", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("branch", gitRef(a, "branch"))])),
  ),
  "task.setCommand": write("verb update --task-id --command=<engine id>", async (a, c) => {
    const id = taskId(a)
    const engine = await engineId(a, "engine", c)
    const res = await c.api.verb<{ protocol?: string }>("update", [flag("task-id", id), flag("command", engine)])
    return res.protocol ? { protocol: res.protocol } : {}
  }),
  "task.setModel": write("verb update --task-id --model", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("model", model(a))])),
  ),
  "task.setEffort": write("verb update --task-id --effort", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("effort", effortLevel(a))])),
  ),
  "task.setStatus": write("verb update --task-id --status", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("status", oneOf(a, "status", STATUSES))])),
  ),
  "task.pin": write("verb update --task-id --pinned", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("pinned", String(bool(a, "pinned")))])),
  ),
  "task.archive": write("verb archive|unarchive --task-id [--force]", archive),
  "task.move": write("rpc task.move", (a, c) =>
    done(c.api.rpc("task.move", { taskId: taskId(a), direction: oneOf(a, "direction", DIRECTIONS) })),
  ),
  "project.forget": write(
    "rpc project.forget",
    async (a, c) => done(c.api.rpc("project.forget", { repo: await knownRepo(a, c) })),
    true,
  ),
  "notes.delete": write(
    "verb note-delete --repo --id",
    async (a, c) => {
      const repo = await knownRepo(a, c)
      // The verb parses `--id` as a positive integer, so 0 never names a note.
      const id = optInt(a, "id", 1, Number.MAX_SAFE_INTEGER)
      if (id === undefined) throw new BridgeError("BAD_ARGS", "id must be an integer in 1..")
      const res = await c.api.verb<{ deleted?: boolean }>("note-delete", [flag("repo", repo), flag("id", id)])
      return { deleted: res.deleted === true }
    },
    true,
  ),
  "task.openMain": write("rpc task.ensureMain", async (a, c) => {
    const repo = absPath(a, "repo")
    // Opening a project's main task is how a fresh clone becomes a known project, so this
    // takes any real git repo rather than only a known one.
    const problem = taskOpDeps.validateRepoPath(repo)
    if (problem) throw new BridgeError("BAD_ARGS", problem)
    const res = await c.api.rpc<{ task: { id: string } }>("task.ensureMain", { repo })
    return { taskId: res.task.id }
  }),
  "worktree.adopt": write("rpc worktree.adopt", adopt),
  "repo.clone": write("helper cloneRepo (git clone, fixed argv)", clone),
  "task.ensureWorktree": write("verb ensure-worktree --task-id", async (a, c) => {
    const res = await c.api.verb<{ worktreePath?: string }>("ensure-worktree", [flag("task-id", taskId(a))])
    if (typeof res.worktreePath !== "string") throw new BridgeError("BAD_RESULT", "ensure-worktree returned no path")
    return { worktreePath: res.worktreePath }
  }),
  "task.removeWorktree": write(
    "verb remove-worktree --task-id --force",
    async (a, c) => {
      const argv = [flag("task-id", taskId(a))]
      if (optBool(a, "force")) argv.push(flag("force", "true"))
      const res = await c.api.verb<{ removed?: boolean; worktreePath?: string; branch?: string }>(
        "remove-worktree",
        argv,
      )
      return {
        removed: res.removed === true,
        ...(res.worktreePath ? { worktreePath: res.worktreePath } : {}),
        ...(res.branch ? { branch: res.branch } : {}),
      }
    },
    true,
  ),
}
