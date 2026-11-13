/**
 * Task-area write ops: spawn, edit metadata, pin/move, project/notes cleanup, worktree
 * lifecycle and clone. Each op wraps exactly one verb / RPC / helper; every value is shape
 * checked here and verb values are built only with `flag()`.
 */

import { basename, dirname } from "node:path"
import { MULTI_REPO_CAP } from "@sma1lboy/rove-daemon/task-tree"
import { argvToParams } from "@sma1lboy/rove/src/cli/api/invoke.ts"
import { AUTO_MACHINE } from "@sma1lboy/rove/src/machines/forward.ts"
import { deriveTitleFromPrompt } from "@sma1lboy/rove/src/orchestrator/title.ts"
import { BridgeError, optBool, optInt, optStr } from "../protocol.ts"
import { absPath, bool, flag, oneOf, optOneOf, optText, taskId, text } from "./args.ts"
import { commandFromTask } from "./tasks-command-from.ts"
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
const SIDES = ["before", "after"] as const
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

/** `scheduleAt` + `schedulePrompt`: "Later", checked here so a bad time is refused before anything is recorded. */
function scheduledStart(args: Args): { at: string; prompt: string } | undefined {
  if (args.scheduleAt === undefined || args.scheduleAt === null || args.scheduleAt === "") return undefined
  const at = text(args, "scheduleAt", 40)
  if (!Number.isFinite(Date.parse(at))) throw new BridgeError("BAD_ARGS", "scheduleAt must be an ISO-8601 time")
  return { at, prompt: text(args, "schedulePrompt", PROMPT_MAX) }
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
  // Another registered machine: its repo, its worktree. The agent is this machine's unless `engineThere`
  // (or a round of attempts, or a Windows machine, which only that machine's `add` serves) puts the engine there too.
  const asked = optText(args, "machine", 64)
  const auto = asked === AUTO_MACHINE
  const repo = asked && !auto ? remoteRepoRef(args, "repo") : absPath(args, "repo")
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
  // `auto`: the least-loaded machine that has this repo, named by this machine's checkout of it. Never a
  // failure: no pick is this machine, and so is any start only this machine serves.
  const hereOnly =
    extras.length > 0 || count !== undefined || agentsGiven || args.commandFrom || args.scheduleAt || args.start
  const machine = !auto ? asked : hereOnly ? undefined : await taskOpDeps.autoMachine(repo, baseBranch)
  if (clone && !machine) throw new BridgeError("BAD_ARGS", "clone needs a machine")
  if (clone && repo.startsWith("/")) throw new BridgeError("BAD_ARGS", "clone needs a repo id, not a path")
  if (extras.length > 0 && machine)
    throw new BridgeError("BAD_ARGS", "a multi-repo task must keep every repo on this machine")

  const parallel = count !== undefined || agentsGiven
  const there =
    machine !== undefined && (optBool(args, "engineThere") === true || parallel || taskOpDeps.isWindowsMachine(machine))
      ? machine
      : undefined
  if (count !== undefined && agentsGiven) throw new BridgeError("BAD_ARGS", "count and agents are exclusive")
  if (parallel && !prompt) throw new BridgeError("BAD_ARGS", "count/agents need a prompt")
  // "Later": the daemon records what to create and creates it, engine and prompt, when the time comes.
  const later = scheduledStart(args)
  // An idle engine for a person to type into (a freshly cloned repo); never a row with no agent.
  const start = optBool(args, "start")
  if ((later || start) && (parallel || prompt || machine || (later && start))) {
    throw new BridgeError(
      "BAD_ARGS",
      "start and a scheduled start each take no prompt, count, agents, machine or each other",
    )
  }
  if (parallel && branch) throw new BridgeError("BAD_ARGS", "branch cannot be shared by parallel tasks")
  if (agentsGiven && engineGiven) throw new BridgeError("BAD_ARGS", "engine conflicts with agents")
  const plan = agentsGiven ? parseAgents(args) : undefined
  if (plan && !machine) await checkAgentEngines(plan, ctx)
  // This machine's engine list says nothing about another's; that machine's `add` validates it.
  const engine = !engineGiven ? undefined : there ? text(args, "engine", 64) : await engineId(args, "engine", ctx)

  // Retry: the source task's own launch command in place of the bare engine id.
  const carried = await commandFromTask(args, ctx, { engine, machine, parallel })

  const argv = [flag("repo", repo)]
  if (machine && !there) argv.push(flag("workspace-on", machine))
  if (clone) argv.push(flag("clone", "true"))
  // Further `--repo`s are the extras; `--base-for REPO=REF` (REPO as a path) is each one's base.
  for (const extra of extras) argv.push(flag("repo", extra.repo))
  for (const extra of extras) if (extra.baseRef) argv.push(flag("base-for", `${extra.repo}=${extra.baseRef}`))
  if (title) argv.push(flag("title", title))
  if (branch) argv.push(flag("branch", branch))
  if (baseBranch) argv.push(flag("base-branch", baseBranch))
  if (engine) argv.push(flag("command", carried ?? engine))
  if (effort) argv.push(flag("effort", effort))
  if (mdl) argv.push(flag("model", mdl))
  if (count !== undefined) argv.push(flag("count", count))
  if (plan) argv.push(flag("agents", plan.map((p) => `${p.id}:${p.n}`).join(",")))
  if (status) argv.push(flag("status", status))
  if (pin) argv.push(flag("pin", "true"))
  if (prompt) argv.push(flag("prompt", prompt))
  if (start) argv.push(flag("start", "true"))
  if (later) {
    const pending = await ctx.api.rpc<{ id: string }>("pendingStart.add", {
      ...later,
      title: title ?? deriveTitleFromPrompt(later.prompt),
      repo,
      create: { via: "add", params: argvToParams("add", argv) },
    })
    if (engine) taskOpDeps.rememberEngine(repo, engine)
    return { taskIds: [], pendingStartId: pending.id }
  }

  const res = await ctx.api.verb<{
    taskId?: string
    groupId?: string
    tasks?: ReadonlyArray<{ taskId?: string }>
  }>("add", argv, there)
  // The project's next "New conversation" follows the engine this one was started on.
  if (engine && !machine) taskOpDeps.rememberEngine(repo, engine)
  if (Array.isArray(res.tasks)) {
    const taskIds = res.tasks.flatMap((t) => (typeof t.taskId === "string" ? [t.taskId] : []))
    return { taskIds, ...(res.groupId ? { groupId: res.groupId } : {}) }
  }
  if (typeof res.taskId !== "string") throw new BridgeError("BAD_RESULT", "add returned no task id")
  return { taskIds: [res.taskId], ...(auto && machine ? { machine } : {}) }
}

