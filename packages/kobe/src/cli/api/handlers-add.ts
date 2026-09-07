/**
 * The `add` verb — the one create path, single or parallel.
 *
 * There is deliberately no separate "N tasks of one prompt" verb: it is the
 * same create-then-deliver loop with a count, and two verbs would make an
 * agent choose one before it knows how many attempts it wants. `--count`
 * absent = exactly one task, and the whole parallel contract (shared
 * `groupId`, `#i/N` titles, per-sibling failure rows, PARTIAL_FANOUT) applies
 * from N=2 up.
 *
 * Its own module rather than living beside `send` in `handlers-tasks.ts`: the
 * handlers there act on a task that already exists, while everything here is
 * the create path and its parallel contract. That is also where the failure
 * modes diverge — a `send` either lands or does not, whereas an `add --count`
 * can half-succeed (PARTIAL_FANOUT), and that per-sibling bookkeeping is what
 * this file exists to hold.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { homeDir } from "../../env.ts"
import { ulid } from "../../orchestrator/index/ulid.ts"
import { deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import type { TaskStatus } from "../../types/task.ts"
import { DEFAULT_VENDOR, type VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { type EngineChoice, effortFor, engineChoice, enginePayload } from "./add-engine-fields.ts"
import { dispatcherEnvPayload, withPeerProvenance } from "./dispatcher.ts"
import { FANOUT_CAP, buildCountPlan, parseAgentsSpec } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/**
 * `--status` / `--pin` aren't create-time fields on the RPC — apply them as
 * follow-ups so `add` is the one-stop "make me a task exactly like this".
 * Shared by the single and parallel paths so the two cannot drift: the
 * parallel path once read neither flag, and both validated, passed, and
 * silently evaporated. Returns whether anything was applied (the caller
 * decides whether a refreshed `task.get` is worth the round-trip).
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
  // A task's isolation unit is a git worktree + branch, so a `--repo` that is
  // not a git repo has nothing to cut one from. Without this the create
  // SUCCEEDS: `resolveRepoRoot` falls back to the path verbatim, the row
  // persists with an empty branch and an empty worktreePath, and the caller
  // gets `ok: true`. The failure surfaces minutes later when someone opens the
  // row and lands on an empty path — by which point nothing points back at the
  // argument that caused it.
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
  // `--branch` was type-checked and passed straight through, so an unusable
  // name landed in the store and `add` still exited 0. The failure surfaced
  // at `ensure-worktree` as a raw `git worktree add` transcript under
  // `RPC_ERROR` — no code naming the cause, no hint, and a backlog row left
  // behind that can never materialize. git is asked here, before anything is
  // created, because git is what runs `worktree add -b` later.
  //
  // Skipped for a parallel round, which refuses `--branch` outright further
  // down: siblings cannot share one branch, and "you cannot pass this flag
  // here at all" is the more useful answer than "this name is malformed".
  const branch = parallel ? undefined : args.str("branch")
  if (branch && !(await runtime.isValidBranchName(branch))) {
    throw new ApiError(
      `--branch ${JSON.stringify(branch)} is not a valid git branch name (no spaces, no leading "-", no "..", "~^:?*[\\", no trailing ".lock") — see \`git check-ref-format --branch\``,
      "INVALID_BRANCH",
      helpStep("add"),
    )
  }
  // A `--repo` pointing at a SUBDIRECTORY resolves up to the repo root, and
  // said nothing about it: `--repo my-repo/packages/app/src` came back as
  // `"repo": "…/my-repo"` with no trace of the four levels it climbed, so a
  // typo'd path and an intended one produce identical output. Reported
  // beside `identityWarning` — the other "we accepted this, but not as you
  // wrote it" field.
  //
  // Gated on ANCESTRY, not on `!==`: `resolveRepoRoot` shells git, which
  // reports the realpath, so a plain `--repo /tmp/x` on macOS comes back as
  // `/private/tmp/x` and a `!==` test would flag every correct path there.
  // A symlink rewrite is not a prefix of the path it rewrote; a climbed-out-of
  // subdirectory always is.
  const resolvedFrom = requestedRepo.startsWith(`${repo}/`) ? { repoResolvedFrom: requestedRepo } : undefined
  const result = parallel ? await addParallel(ctx, repo, count, agentsSpec) : await addOne(ctx, repo)
  return resolvedFrom && result && typeof result === "object" ? { ...result, ...resolvedFrom } : result
}

async function addOne(ctx: VerbContext, repo: string): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args } = ctx
  // Read (and validate) the prompt BEFORE anything is created. `promptText`
  // is flag validation — mutual exclusion of --prompt/--prompt-file — plus a
  // file read, and both of its throws used to fire after `task.create` had
  // committed, leaving an orphan task behind an error carrying no taskId.
  // `addParallel` has always read it first; this matches.
  const prompt = args.promptText()
  // Record who dispatched this create — the reply address a
  // sub-task's bare `send` routes its outcome back to.
  const choice = await engineChoice(ctx, repo)
  const effort = effortFor(ctx, choice.vendor ? [choice.vendor] : [])
  const payload: Record<string, string> = { repo, ...(await dispatcherEnvPayload()), ...enginePayload(choice, effort) }
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
  // Only steal the shared active-task focus (which every mounted TUI's Tasks
  // pane follows) when explicitly asked — a background agent/cron building
  // tasks must not yank the user's focus on every create. Matches the
  // parallel path, which never setActive, and the "opening content doesn't
  // pull focus" taste.
  if (args.bool("activate")) await daemon.request("task.setActive", { taskId })

  let task = res.task
  if (await applyPostCreateFlags(daemon, taskId, args)) {
    task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
  }

  if (!prompt) return { taskId, task, home: homeDir(), started: false }
  // Same provenance prefix `send` carries: a task created from inside another
  // kobe session is agent-to-agent, and its opening brief is where the reply
  // address matters most — every report this task ever sends goes back through
  // it. `add` already records the sender as `dispatcher` on the task row, but
  // that is data a receiver has to think to go read; this puts it in the
  // message. No-ops for a create from a plain shell, so a human's `rove add`
  // is unchanged.
  const brief = await withPeerProvenance(daemon, taskId, prompt)
  const delivered = await ctx.runtime.deliverPrompt(
    daemon,
    {
      id: taskId,
      worktreePath: task.worktreePath,
      kind: task.kind,
      vendor: task.vendor as VendorId | undefined,
      command: task.command,
      modelEffort: task.modelEffort,
      repo: task.repo,
      newTask: true,
    },
    brief,
  )
  // A prompt that never confirmed is a failure — but the
  // task IS created, so carry the taskId in the error so a script can find it.
  if (!delivered.delivered) {
    throw new ApiError(
      `task ${taskId} created but the prompt was not delivered (paste did not land)`,
      "NOT_DELIVERED",
      {
        taskId,
      },
    )
  }
  // Persist the brief on the task record — the engine's own transcript is
  // NOT durable, and a delivered prompt that only lived in the session died
  // with the engine. Recorded only AFTER delivery confirms, so `get-task`'s
  // `.task.prompt` always means "the engine was given exactly this text".
  // Best-effort: the engine already has the prompt, so a persist failure
  // must not turn a delivered task into an error — but it must not be silent
  // either. Without `.task.prompt` the sidebar menu drops **Run again**
  // (`tui/panes/sidebar/tree-menu.ts` gates the verb on it), so the action is
  // gone forever with nothing on screen or in the result explaining why.
  const promptPersisted = await persistPrompt(daemon, taskId, prompt)
  task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
  return {
    taskId,
    task,
    // The home this create actually wrote to. A success payload that never
    // names its destination cannot be wrong about it — a collapsed isolation
    // override reads identically to the intended one, which is how four
    // fan-out tasks once landed in a production `~/.rove` with `failures: []`.
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
  }
}

/**
 * Record the brief on the task. Resolves `false` (never rejects) when the
 * store refused it — see the call sites for why that stays best-effort and
 * why the caller must still SAY so.
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
 * its own worktree + branch. Every sibling of this round shares one groupId,
 * so the grouping outlives this CLI call rather than living only in the JSON
 * output. Siblings share the prompt, so bare titles would converge onto the
 * SAME name — an explicit --title gets its `#i/N` ordinal here; placeholder-
 * titled siblings get theirs appended by the daemon's auto-title pass (keyed
 * on groupId) when the prompt-derived name lands.
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
  // `--agents` already names an engine per sibling AND how many of each, so
  // `--command` / `--count` alongside it have nothing left to say. Refuse
  // rather than silently ignore — a caller who wrote both believes both
  // applied, and a fleet is expensive to spawn wrong (same reasoning as
  // `send --command` without `--tab new`). `--status` / `--pin` are NOT
  // conflicts: they apply per sibling below (applyPostCreateFlags), the same
  // as on a single `add`.
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
  // No --title: seed from the prompt we are about to deliver. Without this a
  // fan-out lands N rows all called `(new task)` — which is what QUICKSTART's
  // own example produces, at exactly the step that tells the reader to compare
  // the attempts. The daemon's auto-title pass only renames tasks still
  // carrying the placeholder, so a seeded title is final; that is the right
  // outcome, since it derives from the same first user message that pass would
  // have read back out of the transcript minutes later.
  const title = args.str("title") || deriveTitleFromPrompt(prompt)
  const baseRef = args.str("base-branch")

  // `--agents` names engines per sibling; `--count` repeats ONE engine, which
  // is `--command`'s when given (a full command line included — the plan just
  // carries its protocol, and every sibling launches the same command).
  const choice = await engineChoice(ctx, repo)
  const plan: VendorId[] = agentsSpec
    ? parseAgentsSpec(agentsSpec)
    : buildCountPlan(count ?? 1, choice.vendor ?? DEFAULT_VENDOR)
  if (plan.length > FANOUT_CAP) {
    throw new ApiError(
      `a parallel round of ${plan.length} exceeds the cap of ${FANOUT_CAP} — spawn in batches`,
      "BAD_FLAG",
    )
  }
  const effort = effortFor(ctx, plan)
  const groupId = ulid()

  // Create serially — task.create is a pure store write (worktrees are lazy,
  // materialized during delivery below), and ordered creation keeps `#i/N`
  // ordinals aligned with tasks.json order. Delivery then runs concurrently:
  // sessions are task-id isolated, so N cold-boot waits overlap (5 tasks:
  // ~6s, not ~30s). A mid-loop create failure must NOT orphan the tasks
  // already created — carry them into the PARTIAL_FANOUT payload so a script
  // can retry or delete them instead of double-spawning.
  const created: Array<{ taskId: string; vendor: VendorId; task: SerializedTask }> = []
  let createFailure: { vendor: VendorId; error: { message: string; code: string } } | null = null
  // Every sibling records the same dispatcher — the reply
  // address each worker's bare `send` routes its outcome back to.
  const dispatcher = await dispatcherEnvPayload()
  for (const [i, vendor] of plan.entries()) {
    // `--agents` picks each sibling's engine BY ID, so its command is that
    // id; a `--count` round reuses the caller's own `--command` verbatim.
    const engine: EngineChoice = agentsSpec ? { command: vendor, vendor } : { ...choice, vendor }
    const payload: Record<string, string> = { repo, groupId, ...dispatcher, ...enginePayload(engine, effort) }
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

  // Same `--status` / `--pin` follow-ups a single `add` applies, once per
  // created sibling — before delivery so the row already reads right when the
  // engine boots.
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
          repo: task.repo,
          newTask: true,
        },
        prompt,
      ),
    ),
  )

  const tasks: unknown[] = []
  const failures: unknown[] = []
  // Best-effort per-sibling brief persistence (same contract as addOne) —
  // collected here, awaited below. A persist failure must NOT flip a
  // delivered sibling into a failure row: the engine already has the prompt.
  const persistedPrompts: Promise<unknown>[] = []
  settled.forEach((r, i) => {
    const { taskId, vendor } = created[i]
    if (r.status === "fulfilled" && r.value.delivered) {
      const row: Record<string, unknown> = {
        ok: true,
        taskId,
        vendor,
        started: r.value.started,
        engineReady: r.value.engineReady,
        session: r.value.session,
        ...(r.value.reason ? { reason: r.value.reason } : {}),
      }
      tasks.push(row)
      // Same contract as `addOne`: a refused persist keeps the sibling a
      // success, and marks the row so the caller knows this one lost its
      // **Run again**. Patched on the pushed object because the awaits below
      // resolve after the row is already in `tasks`.
      persistedPrompts.push(
        persistPrompt(daemon, taskId, prompt).then((ok) => {
          if (!ok) row.promptPersisted = false
        }),
      )
      return
    }
    // Either deliverPrompt threw, or it resolved un-delivered (the paste
    // never landed). The task IS created (engine already burning
    // tokens) — always carry its taskId so a script can find/retry it instead
    // of orphaning it.
    const err =
      r.status === "rejected"
        ? r.reason
        : new ApiError(`prompt was not confirmed in ${taskId}'s engine`, "NOT_DELIVERED")
    const code = err instanceof ApiError ? err.code : "DELIVER_FAILED"
    const message = err instanceof Error ? err.message : String(err)
    failures.push({ ok: false, taskId, vendor, error: { message, code } })
  })

  // A create-stage failure is a failure row WITHOUT a taskId (nothing was
  // created for it) — but the siblings created before it are real, engine-
  // burning tasks whose ids must reach the script.
  if (createFailure) failures.push({ ok: false, vendor: createFailure.vendor, error: createFailure.error })
  await Promise.all(persistedPrompts)

  const result = { count: created.length, requested: plan.length, groupId, home: homeDir(), tasks, failures }
  // Partial (or total) create/delivery failure must not exit 0 — carry the
  // whole result (created taskIds included) up so the dispatcher emits it to
  // stdout + exits 3.
  if (failures.length > 0) {
    throw new ApiError(`add delivered ${tasks.length}/${plan.length}`, "PARTIAL_FANOUT", result)
  }
  return result
}
