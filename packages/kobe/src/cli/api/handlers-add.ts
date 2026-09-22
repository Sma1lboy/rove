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

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { pathWithin } from "@sma1lboy/kobe-daemon/path-identity"
import { homeDir } from "../../env.ts"
import { ulid } from "../../orchestrator/index/ulid.ts"
import { deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import type { TaskStatus } from "../../types/task.ts"
import { DEFAULT_VENDOR, type VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import {
  type EngineChoice,
  type EngineFields,
  effortFor,
  engineChoice,
  enginePayload,
  modelFor,
  tierFields,
  withTierNote,
} from "./add-engine-fields.ts"
import { dispatcherEnvPayload, withPeerProvenance } from "./dispatcher.ts"
import { FANOUT_CAP, buildCountPlan, parseAgentsSpec } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/**
 * `--status` / `--pin` aren't create-time RPC fields — apply them as
 * follow-ups. Shared by the single and parallel paths so they cannot drift.
 * Returns whether anything was applied (so the caller can skip a `task.get`).
 */
async function applyPostCreateFlags(daemon: DaemonRpc, taskId: string, args: VerbContext["args"]): Promise<boolean> {
  const status = args.enumOf<TaskStatus>("status")
  if (status) await daemon.request("task.status", { taskId, status })
  const pin = args.bool("pin")
  if (pin !== undefined) await daemon.request("task.pin", { taskId, pinned: pin })
  return Boolean(status) || pin !== undefined
}

export async function add(ctx: VerbContext): Promise<unknown> {
  const { args, runtime } = ctx
  const requestedRepo = args.requireRepo("repo")
  const repo = await runtime.resolveRepoRoot(requestedRepo)
  // Without this a non-git `--repo` SUCCEEDS: `resolveRepoRoot` falls back to
  // the path verbatim and the row persists with an empty branch and
  // worktreePath, failing only later with nothing pointing back at the flag.
  if (!(await runtime.isUsableRepo(repo))) {
    throw new ApiError(
      `--repo ${repo} is not a git repository — a task needs one to cut its worktree and branch from (run \`git init\` there, or point --repo at a checkout)`,
      "NOT_A_REPO",
      helpStep("add"),
    )
  }
  const count = args.int("count")
  const agentsSpec = args.str("agents")
  const parallel = count !== undefined || agentsSpec !== undefined
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
  const result = parallel ? await addParallel(ctx, repo, count, agentsSpec) : await addOne(ctx, repo)
  return resolvedFrom && result && typeof result === "object" ? { ...result, ...resolvedFrom } : result
}

/** The typed-out engine fields: `--command` / `--effort` / `--model`, each gated. */
async function typedEngineFields(ctx: VerbContext, repo: string): Promise<EngineFields> {
  const choice = await engineChoice(ctx, repo)
  const engines = choice.vendor ? [choice.vendor] : []
  return { choice, effort: effortFor(ctx, engines), model: modelFor(ctx, engines) }
}

async function addOne(ctx: VerbContext, repo: string): Promise<unknown> {
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
  const payload: Record<string, string> = {
    repo,
    ...(await dispatcherEnvPayload()),
    ...enginePayload(fields.choice, fields.effort, fields.model, fields.tier),
  }
  const title = args.str("title") || (prompt ? deriveTitleFromPrompt(prompt) : "")
  if (title) payload.title = title
  const branch = args.str("branch")
  if (branch) payload.branch = branch
  const baseRef = args.str("base-branch")
  if (baseRef) payload.baseRef = baseRef
  const worktreeName = args.str("worktree-name")
  if (worktreeName) payload.worktreeName = worktreeName

  const res = await daemon.request<{ taskId: string; task: SerializedTask }>("task.create", payload)
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
  if (!prompt) return { taskId, task, home: homeDir(), started: false }
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
    ctx.runtime.deliverPrompt(
      daemon,
      {
        id: taskId,
        worktreePath: task.worktreePath,
        kind: task.kind,
        vendor: task.vendor as VendorId | undefined,
        command: task.command,
        modelEffort: task.modelEffort,
        model: task.model,
        repo: task.repo,
        newTask: true,
      },
      brief,
    ),
  )
  // The task IS created, so carry the taskId in the error.
  if (!delivered.delivered) {
    throw new ApiError(
      `task ${taskId} created but the prompt was not delivered (paste did not land)`,
      "NOT_DELIVERED",
      {
        taskId,
        ...tierNote,
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
    // The home actually written to — otherwise a collapsed isolation
    // override reads identically to the intended one.
    home: homeDir(),
    started: delivered.started,
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
  }
}

/**
 * Record the brief on the task. Resolves `false` (never rejects) when the
 * store refused it; callers must surface that.
 */
async function persistPrompt(daemon: DaemonRpc, taskId: string, prompt: string): Promise<boolean> {
  try {
    await daemon.request("task.setPrompt", { taskId, prompt })
    return true
  } catch (err) {
    console.error(`[rove api add] task.setPrompt failed for ${taskId} — no "Run again" for this task:`, err)
    return false
  }
}

/**
 * `--count N` / `--agents e:2,f:1`: N sibling tasks of ONE prompt, each in
 * its own worktree + branch, sharing one persisted groupId. Titles get an
 * `#i/N` ordinal here (siblings share a prompt, so bare titles collide);
 * placeholder-titled siblings get theirs from the daemon's auto-title pass
 * (keyed on groupId).
 */
async function addParallel(
  ctx: VerbContext,
  repo: string,
  count: number | undefined,
  agentsSpec: string | undefined,
): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args } = ctx
  // A parallel round with nothing to deliver would spawn N idle worktrees —
  // the prompt IS the round.
  const prompt = args.promptText()
  if (!prompt) {
    throw new ApiError(
      "--count/--agents spawn parallel attempts of ONE prompt — pass --prompt",
      "MISSING_FLAG",
      helpStep("add"),
    )
  }
  if (args.str("branch")) {
    throw new ApiError(
      "--branch names ONE branch and cannot be shared by parallel siblings — drop it (each sibling gets its own auto branch) or spawn them one at a time",
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  // Same reason, one directory instead of one branch: the second sibling
  // would collide on the name and the round would half-spawn.
  if (args.str("worktree-name")) {
    throw new ApiError(
      "--worktree-name names ONE directory and cannot be shared by parallel siblings — drop it (each sibling gets its own generated name) or spawn them one at a time",
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  // `--agents` already names each sibling's engine and count; refuse
  // `--command` / `--count` beside it rather than silently ignore — a fleet
  // is expensive to spawn wrong. `--status` / `--pin` apply per sibling.
  if (agentsSpec) {
    const conflict = count !== undefined ? "--count" : args.str("command") ? "--command" : null
    if (conflict) {
      throw new ApiError(
        `${conflict} conflicts with --agents, which already names each sibling's engine and how many — pass one or the other`,
        "BAD_FLAG",
        helpStep("add"),
      )
    }
  }
  // No --title: seed from the prompt, else N rows all read `(new task)`. The
  // auto-title pass only renames placeholders, so this is final — fine, it
  // derives from the same first message that pass would read.
  const title = args.str("title") || deriveTitleFromPrompt(prompt)
  const baseRef = args.str("base-branch")

  // `--count` repeats ONE engine — `--command`'s (full command line) or a
  // tier's; the plan carries only its protocol.
  const picked = await tierFields(ctx, prompt)
  const tier = picked.fields
  const choice = tier?.choice ?? (await engineChoice(ctx, repo))
  const plan: VendorId[] = agentsSpec
    ? parseAgentsSpec(agentsSpec)
    : buildCountPlan(count ?? 1, choice.vendor ?? DEFAULT_VENDOR)
  if (plan.length > FANOUT_CAP) {
    throw new ApiError(
      `a parallel round of ${plan.length} exceeds the cap of ${FANOUT_CAP} — spawn in batches`,
      "BAD_FLAG",
    )
  }
  const effort = tier ? tier.effort : effortFor(ctx, plan)
  const model = tier ? tier.model : modelFor(ctx, plan)
  const groupId = ulid()

  // Create serially (a pure store write; worktrees are lazy) so `#i/N`
  // ordinals match tasks.json order. Deliver concurrently: N cold boots
  // overlap (5 tasks: ~6s, not ~30s). A mid-loop create failure carries the
  // already-created tasks into PARTIAL_FANOUT so a script doesn't double-spawn.
  const created: Array<{ taskId: string; vendor: VendorId; task: SerializedTask }> = []
  let createFailure: { vendor: VendorId; error: { message: string; code: string } } | null = null
  const dispatcher = await dispatcherEnvPayload()
  for (const [i, vendor] of plan.entries()) {
    // `--agents` picks engines BY ID (command = id); `--count` reuses `--command` verbatim.
    const engine: EngineChoice = agentsSpec ? { command: vendor, vendor } : { ...choice, vendor }
    const payload: Record<string, string> = {
      repo,
      groupId,
      ...dispatcher,
      ...enginePayload(engine, effort, model, tier?.tier),
    }
    if (title) payload.title = plan.length > 1 ? `${title} #${i + 1}/${plan.length}` : title
    if (baseRef) payload.baseRef = baseRef
    try {
      const res = await daemon.request<{ taskId: string; task: SerializedTask }>("task.create", payload)
      created.push({ taskId: res.taskId, vendor, task: res.task })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "CREATE_FAILED"
      const message = err instanceof Error ? err.message : String(err)
      createFailure = { vendor, error: { message, code } }
      break
    }
  }

  // Before delivery, so the row already reads right when the engine boots.
  for (const { taskId } of created) await applyPostCreateFlags(daemon, taskId, args)

  const settled = await Promise.allSettled(
    created.map(({ taskId, vendor, task }) =>
      ctx.runtime.deliverPrompt(
        daemon,
        {
          id: taskId,
          worktreePath: task.worktreePath,
          kind: task.kind,
          vendor,
          command: task.command,
          modelEffort: task.modelEffort,
          model: task.model,
          repo: task.repo,
          newTask: true,
        },
        prompt,
      ),
    ),
  )

  const tasks: unknown[] = []
  const failures: unknown[] = []
  // Best-effort, same contract as addOne: a persist failure must NOT flip a
  // delivered sibling into a failure row.
  const persistedPrompts: Promise<unknown>[] = []
  settled.forEach((r, i) => {
    const { taskId, vendor, task } = created[i]
    if (r.status === "fulfilled" && r.value.delivered) {
      // `title` and `branch` are what the sidebar shows — the only handles a
      // spawner can name a sibling by (the worktree dir name appears nowhere).
      const row: Record<string, unknown> = {
        ok: true,
        taskId,
        title: task.title,
        branch: task.branch,
        vendor,
        started: r.value.started,
        engineReady: r.value.engineReady,
        session: r.value.session,
        ...(r.value.reason ? { reason: r.value.reason } : {}),
      }
      tasks.push(row)
      // Patched on the pushed row: the persist resolves after it is in `tasks`.
      persistedPrompts.push(
        persistPrompt(daemon, taskId, prompt).then((ok) => {
          if (!ok) row.promptPersisted = false
        }),
      )
      return
    }
    // Threw or never landed; the task IS created (engine burning tokens), so
    // always carry its taskId.
    const err =
      r.status === "rejected"
        ? r.reason
        : new ApiError(`prompt was not confirmed in ${taskId}'s engine`, "NOT_DELIVERED")
    const code = err instanceof ApiError ? err.code : "DELIVER_FAILED"
    const message = err instanceof Error ? err.message : String(err)
    failures.push({ ok: false, taskId, vendor, error: { message, code } })
  })

  // A create-stage failure row has no taskId (nothing was created for it).
  if (createFailure) failures.push({ ok: false, vendor: createFailure.vendor, error: createFailure.error })
  await Promise.all(persistedPrompts)

  const result = {
    count: created.length,
    requested: plan.length,
    groupId,
    home: homeDir(),
    tasks,
    failures,
    ...(picked.note ? { tierAuto: picked.note } : {}),
  }
  // Any failure must not exit 0: the dispatcher emits the whole result
  // (created taskIds included) to stdout and exits 3.
  if (failures.length > 0) {
    throw new ApiError(`add delivered ${tasks.length}/${plan.length}`, "PARTIAL_FANOUT", result)
  }
  return result
}
