/**
 * The `routine` verb group — daemon-owned schedules that create tasks or
 * deliver prompts into an existing conversation.
 * One file per `VerbGroup`, mirroring the taxonomy
 * `rove api schema --group routine` prints — though it is each spec's own
 * `group` field, not this file, that decides where a verb lists. Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 *
 * By default every firing creates a FRESH task (worktree + branch + engine
 * session) with the automation's prompt as its first message.
 * `--persistent-session` swaps that for ONE standing task the schedule
 * re-delivers into, so a daily routine can build on yesterday. Mechanics live
 * in `docs/design/automations.md`.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { requirePromptText } from "./handlers-tasks.ts"
import { ApiError, type VerbSpec } from "./types.ts"

const SCHEDULE_FLAG = {
  name: "schedule",
  type: "string",
  placeholder: "CRON",
  description: "Five-field cron in the daemon host's local time, e.g. '0 9 * * MON-FRI'.",
} as const

const PRECHECK_FLAGS = [
  {
    name: "precheck",
    type: "string",
    placeholder: "CMD",
    description:
      "Shell command run in the repo BEFORE the engine starts. Non-zero exit skips the run without spawning an agent — the cheap way to avoid burning a turn when nothing changed.",
  },
  {
    name: "precheck-timeout",
    type: "int",
    placeholder: "SEC",
    default: "120",
    description: "Seconds before the precheck is killed and the run skipped.",
  },
] as const

const GRACE_FLAG = {
  name: "grace",
  type: "uint",
  placeholder: "MIN",
  default: "60",
  description:
    "How late a missed occurrence may still run when the daemon was down. Only the most recent missed occurrence is ever run.",
} as const

const PERSISTENT_FLAG = {
  name: "persistent-session",
  type: "bool",
  description:
    "Re-deliver into ONE standing task instead of a fresh worktree per run — for a routine that needs yesterday's context (a trend check). Its task is folded behind the sidebar's routine count row. Leave off for a routine that EDITS code: a week of runs on one branch is a branch nobody can land.",
} as const

const TARGET_FLAGS = [
  {
    name: "target-task",
    type: "string",
    placeholder: "ID",
    description:
      "Existing task id. Requires --target-tab; never creates or revives a session. Pass both empty to clear on update.",
  },
  {
    name: "target-tab",
    type: "string",
    placeholder: "TAB",
    description: "Exact existing engine tab id, e.g. tab-2. Requires --target-task.",
  },
] as const

function targetPayload(ctx: Parameters<VerbSpec["handler"]>[0]): Record<string, unknown> {
  const hasTask = ctx.args.present("target-task")
  const hasTab = ctx.args.present("target-tab")
  if (!hasTask && !hasTab) return {}
  if (!hasTask || !hasTab) throw new ApiError("--target-task and --target-tab must be supplied together", "BAD_FLAG")
  const taskId = ctx.args.str("target-task")
  const tabId = ctx.args.str("target-tab")
  if (!taskId && !tabId) return { target: null }
  if (!taskId || !tabId) throw new ApiError("both target values must be nonempty, or both empty to clear", "BAD_FLAG")
  return { target: { kind: "existing-tab", taskId, tabId } }
}

/**
 * Shared `--precheck` → payload shape. `--precheck ''` sends `precheck: null`,
 * which the daemon reads as "clear it" on update (a no-op on create, which has
 * nothing to clear). The flag must be read with {@link VerbArgs.present}, not
 * `str`: `str` folds an empty value into "absent", so `--precheck ''` would
 * otherwise omit the field and silently leave the existing precheck in place.
 *
 * `--precheck-timeout` on its own is REFUSED rather than dropped. The daemon
 * stores the precheck as one record, so a timeout with no command has nothing
 * to attach to — and silently omitting it made `routine-update
 * --precheck-timeout 5` return the routine with its OLD timeout and no error,
 * i.e. report a change it had not made. Retyping the command is the price of
 * the call meaning what it says.
 */
function precheckPayload(ctx: Parameters<VerbSpec["handler"]>[0]): Record<string, unknown> {
  if (!ctx.args.present("precheck")) {
    if (ctx.args.present("precheck-timeout")) {
      throw new ApiError(
        "--precheck-timeout requires --precheck (pass the command again to change its timeout)",
        "BAD_FLAG",
      )
    }
    return {}
  }
  const command = ctx.args.str("precheck")
  if (command === undefined) return { precheck: null }
  return { precheck: { command, timeoutSeconds: ctx.args.int("precheck-timeout") ?? 120 } }
}

