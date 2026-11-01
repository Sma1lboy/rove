/**
 * The `add` verb — the one create path, single or parallel.
 *
 * No separate "N tasks of one prompt" verb: two verbs would make an agent
 * choose before it knows how many attempts it wants. `--count` absent =
 * exactly one task; the parallel contract (shared `groupId`, `#i/N` titles,
 * per-sibling failure rows, PARTIAL_FANOUT) applies from N=2 up. Unlike
 * `send`, an `add --count` can half-succeed, and that per-sibling
 * bookkeeping lives here.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { pathWithin } from "@sma1lboy/rove-daemon/path-identity"
import { homeDir } from "../../env.ts"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import { deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import { DEFAULT_VENDOR, type VendorId } from "../../types/vendor.ts"
import { applyPostCreateFlags, deliverArmed, persistPrompt } from "./add-delivery.ts"
import {
  type EngineFields,
  effortFor,
  engineChoice,
  enginePayload,
  foreignModelWarnings,
  launchedEngine,
  modelFor,
  tierFields,
  withTierNote,
} from "./add-engine-fields.ts"
import { addParallel } from "./add-parallel.ts"
import { type Placement, parentFlags, placeAdd, placedRequest, resolveAddParent } from "./add-parent.ts"
import { dispatcherEnvPayload, withPeerProvenance } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { type RepoSetFields, resolveRepoFlag, resolveRepoSet } from "./repo-set.ts"
import { ApiError, type PromptTarget, type VerbContext, helpStep } from "./types.ts"

export async function add(ctx: VerbContext): Promise<unknown> {
  const { args, runtime } = ctx
  const daemon = daemonOf(ctx)
  const flags = parentFlags(ctx)
  const refs = args.list("repo")
  const fork = await resolveFork(ctx)
  // A shared-directory or linked-repo child lives where its parent does, so the parent comes before the repo.
  const inherited = flags.takesParentRepo ? await resolveAddParent(ctx, daemon, flags, undefined) : null
  const requestedRepo = inherited ? inherited.repo : fork ? fork.repo : await resolveRepoFlag(ctx, refs[0] ?? "")
  const repo = inherited ? inherited.repo : await runtime.resolveRepoRoot(requestedRepo)
  // Without this a non-git `--repo` SUCCEEDS: `resolveRepoRoot` falls back to
  // the path verbatim and the row persists with an empty branch and
  // worktreePath, failing only later with nothing pointing back at the flag.
  if (!inherited && !(await runtime.isUsableRepo(repo))) {
    throw new ApiError(
      `--repo ${repo} is not a git repository — a task needs one to cut its worktree and branch from (run \`git init\` there, or point --repo at a checkout)`,
      "NOT_A_REPO",
      helpStep("add"),
    )
  }
  const count = args.int("count")
  const agentsSpec = args.str("agents")
  const parallel = count !== undefined || agentsSpec !== undefined
  if (args.bool("start") && (parallel || args.promptText())) {
    throw new ApiError(
      "--start boots one idle engine without a first message: it conflicts with --prompt/--prompt-file (which already start the engine) and with --count/--agents",
      "CONFLICTING_FLAGS",
      helpStep("add"),
    )
  }
  // Validate with git before anything is created: an unusable name otherwise
  // fails only at `ensure-worktree` as a raw RPC_ERROR, leaving a row that
  // can never materialize. Skipped for a parallel round, which refuses
  // `--branch` outright below — the more useful answer there.
  const branch = parallel ? undefined : args.str("branch")
  if (branch && !(await runtime.isValidBranchName(branch))) {
    throw new ApiError(
      `--branch ${JSON.stringify(branch)} is not a valid git branch name (no spaces, no leading "-", no "..", "~^:?*[\\", no trailing ".lock") — see \`git check-ref-format --branch\``,
      "INVALID_BRANCH",
      helpStep("add"),
    )
  }
  // A subdirectory `--repo` resolves up to the repo root; report it so a
  // typo'd path and an intended one don't produce identical output.
  // Gated on ANCESTRY, not `!==`: git reports the realpath (macOS `/tmp/x` ->
  // `/private/tmp/x`), and a symlink rewrite is never a prefix of its input.
  const resolvedFrom = pathWithin(repo, requestedRepo) ? { repoResolvedFrom: requestedRepo } : undefined
  const repoSet: RepoSetFields = inherited ? { extraRepos: [] } : await resolveRepoSet(ctx, repo, refs.slice(1))
  const workspace = args.str("workspace")
  if (workspace && (parallel || fork || repoSet.extraRepos.length > 0)) {
    throw new ApiError(
      "--workspace takes one task in one repo: it conflicts with --fork, --count, --agents, --no-worktree, --isolate-in and extra repos",
      "CONFLICTING_FLAGS",
      helpStep("add"),
    )
  }
  const parent = inherited ?? (await resolveAddParent(ctx, daemon, flags, repo))
  const placement = await placeAdd(ctx, parent, flags, {
    repo,
    fork: fork !== undefined,
    baseRef: args.str("base-branch") ?? repoSet.primaryBaseRef,
    multiRepo: repoSet.extraRepos.length > 0,
    ownWorkspace: workspace !== undefined,
  })
  const result = parallel
    ? await addParallel(ctx, repo, repoSet, placement, count, agentsSpec)
    : await addOne(ctx, repo, repoSet, placement)
  return resolvedFrom && result && typeof result === "object" ? { ...result, ...resolvedFrom } : result
}

/** Flags that name a different repo or fork point than the parent's own, so they cannot ride along with `--fork`. */
const FORK_EXCLUSIVE = ["repo", "base-branch", "base-for", "count", "agents"] as const

