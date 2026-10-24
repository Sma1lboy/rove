/**
 * `add --repo A --repo B [--base-for REPO=REF]`: the repos a task spans. The
 * first `--repo` is the primary; the rest become the task's `extraRepos`. The
 * daemon enforces the same rules (`planExtraRepos`) — checking here first names
 * the offending flag instead of surfacing a bare RPC refusal.
 */

import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { MULTI_REPO_CAP, repoNameOf, uniqueRepoName } from "@sma1lboy/rove-daemon/task-tree"
import { errorMessage } from "../../lib/error-message.ts"
import { cloneDirFor, cloneRepo, parseRepoRef } from "../../machines/repo-ref.ts"
import { addSavedRepo, isRemoteRepoKey } from "../../state/repos.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"
import { resolveLocalRepo } from "./verbs-repo-match.ts"

/** One extra repo as `task.create` takes it. */
export interface ExtraRepoWire {
  readonly repo: string
  readonly baseRef?: string
}

/** What the repo flags add to a create beyond the primary repo. */
export interface RepoSetFields {
  readonly extraRepos: readonly ExtraRepoWire[]
  /** The primary's base from `--base-for`, when it named the primary. */
  readonly primaryBaseRef?: string
}

/**
 * One `--repo` value as a checkout path: a path as given, a repo id (`owner/name`, a URL) as this
 * machine's checkout of it — cloned first with `--clone`, else a NO_LOCAL_CHECKOUT naming the fix.
 */
export async function resolveRepoFlag(ctx: VerbContext, raw: string): Promise<string> {
  const ref = parseRepoRef(raw, ctx.caller.cwd ?? process.cwd())
  if (ref.kind === "path") return ctx.args.repoPath("repo", raw)
  const found = await resolveLocalRepo(ctx, { origin: ref.id })
  if (found.repo) return found.repo
  if (ctx.args.bool("clone") !== true) {
    throw new ApiError(`no checkout of ${ref.id} on this machine`, "NO_LOCAL_CHECKOUT", {
      hint: `pass --clone to clone it into ${cloneDirFor(ref.id)}, or --repo with a checkout's path`,
    })
  }
  try {
    const dir = cloneRepo(ref)
    addSavedRepo(dir)
    return dir
  } catch (err) {
    throw new ApiError(`could not clone ${ref.cloneUrl}: ${errorMessage(err)}`, "CLONE_FAILED", {
      hint: "check this machine can fetch it (`git ls-remote <url>`), or clone it yourself and pass its path",
    })
  }
}

/** The task's other repos (every `--repo` after the first), validated and with their `--base-for` refs. */
export async function resolveRepoSet(
  ctx: VerbContext,
  primary: string,
  extraRefs: readonly string[],
): Promise<RepoSetFields> {
  const { args, runtime } = ctx
  const baseFor = args.list("base-for")
  if (extraRefs.length === 0) {
    if (baseFor.length > 0) {
      throw new ApiError(
        "--base-for names a repo of a multi-repo task — pass --repo more than once",
        "BAD_FLAG",
        helpStep("add"),
      )
    }
    return { extraRepos: [] }
  }
  if (1 + extraRefs.length > MULTI_REPO_CAP) {
    throw new ApiError(
      `${1 + extraRefs.length} repos exceed the cap of ${MULTI_REPO_CAP} per task (the first --repo is the primary)`,
      "TOO_MANY_REPOS",
      helpStep("add"),
    )
  }
  if (isRemoteRepoKey(primary)) {
    throw new ApiError(
      `--repo ${primary} is a remote project; a multi-repo task must keep every repo local`,
      "REMOTE_EXTRA_UNSUPPORTED",
    )
  }
  const names = new Set([repoNameOf(primary)])
  const repos: { name: string; repo: string }[] = [{ name: repoNameOf(primary), repo: primary }]
  for (const raw of extraRefs) {
    const requested = await resolveRepoFlag(ctx, raw)
    if (isRemoteRepoKey(requested)) {
      throw new ApiError(
        `--repo ${raw} is a remote project; a multi-repo task must keep every repo local`,
        "REMOTE_EXTRA_UNSUPPORTED",
        helpStep("add"),
      )
    }
    const root = await runtime.resolveRepoRoot(requested)
    if (!(await runtime.isUsableRepo(root))) {
      throw new ApiError(
        `--repo ${raw} is not a git repository — every repo of a task needs one to cut its worktree and branch from`,
        "NOT_A_GIT_REPO",
        helpStep("add"),
      )
    }
    if (repos.some((r) => samePath(r.repo, root))) {
      throw new ApiError(
        `--repo ${raw} resolves to ${root}, already part of this task`,
        "REPO_DUPLICATE",
        helpStep("add"),
      )
    }
    const name = uniqueRepoName(repoNameOf(root), names)
    names.add(name)
    repos.push({ name, repo: root })
  }

  const baseRefs = new Map<string, string>()
  for (const spec of baseFor) {
    const eq = spec.indexOf("=")
    const key = spec.slice(0, eq)
    const ref = spec.slice(eq + 1)
    if (eq <= 0 || !ref)
      throw new ApiError(`--base-for ${JSON.stringify(spec)} must be REPO=REF`, "BAD_FLAG", helpStep("add"))
    const target = repos.find(
      (r) => r.name === key || (key.includes("/") && samePath(r.repo, args.repoPath("base-for", key))),
    )
    if (!target) {
      throw new ApiError(
        `--base-for ${key}: no such repo in this task (repos: ${repos.map((r) => r.name).join(", ")})`,
        "BAD_FLAG",
        helpStep("add"),
      )
    }
    if (baseRefs.has(target.name)) throw new ApiError(`--base-for ${key} given twice`, "BAD_FLAG", helpStep("add"))
    baseRefs.set(target.name, ref)
  }
  const primaryBaseRef = baseRefs.get(repos[0]?.name ?? "")
  const explicit = args.str("base-branch")
  if (primaryBaseRef && explicit && primaryBaseRef !== explicit) {
    throw new ApiError(
      `--base-branch ${explicit} and --base-for ${repos[0]?.name}=${primaryBaseRef} both set the primary's base — pass one`,
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  return {
    extraRepos: repos.slice(1).map((r) => {
      const baseRef = baseRefs.get(r.name)
      return { repo: r.repo, ...(baseRef ? { baseRef } : {}) }
    }),
    ...(primaryBaseRef ? { primaryBaseRef } : {}),
  }
}
