/**
 * Task-area write ops: spawn, edit metadata, pin/move, project/notes cleanup, worktree
 * lifecycle and clone. Each op wraps exactly one verb / RPC / helper; every value is shape
 * checked here and verb values are built only with `flag()`.
 */

import { BridgeError, optBool, optInt, optStr } from "../protocol.ts"
import { absPath, bool, flag, oneOf, optOneOf, optText, taskId, text } from "./args.ts"
import {
  checkAgentEngines,
  cloneFolder,
  cloneUrl,
  effortLevel,
  engineId,
  gitRef,
  knownRepo,
  model,
  optGitRef,
  optModel,
  parseAgents,
  taskOpDeps,
} from "./tasks-shared.ts"
import type { Args, OpContext, OpSpec, OpTable } from "./types.ts"

const STATUSES = ["backlog", "in_progress", "in_review", "done", "canceled", "error"] as const
const DIRECTIONS = ["up", "down", "top"] as const
const PROMPT_MAX = 100_000

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
  const repo = absPath(args, "repo")
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

  const parallel = count !== undefined || agentsGiven
  if (count !== undefined && agentsGiven) throw new BridgeError("BAD_ARGS", "count and agents are exclusive")
  if (parallel && !prompt) throw new BridgeError("BAD_ARGS", "count/agents need a prompt")
  if (parallel && branch) throw new BridgeError("BAD_ARGS", "branch cannot be shared by parallel tasks")
  if (agentsGiven && engineGiven) throw new BridgeError("BAD_ARGS", "engine conflicts with agents")
  const plan = agentsGiven ? parseAgents(args) : undefined
  if (plan) await checkAgentEngines(plan, ctx)
  const engine = engineGiven ? await engineId(args, "engine", ctx) : undefined

  const argv = [flag("repo", repo)]
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
  }>("add", argv)
  if (Array.isArray(res.tasks)) {
    const taskIds = res.tasks.flatMap((t) => (typeof t.taskId === "string" ? [t.taskId] : []))
    return { taskIds, ...(res.groupId ? { groupId: res.groupId } : {}) }
  }
  if (typeof res.taskId !== "string") throw new BridgeError("BAD_RESULT", "add returned no task id")
  return { taskIds: [res.taskId] }
}

async function clone(args: Args): Promise<unknown> {
  const url = cloneUrl(args)
  const parentDir = absPath(args, "parentDir")
  const urlProblem = taskOpDeps.validateGitUrl(url)
  if (urlProblem) throw new BridgeError("BAD_ARGS", urlProblem)
  const given = optStr(args, "folder")
  const folder = cloneFolder(given ?? taskOpDeps.findAvailableFolderName(parentDir, taskOpDeps.deriveFolderName(url)))
  const targetProblem = taskOpDeps.validateCloneTarget(parentDir, folder)
  if (targetProblem) throw new BridgeError("BAD_ARGS", targetProblem)
  const result = await taskOpDeps.cloneRepo(url, taskOpDeps.resolveCloneTarget(parentDir, folder))
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

export const TASK_WRITE_OPS: OpTable = {
  "task.spawn": write("verb add", spawn),
  "task.rename": write("verb rename --task-id --title", (a, c) =>
    done(c.api.verb("rename", [flag("task-id", taskId(a)), flag("title", text(a, "title", 200))])),
  ),
  "task.setBranch": write("verb set-branch --task-id --branch", (a, c) =>
    done(c.api.verb("set-branch", [flag("task-id", taskId(a)), flag("branch", gitRef(a, "branch"))])),
  ),
  "task.setCommand": write("verb set-command --task-id --command=<engine id>", async (a, c) => {
    const id = taskId(a)
    const engine = await engineId(a, "engine", c)
    const res = await c.api.verb<{ protocol?: string }>("set-command", [flag("task-id", id), flag("command", engine)])
    return res.protocol ? { protocol: res.protocol } : {}
  }),
  "task.setModel": write("verb set-model --task-id --model", (a, c) =>
    done(c.api.verb("set-model", [flag("task-id", taskId(a)), flag("model", model(a))])),
  ),
  "task.setEffort": write("verb set-effort --task-id --level", (a, c) =>
    done(c.api.verb("set-effort", [flag("task-id", taskId(a)), flag("level", effortLevel(a))])),
  ),
  "task.setStatus": write("verb set-status --task-id --status", (a, c) =>
    done(c.api.verb("set-status", [flag("task-id", taskId(a)), flag("status", oneOf(a, "status", STATUSES))])),
  ),
  "task.pin": write("verb pin --task-id --pinned", (a, c) =>
    done(c.api.verb("pin", [flag("task-id", taskId(a)), flag("pinned", String(bool(a, "pinned")))])),
  ),
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
  "repo.clone": write("helper cloneRepo (git clone, fixed argv)", (a) => clone(a)),
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