/** `--fork ID`: the parent task whose worktree (uncommitted work included) the new task clones, and its repo. */
async function resolveFork(ctx: VerbContext): Promise<{ taskId: string; repo: string } | undefined> {
  const taskId = ctx.args.str("fork")
  if (!taskId) return undefined
  const clash = FORK_EXCLUSIVE.find((flag) => ctx.args.str(flag) !== undefined)
  if (clash) {
    throw new ApiError(
      `--fork and --${clash} conflict — a fork is a sibling in the parent's repo, starting at the parent's HEAD`,
      "CONFLICTING_FLAGS",
      helpStep("add"),
    )
  }
  const { task } = await daemonOf(ctx).request<{ task: SerializedTask }>("task.get", { taskId })
  return { taskId, repo: task.repo }
}

/** The typed-out engine fields: `--command` / `--effort` / `--model`, each gated. */
async function typedEngineFields(ctx: VerbContext, repo: string): Promise<EngineFields> {
  const choice = await engineChoice(ctx, repo)
  const engines = choice.vendor ? [choice.vendor] : []
  return { choice, effort: effortFor(ctx, engines), model: modelFor(ctx, engines) }
}

/** The task as the engine launcher addresses it; `newTask` marks a first prompt the launch itself carries. */
function deliveryTarget(task: SerializedTask, newTask = false): PromptTarget {
  return {
    id: task.id,
    worktreePath: taskCwd(task),
    kind: task.kind,
    vendor: task.vendor as VendorId | undefined,
    command: task.command,
    modelEffort: task.modelEffort,
    model: task.model,
    repo: task.repo,
    // A shared child has no repos of its own: its owner's are read.
    ...(task.extraRepos?.length || task.sharesWorkspaceOf ? { multiRepo: true } : {}),
    ...(newTask ? { newTask: true } : {}),
  }
}

