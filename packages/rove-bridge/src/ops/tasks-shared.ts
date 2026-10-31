/**
 * Shared pieces of the task-area ops (`tasks.ts`, `tasks-write.ts`): the overridable
 * dependency object, and the validators every phone-supplied value goes through before it can
 * reach a `rove api` argv, a daemon RPC or a git process.
 */

import { execFile } from "node:child_process"
import { getSavedRepos, resolveMainRepoRoot } from "@sma1lboy/rove/src/state/repos.ts"
import { resolvePreferredVendor, setRepoLastActiveVendor } from "@sma1lboy/rove/src/state/vendor-prefs.ts"
import {
  cloneRepo,
  deriveFolderName,
  findAvailableFolderName,
  resolveCloneTarget,
  validateCloneTarget,
  validateGitUrl,
} from "@sma1lboy/rove/src/tui/component/new-task-dialog/clone.ts"
import { getCurrentBranch, listLocalBranches, validateRepoPath } from "@sma1lboy/rove/src/tui/lib/git-snapshot.ts"
import type { VendorId } from "@sma1lboy/rove/src/types/vendor.ts"
import { BridgeError } from "../protocol.ts"
import { absPath } from "./args.ts"
import type { Args, OpContext } from "./types.ts"

/**
 * Everything the task ops touch outside `ctx.api`: sync git helpers, the saved-repo list and
 * the clone spawn. One object so tests replace them without a real git remote.
 */
// Keyed by the main checkout, as the TUI's picks are; a path git cannot read keeps its given spelling.
function projectKey(path: string): string {
  try {
    return resolveMainRepoRoot(path)
  } catch {
    return path
  }
}

export const taskOpDeps = {
  savedRepos: (): readonly string[] => getSavedRepos(),
  /** The engine a project was last started on, as the TUI's picks record it: "New conversation" there follows it. */
  rememberEngine: (repo: string, engine: string): void => {
    setRepoLastActiveVendor(projectKey(repo), engine as VendorId)
  },
  /** What a picker preselects: the project's last engine, else Settings' default, else the first enabled one. */
  preferredEngine: (repo?: string): string => resolvePreferredVendor(repo === undefined ? undefined : projectKey(repo)),
  listLocalBranches,
  getCurrentBranch,
  validateRepoPath,
  cloneRepo,
  validateGitUrl,
  validateCloneTarget,
  resolveCloneTarget,
  findAvailableFolderName,
  deriveFolderName,
  gh: runGh,
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

/** What a `gh` run gave back; `reason` is a short code the app words itself: `missing`, `unauthenticated` or `failed`. */
export type GhResult = { ok: true; stdout: string } | { ok: false; reason: "missing" | "unauthenticated" | "failed" }

/** The machine's own `gh`, with its own login; never prompts. A timeout or any failure is a result, not a throw. */
function runGh(args: readonly string[], timeoutMs: number): Promise<GhResult> {
  const { promise, resolve } = Promise.withResolvers<GhResult>()
  execFile(
    "gh",
    [...args],
    { timeout: timeoutMs, maxBuffer: 8_000_000, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } },
    (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, stdout })
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return resolve({ ok: false, reason: "missing" })
      const signedOut = /gh auth login|not logged in|authentication/i.test(stderr)
      resolve({ ok: false, reason: signedOut ? "unauthenticated" : "failed" })
    },
  )
  return promise
}

/** `owner/repo`: GitHub's own name rules, one slash, never a path (`.`/`~`/`/` lead, extra segments). */
const SHORTHAND = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/

/** The clone URL for `owner/repo`: ssh when `gh` is set to use it, https otherwise (or when `gh` is absent). */
export async function githubCloneUrl(shorthand: string): Promise<string> {
  const name = shorthand.replace(/\.git$/i, "")
  const protocol = await taskOpDeps.gh(["config", "get", "git_protocol"], 3000)
  return protocol.ok && protocol.stdout.trim() === "ssh"
    ? `git@github.com:${name}.git`
    : `https://github.com/${name}.git`
}

/** `args.url` as a checked clone URL; a bare `owner/repo` is resolved through {@link githubCloneUrl} first. */
export async function cloneSource(args: Args): Promise<string> {
  const raw = typeof args.url === "string" ? args.url.trim() : ""
  if (SHORTHAND.test(raw) && !/\/\.+(git)?$/i.test(raw)) return cloneUrl({ url: await githubCloneUrl(raw) })
  return cloneUrl(args)
}

/** `owner/repo` or `host/owner/name` (the host has a dot; GitLab subgroups add segments): a repo id the target machine's `add` resolves. */
const REPO_ID =
  /^(?:[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._-]+){2,}|[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100})$/

/**
 * `--repo` of a task on another machine: a path there (absolute), or a repo id its own `add` resolves to its
 * checkout — `owner/name`, `host/owner/name` or a clone URL (under the same allowlist as {@link cloneUrl}).
 */
export function remoteRepoRef(args: Args, name = "repo"): string {
  const v = args[name]
  if (typeof v === "string" && v.startsWith("/")) return absPath(args, name)
  if (typeof v === "string" && REPO_ID.test(v)) return v
  try {
    return cloneUrl(args, name)
  } catch {
    throw new BridgeError(
      "BAD_ARGS",
      `${name} must be an absolute path or a repo id (owner/name, host/owner/name, or a clone URL)`,
    )
  }
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
