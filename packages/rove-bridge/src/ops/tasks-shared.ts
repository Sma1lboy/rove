/**
 * Shared pieces of the task-area ops (`tasks.ts`, `tasks-write.ts`): the overridable
 * dependency object, and the validators every phone-supplied value goes through before it can
 * reach a `rove api` argv, a daemon RPC or a git process.
 */

import { getSavedRepos } from "@sma1lboy/rove/src/state/repos.ts"
import {
  cloneRepo,
  deriveFolderName,
  findAvailableFolderName,
  resolveCloneTarget,
  validateCloneTarget,
  validateGitUrl,
} from "@sma1lboy/rove/src/tui/component/new-task-dialog/clone.ts"
import { getCurrentBranch, listLocalBranches, validateRepoPath } from "@sma1lboy/rove/src/tui/lib/git-snapshot.ts"
import { BridgeError } from "../protocol.ts"
import { absPath } from "./args.ts"
import type { Args, OpContext } from "./types.ts"

/**
 * Everything the task ops touch outside `ctx.api`: sync git helpers, the saved-repo list and
 * the clone spawn. One object so tests replace them without a real git remote.
 */
export const taskOpDeps = {
  savedRepos: (): readonly string[] => getSavedRepos(),
  listLocalBranches,
  getCurrentBranch,
  validateRepoPath,
  cloneRepo,
  validateGitUrl,
  validateCloneTarget,
  resolveCloneTarget,
  findAvailableFolderName,
  deriveFolderName,
}

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/
const EFFORT_LEVEL = /^[a-z0-9][a-z0-9-]{0,19}$/
const ENGINE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const FOLDER = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/

/** A branch / base ref: git-ref characters only, nothing that can read as a flag or a revision range. */
export function gitRef(args: Args, name: string): string {
  const v = args[name]
  if (
    typeof v !== "string" ||
    !GIT_REF.test(v) ||
    v.includes("..") ||
    v.includes("//") ||
    v.includes("/.") ||
    v.endsWith("/") ||
    v.endsWith(".") ||
    v.endsWith(".lock")
  ) {
    throw new BridgeError("BAD_ARGS", `${name} is not a valid git ref name`)
  }
  return v
}

export function optGitRef(args: Args, name: string): string | undefined {
  const v = args[name]
  return v === undefined || v === null || v === "" ? undefined : gitRef(args, name)
}

export function model(args: Args, name = "model"): string {
  const v = args[name]
  if (typeof v !== "string" || !MODEL.test(v)) throw new BridgeError("BAD_ARGS", `${name} is not a model id`)
  return v
}

export function optModel(args: Args, name = "model"): string | undefined {
  const v = args[name]
  return v === undefined || v === null || v === "" ? undefined : model(args, name)
}

export function effortLevel(args: Args, name = "level"): string {
  const v = args[name]
  if (typeof v !== "string" || !EFFORT_LEVEL.test(v))
    throw new BridgeError("BAD_ARGS", `${name} is not an effort level`)
  return v
}

/** Every engine id `engine-list` reports: the only values an engine arg may take. */
async function knownEngineIds(ctx: OpContext): Promise<ReadonlySet<string>> {
  const res = await ctx.api.verb<{ engines?: ReadonlyArray<{ id: string }> }>("engine-list", [])
  return new Set((res.engines ?? []).map((e) => e.id))
}

function checkEngineShape(id: unknown, name: string): string {
  if (typeof id !== "string" || !ENGINE_ID.test(id)) throw new BridgeError("BAD_ARGS", `${name} is not an engine id`)
  return id
}

/** An engine id, checked for shape first (so nothing odd reaches `engine-list`) and then for membership. */
export async function engineId(args: Args, name: string, ctx: OpContext): Promise<string> {
  const id = checkEngineShape(args[name], name)
  if (!(await knownEngineIds(ctx)).has(id))
    throw new BridgeError("UNKNOWN_ENGINE", `${name} ${id} is not a known engine`)
  return id
}

export const FANOUT_CAP = 10

/** `claude:2,codex:1` → the same plan, normalized, after shape + count + uniqueness checks. Engine membership is {@link checkAgentEngines}. */
export function parseAgents(args: Args, name = "agents"): Array<{ id: string; n: number }> {
  const raw = args[name]
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300)
    throw new BridgeError("BAD_ARGS", `${name} must be engine:count pairs like claude:2,codex:1`)
  const plan: Array<{ id: string; n: number }> = []
  let total = 0
  for (const part of raw.split(",")) {
    const m = /^([^:]+):(\d{1,2})$/.exec(part)
    if (!m) throw new BridgeError("BAD_ARGS", `${name} entry "${part}" must be engine:count`)
    const id = checkEngineShape(m[1], name)
    const n = Number.parseInt(m[2] as string, 10)
    if (n < 1) throw new BridgeError("BAD_ARGS", `${name} count for ${id} must be at least 1`)
    if (plan.some((p) => p.id === id)) throw new BridgeError("BAD_ARGS", `${name} names ${id} twice`)
    total += n
    if (total > FANOUT_CAP) throw new BridgeError("BAD_ARGS", `${name} asks for more than ${FANOUT_CAP} agents`)
    plan.push({ id, n })
  }
  return plan
}

export async function checkAgentEngines(plan: ReadonlyArray<{ id: string }>, ctx: OpContext): Promise<void> {
  const known = await knownEngineIds(ctx)
  for (const { id } of plan) {
    if (!known.has(id)) throw new BridgeError("UNKNOWN_ENGINE", `agents engine ${id} is not a known engine`)
  }
}

/** Absolute repo path that Rove already knows: a saved project or one with tasks (the `repos.list` set). */
export async function knownRepo(args: Args, ctx: OpContext, name = "repo"): Promise<string> {
  const repo = absPath(args, name)
  if (taskOpDeps.savedRepos().includes(repo)) return repo
  const { tasks } = await ctx.api.rpc<{ tasks: ReadonlyArray<{ repo: string }> }>("task.list")
  if (!tasks.some((t) => t.repo === repo)) throw new BridgeError("UNKNOWN_REPO", `${repo} is not a known project`)
  return repo
}

/** Clone URL allowlist: https/http/ssh/git, or scp-form `user@host:path`. Never a leading `-`, `ext::`, `fd::` or `file:`. */
const URL_SCHEME = /^(https?|ssh|git):\/\/[A-Za-z0-9[]\S*$/i
const URL_SCP = /^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9.-]*:\S+$/

export function cloneUrl(args: Args, name = "url"): string {
  const v = args[name]
  if (typeof v !== "string") throw new BridgeError("BAD_ARGS", `${name} must be a git URL`)
  const url = v.trim()
  const lower = url.toLowerCase()
  if (
    url.length === 0 ||
    url.length > 2000 ||
    url.startsWith("-") ||
    lower.startsWith("ext::") ||
    lower.startsWith("fd::") ||
    lower.startsWith("file:") ||
    url.includes("@-") ||
    /\p{Cc}/u.test(url) ||
    !(URL_SCHEME.test(url) || URL_SCP.test(url))
  ) {
    throw new BridgeError("BAD_ARGS", `${name} must be an https, http, ssh or git URL (or user@host:path)`)
  }
  return url
}

/** A clone folder name: one path segment. */
export function cloneFolder(folder: string): string {
  if (!FOLDER.test(folder) || folder === "." || folder === "..") {
    throw new BridgeError("BAD_ARGS", "folder must be one plain directory name")
  }
  return folder
}