async function addOne(ctx: VerbContext, repo: string, repoSet: RepoSetFields, placement: Placement): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args } = ctx
  // Read (and validate) the prompt BEFORE `task.create`: its throws would
  // otherwise leave an orphan task behind an error carrying no taskId.
  const prompt = args.promptText()
  // The dispatcher is the reply address a sub-task's bare `send` routes to.
  // `--tier auto` reads the prompt, so it resolves after it; a declined
  // classifier leaves `fields` empty, which is the typed path.
  const picked = await tierFields(ctx, prompt)
  const fields = picked.fields ?? (await typedEngineFields(ctx, repo))
  const tierNote: Record<string, string> = picked.note ? { tierAuto: picked.note } : {}
  const warnings = foreignModelWarnings([fields.choice.vendor ?? DEFAULT_VENDOR], fields.model)
  const warned = warnings.length > 0 ? { warnings } : {}
  const payload: Record<string, unknown> = {
    repo,
    ...(await dispatcherEnvPayload(daemon)),
    ...enginePayload(fields.choice, fields.effort, fields.model, fields.tier),
  }
  // A fork without --title keeps the parent-derived name the daemon gives it rather than being renamed from the prompt.
  const fork = args.str("fork")
  const title = args.str("title") || (prompt && !fork ? deriveTitleFromPrompt(prompt) : "")
  if (title) payload.title = title
  const branch = args.str("branch")
  if (branch) payload.branch = branch
  const baseRef = args.str("base-branch") ?? repoSet.primaryBaseRef
  if (baseRef) payload.baseRef = baseRef
  if (fork) payload.forkFrom = fork
  const workspace = args.str("workspace")
  if (workspace) payload.workspace = workspace
  if (repoSet.extraRepos.length > 0) payload.extraRepos = repoSet.extraRepos
  const worktreeName = args.str("worktree-name")
  if (worktreeName) payload.worktreeName = worktreeName

  const request = placedRequest(placement, payload)
  const res = await daemon.request<{
    taskId: string
    task: SerializedTask
    parentDirty?: boolean
    sharedLinks?: string[]
  }>(request.method, request.payload)
  // Only a child cut from its parent reports whether the parent had uncommitted work the new worktree lacks.
  const placed =
    res.parentDirty === undefined ? {} : { parentDirty: res.parentDirty, sharedLinks: res.sharedLinks ?? [] }
  const taskId = res.taskId
  // Every mounted TUI follows the shared active task, so only steal it when
  // asked — a background agent/cron must not yank focus on every create.
  if (args.bool("activate")) await daemon.request("task.setActive", { taskId })

  let task = res.task
  if (await applyPostCreateFlags(daemon, taskId, args)) {
    task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
  }

  // No `tierNote` here on purpose: `--tier auto` refuses a create with nothing
  // to classify, so a note and an absent prompt cannot coexist.
  if (!prompt) {
    if (!args.bool("start")) {
      return { taskId, task, engine: launchedEngine(task), home: homeDir(), ...placed, started: false, ...warned }
    }
    // `--start`: no first message, but the engine boots idle in the task's own tab-1. The task IS created, so a failure names it.
    try {
      const opened = await ctx.runtime.openTab(daemon, deliveryTarget(task), "engine")
      return {
        taskId,
        task,
        engine: launchedEngine(task),
        home: homeDir(),
        ...placed,
        started: true,
        tabId: opened.tab.id,
        session: opened.session,
        ...warned,
      }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      throw new ApiError(err.message, err.code, { ...err.data, taskId, ...placed, ...warned })
    }
  }
  // Same provenance prefix `send` carries: the `dispatcher` row field is data
  // a receiver must think to read; this puts the reply address in the brief.
  // No-op for a create from a plain shell.
  const brief = await withPeerProvenance(daemon, taskId, prompt)
  // Delivery failures (SESSION_FAILED and friends) are raised inside
  // `deliverPrompt`, which knows nothing about tiers — so what `--tier auto`
  // decided would vanish exactly when the caller most needs it. The task IS
  // created and IS carrying whatever tier was picked; an error that omits
  // that leaves an agent unable to tell "it routed to deep and the engine
  // died" from "it never routed at all" without a second round-trip.
  const delivered = await withTierNote(tierNote, () =>
    deliverArmed(ctx, daemon, taskId, deliveryTarget(task, true), brief),
  )
  // The task IS created, so carry the taskId in the error.
  if (!delivered.delivered) {
    throw new ApiError(
      `task ${taskId} created but the prompt was not delivered (paste did not land)`,
      "NOT_DELIVERED",
      {
        taskId,
        engine: launchedEngine(task),
        ...placed,
        ...tierNote,
        ...warned,
      },
    )
  }
  // Persist the brief — the engine transcript is NOT durable. Only AFTER
  // delivery confirms, so `.task.prompt` means "the engine was given exactly
  // this text". Best-effort (the engine already has it) but never silent:
  // without it the sidebar menu drops **Run again** (`tree-menu.ts`).
  const promptPersisted = await persistPrompt(daemon, taskId, prompt)
  task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
  return {
    taskId,
    task,
    engine: launchedEngine(task),
    // The home actually written to — otherwise a collapsed isolation
    // override reads identically to the intended one.
    home: homeDir(),
    ...placed,
    started: delivered.started,
    ...(delivered.deliveryId ? { deliveryId: delivered.deliveryId } : {}),
    engineReady: delivered.engineReady,
    session: delivered.session,
    delivered: delivered.delivered,
    ...(delivered.bytes === undefined ? {} : { bytes: delivered.bytes }),
    ...(delivered.promptEcho ? { promptEcho: delivered.promptEcho } : {}),
    // Only set when nothing confirmed the engine — say WHY rather than
    // leaving `engineReady: false` to be read as a bare failure.
    ...(delivered.reason ? { reason: delivered.reason } : {}),
    ...(promptPersisted ? {} : { promptPersisted: false }),
    ...tierNote,
    ...warned,
  }
}