export const ROUTINE_VERBS: readonly VerbSpec[] = [
  {
    name: "routine-list",
    group: "routine",
    summary: "List scheduled routines with their next run time.",
    flags: [],
    handler: (ctx) => simpleRpc(ctx, "automation.list", {}),
  },
  {
    name: "routine-create",
    group: "routine",
    summary:
      "Schedule a prompt. Each firing creates a fresh task (worktree + engine) and delivers it. Use --target-task and --target-tab for an existing conversation. An enabled routine keeps the daemon alive.",
    flags: [
      F.repo(),
      { name: "name", type: "string", required: true, placeholder: "N", description: "Routine name." },
      F.prompt(true, "Text delivered to the selected conversation or a new session."),
      F.promptFile(),
      { ...SCHEDULE_FLAG, required: true },
      F.vendor(),
      {
        name: "base-branch",
        type: "string",
        placeholder: "B",
        description: "Base ref each run's worktree branches from.",
      },
      ...PRECHECK_FLAGS,
      GRACE_FLAG,
      PERSISTENT_FLAG,
      ...TARGET_FLAGS,
      { name: "disabled", type: "bool", description: "Create it paused instead of active." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "automation.create", {
        repo: ctx.args.requireRepo("repo"),
        name: ctx.args.require("name"),
        prompt: requirePromptText(ctx, "routine-create"),
        schedule: ctx.args.require("schedule"),
        ...(ctx.args.vendor() ? { vendor: ctx.args.vendor() } : {}),
        ...(ctx.args.str("base-branch") ? { baseRef: ctx.args.str("base-branch") } : {}),
        ...precheckPayload(ctx),
        ...targetPayload(ctx),
        ...(ctx.args.nonNegativeInt("grace") !== undefined
          ? { missedRunGraceMinutes: ctx.args.nonNegativeInt("grace") }
          : {}),
        ...(ctx.args.bool("persistent-session") ? { persistentSession: true } : {}),
        ...(ctx.args.bool("disabled") ? { enabled: false } : {}),
      }),
  },
  {
    name: "routine-update",
    group: "routine",
    summary: "Change a routine. A new --schedule re-anchors its next run; --precheck '' clears the precheck.",
    flags: [
      { name: "id", type: "string", required: true, placeholder: "ID", description: "Routine id." },
      { name: "name", type: "string", placeholder: "N", description: "New name." },
      F.prompt(false, "New prompt."),
      F.promptFile(),
      SCHEDULE_FLAG,
      {
        ...F.vendor(),
        type: "string",
        description: "New engine vendor; empty clears it before binding an existing target.",
      },
      { name: "base-branch", type: "string", placeholder: "B", description: "New base ref ('' to clear)." },
      ...PRECHECK_FLAGS,
      GRACE_FLAG,
      PERSISTENT_FLAG,
      ...TARGET_FLAGS,
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "automation.update", {
        id: ctx.args.require("id"),
        ...(ctx.args.str("name") !== undefined ? { name: ctx.args.str("name") } : {}),
        ...(ctx.args.promptText() !== undefined ? { prompt: ctx.args.promptText() } : {}),
        ...(ctx.args.str("schedule") !== undefined ? { schedule: ctx.args.str("schedule") } : {}),
        ...(ctx.args.present("vendor") ? { vendor: ctx.args.vendor() ?? null } : {}),
        // `--base-branch ''` clears the base ref (sends null); `present` keeps
        // that empty value visible where `str` would fold it into "absent".
        ...(ctx.args.present("base-branch") ? { baseRef: ctx.args.str("base-branch") ?? null } : {}),
        ...precheckPayload(ctx),
        ...targetPayload(ctx),
        ...(ctx.args.nonNegativeInt("grace") !== undefined
          ? { missedRunGraceMinutes: ctx.args.nonNegativeInt("grace") }
          : {}),
        // `present` + `bool`, not a bare `bool` ternary: an explicit
        // `--persistent-session false` is falsy, so the ternary dropped the key
        // and left the routine standing — there was no CLI path back to
        // fresh-worktree-per-run. (On `routine-create` above, absent and false
        // mean the same thing, so the ternary is harmless there.)
        ...(ctx.args.present("persistent-session")
          ? { persistentSession: ctx.args.bool("persistent-session") ?? true }
          : {}),
      }),
  },
  {
    name: "routine-set-enabled",
    group: "routine",
    summary: "Pause or resume a routine. Disabling the last active one releases the daemon's keep-alive hold.",
    flags: [
      { name: "id", type: "string", required: true, placeholder: "ID", description: "Routine id." },
      { name: "enabled", type: "bool", required: true, description: "true to resume, false to pause." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "automation.update", { id: ctx.args.require("id"), enabled: ctx.args.bool("enabled") }),
  },
  {
    name: "routine-delete",
    group: "routine",
    summary: "Delete a routine and its run history. Tasks it already created are untouched.",
    flags: [{ name: "id", type: "string", required: true, placeholder: "ID", description: "Routine id." }],
    handler: (ctx) => simpleRpc(ctx, "automation.delete", { id: ctx.args.require("id") }),
  },
  {
    name: "routine-run-now",
    group: "routine",
    summary:
      "Run a routine immediately, skipping its precheck (asking for it IS the answer). Does not shift its schedule.",
    flags: [{ name: "id", type: "string", required: true, placeholder: "ID", description: "Routine id." }],
    handler: (ctx) => simpleRpc(ctx, "automation.runNow", { id: ctx.args.require("id") }),
  },
  {
    name: "routine-runs",
    group: "routine",
    summary:
      "Run history, newest first. Statuses: dispatched, revived (standing session respawned — files kept, conversation did not), skipped_cancelled (disabled, changed or stopped before delivery), skipped_precheck (nothing to do), skipped_missed, skipped_unavailable, dispatch_failed.",
    flags: [{ name: "id", type: "string", required: true, placeholder: "ID", description: "Routine id." }],
    handler: (ctx) => simpleRpc(ctx, "automation.runs", { id: ctx.args.require("id") }),
  },
]