/** Minimum gap between streamed clone lines; git redraws its counters many times a second. */
const PROGRESS_GAP_MS = 150

async function clone(args: Args, ctx: OpContext): Promise<unknown> {
  const url = await cloneSource(args)
  const urlProblem = taskOpDeps.validateGitUrl(url)
  if (urlProblem) throw new BridgeError("BAD_ARGS", urlProblem)
  // No parentDir: the caller leaves the place to Rove, and a repo cloned there before is that clone.
  const managed = args.parentDir === undefined ? taskOpDeps.managedClone(url) : null
  if (managed?.ready) return { path: managed.dir }
  const parentDir = managed ? dirname(managed.dir) : absPath(args, "parentDir")
  const given = managed ? basename(managed.dir) : optStr(args, "folder")
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

/** A session in the first leftover row's project checkout, told the whole list; it deletes only what the user confirms. */
async function legacyCleanup(args: Args, ctx: OpContext): Promise<unknown> {
  const title = text(args, "title", 200)
  const prompt = text(args, "prompt", PROMPT_MAX)
  const found = await ctx.api.rpc<{ tasks?: ReadonlyArray<{ repo: string }> }>("worktree.legacyAdopted", {})
  const first = found.tasks?.[0]
  if (!first) throw new BridgeError("NOTHING_TO_CLEAN", "no leftover sessions to clean up")
  // A repo the daemon will not make a project row for (a scratch dir) still gets the session, in its own worktree.
  const main = await ctx.api.rpc<{ task: { id: string } }>("task.ensureMain", { repo: first.repo }).catch(() => null)
  // `--no-worktree` runs in the parent's directory; `add` refuses a `--repo` beside it.
  const where = main ? [flag("parent", main.task.id), flag("no-worktree", "true")] : [flag("repo", first.repo)]
  const res = await ctx.api.verb<{ taskId?: string }>("add", [...where, flag("title", title), flag("prompt", prompt)])
  if (typeof res.taskId !== "string") throw new BridgeError("BAD_RESULT", "add returned no task id")
  return { taskId: res.taskId }
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
  "task.moveToProject": write("verb update --task-id --project", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("project", absPath(a, "repo"))])),
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
  "task.keep": write("verb update --task-id --kept", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("kept", String(bool(a, "kept")))])),
  ),
  // The checklist's ops are the daemon's to validate (ids, caps, empty text): it refuses the whole call.
  "task.notes": write("rpc task.notes (notes replace + todo ops, applied together)", (a, c) => {
    const notes = optText(a, "notes", 20_000)
    const ops = a.ops
    if (ops !== undefined && (!Array.isArray(ops) || ops.length > 50)) {
      throw new BridgeError("BAD_ARGS", "ops must be a list of at most 50")
    }
    return c.api.rpc("task.notes", {
      taskId: taskId(a),
      ...(notes !== undefined ? { notes } : {}),
      ...(ops ? { ops } : {}),
    })
  }),
  "task.scheduleStart": write("rpc task.scheduleStart", async (a, c) => {
    const at = text(a, "at", 40)
    if (!Number.isFinite(Date.parse(at))) throw new BridgeError("BAD_ARGS", "at must be an ISO-8601 time")
    return c.api.rpc("task.scheduleStart", { taskId: taskId(a), at, prompt: text(a, "prompt", PROMPT_MAX) })
  }),
  // "Later" starts the daemon holds, soonest first; a failed one stays listed with its error until cancelled.
  "pendingStart.list": {
    kind: "read",
    destructive: false,
    wraps: "rpc pendingStart.list",
    run: (_a, c) => c.api.rpc("pendingStart.list"),
  },
  "pendingStart.cancel": write("rpc pendingStart.cancel", (a, c) =>
    done(c.api.rpc("pendingStart.cancel", { id: text(a, "id", 64) })),
  ),
  "task.cancelScheduledStart": write("rpc task.cancelScheduledStart", (a, c) =>
    done(c.api.rpc("task.cancelScheduledStart", { taskId: taskId(a) })),
  ),
  "task.startScheduledNow": write("rpc task.startScheduledNow", (a, c) =>
    c.api.rpc("task.startScheduledNow", { taskId: taskId(a) }),
  ),
  "task.autoFixCi": write("verb update --task-id --auto-fix-ci", (a, c) =>
    done(c.api.verb("update", [flag("task-id", taskId(a)), flag("auto-fix-ci", bool(a, "enabled") ? "on" : "off")])),
  ),
  "task.resumeQuota": write("rpc task.resumeQuota", (a, c) =>
    done(c.api.rpc("task.resumeQuota", { taskId: taskId(a) })),
  ),
  "task.archive": write("verb archive|unarchive --task-id [--force]", archive),
  "task.move": write("rpc task.move", (a, c) =>
    done(c.api.rpc("task.move", { taskId: taskId(a), direction: oneOf(a, "direction", DIRECTIONS) })),
  ),
  "project.move": write("rpc project.move (the whole project, main or not, beside another)", (a, c) =>
    done(
      c.api.rpc("project.move", {
        repo: absPath(a, "repo"),
        target: absPath(a, "target"),
        side: oneOf(a, "side", SIDES),
      }),
    ),
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
    const problem = await taskOpDeps.validateRepoPath(repo)
    if (problem) throw new BridgeError("BAD_ARGS", problem)
    const res = await c.api.rpc<{ task: { id: string } }>("task.ensureMain", { repo })
    return { taskId: res.task.id }
  }),
  // A session in the project's own checkout (New session, Worktree off). Its own top-level row, not a
  // conversation of the main task: `tab.new` on a main that already runs one makes a child nested under it.
  "task.openCheckout": write("rpc task.ensureMain + task.openDir {dir: the project root}", async (a, c) => {
    const repo = absPath(a, "repo")
    const problem = await taskOpDeps.validateRepoPath(repo)
    // A folder git cannot use is a standalone directory session (`rove <path>`'s shape): no project row.
    if (problem && !taskOpDeps.isDirectory(repo)) throw new BridgeError("BAD_ARGS", problem)
    const title = optText(a, "title", 200)
    const engineGiven = a.engine !== undefined && a.engine !== null && a.engine !== ""
    const engine = engineGiven ? await engineId(a, "engine", c) : undefined
    const later = scheduledStart(a)
    if (later) {
      // Nothing is created now, the project row included: the daemon opens both when the start is due.
      const vendor = engine ?? taskOpDeps.preferredEngine(repo)
      const pending = await c.api.rpc<{ id: string }>("pendingStart.add", {
        ...later,
        title: title ?? deriveTitleFromPrompt(later.prompt),
        repo,
        create: { via: "dir", dir: repo, project: !problem, ...(vendor ? { vendor } : {}) },
      })
      if (engine) taskOpDeps.rememberEngine(repo, engine)
      return { pendingStartId: pending.id }
    }
    // The project row first: a dir task alone on a repo root is what a missing project row adopts.
    const dir = problem ? repo : (await c.api.rpc<{ task: { repo: string } }>("task.ensureMain", { repo })).task.repo
    const res = await c.api.rpc<{ taskId: string }>("task.openDir", {
      dir,
      vendor: engine ?? taskOpDeps.preferredEngine(dir),
      ...(title ? { title } : {}),
    })
    if (engine) taskOpDeps.rememberEngine(dir, engine)
    return { taskId: res.taskId }
  }),
  "worktree.adopt": write("rpc worktree.adopt", adopt),
  "worktree.legacyCleanup": write(
    "rpc worktree.legacyAdopted + task.ensureMain, then verb add --parent --no-worktree",
    legacyCleanup,
  ),
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
