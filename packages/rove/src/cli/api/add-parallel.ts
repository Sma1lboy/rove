/**
 * `add --count N` / `--agents`: the parallel round. Unlike `send`, a round can
 * half-succeed, and that per-sibling bookkeeping lives here.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { homeDir } from "../../env.ts"
import { ulid } from "../../orchestrator/index/ulid.ts"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import { deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import { DEFAULT_VENDOR, type VendorId } from "../../types/vendor.ts"
import { applyPostCreateFlags, deliverArmed, persistPrompt } from "./add-delivery.ts"
import {
  type EngineChoice,
  effortFor,
  engineChoice,
  enginePayload,
  foreignModelWarnings,
  launchedEngine,
  modelFor,
  tierFields,
} from "./add-engine-fields.ts"
import { type Placement, placedRequest } from "./add-parent.ts"
import { dispatcherEnvPayload } from "./dispatcher.ts"
import { FANOUT_CAP, buildCountPlan, parseAgentsSpec } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import type { RepoSetFields } from "./repo-set.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/**
 * `--count N` / `--agents e:2,f:1`: N sibling tasks of ONE prompt, each in
 * its own worktree + branch, sharing one persisted groupId. Titles get an
 * `#i/N` ordinal here (siblings share a prompt, so bare titles collide);
 * placeholder-titled siblings get theirs from the daemon's auto-title pass
 * (keyed on groupId).
 */
export async function addParallel(
  ctx: VerbContext,
  repo: string,
  repoSet: RepoSetFields,
  placement: Placement,
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
  const baseRef = args.str("base-branch") ?? repoSet.primaryBaseRef

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
  const warnings = foreignModelWarnings(plan, model)
  const groupId = ulid()

  // Create serially (a pure store write; worktrees are lazy) so `#i/N`
  // ordinals match tasks.json order. Deliver concurrently: N cold boots
  // overlap (5 tasks: ~6s, not ~30s). A mid-loop create failure carries the
  // already-created tasks into PARTIAL_FANOUT so a script doesn't double-spawn.
  const created: Array<{ taskId: string; vendor: VendorId; task: SerializedTask }> = []
  let createFailure: { vendor: VendorId; error: { message: string; code: string } } | null = null
  const dispatcher = await dispatcherEnvPayload(daemon)
  for (const [i, vendor] of plan.entries()) {
    // `--agents` picks engines BY ID (command = id); `--count` reuses `--command` verbatim.
    const engine: EngineChoice = agentsSpec ? { command: vendor, vendor } : { ...choice, vendor }
    const payload: Record<string, unknown> = {
      repo,
      groupId,
      ...dispatcher,
      ...enginePayload(engine, effort, model, tier?.tier),
    }
    if (title) payload.title = plan.length > 1 ? `${title} #${i + 1}/${plan.length}` : title
    if (baseRef) payload.baseRef = baseRef
    if (repoSet.extraRepos.length > 0) payload.extraRepos = repoSet.extraRepos
    try {
      const request = placedRequest(placement, payload)
      const res = await daemon.request<{ taskId: string; task: SerializedTask }>(request.method, request.payload)
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
      deliverArmed(
        ctx,
        daemon,
        taskId,
        {
          id: taskId,
          worktreePath: taskCwd(task),
          kind: task.kind,
          vendor,
          command: task.command,
          modelEffort: task.modelEffort,
          model: task.model,
          repo: task.repo,
          ...(task.extraRepos?.length ? { multiRepo: true } : {}),
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
        engine: launchedEngine(task),
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
    failures.push({ ok: false, taskId, vendor, engine: launchedEngine(task), error: { message, code } })
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
    ...(warnings.length > 0 ? { warnings } : {}),
  }
  // Any failure must not exit 0: the dispatcher emits the whole result
  // (created taskIds included) to stdout and exits 3.
  if (failures.length > 0) {
    throw new ApiError(`add delivered ${tasks.length}/${plan.length}`, "PARTIAL_FANOUT", result)
  }
  return result
}
