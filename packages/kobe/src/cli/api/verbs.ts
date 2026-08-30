/**
 * Declarative verb table; see `api-cmd.ts` for the split rationale.
 *
 * The large {@link VERBS} array is split by domain into `verbs-*.ts` files
 * (read, create, drive, edit, lifecycle, worktree, feedback, plus the
 * pre-existing issues/automations/work-items). This module keeps the registry
 * metadata, the `schema` verb handler (it references VERBS/findVerb at load
 * time, so it must live here to avoid circular imports), and the concat that
 * produces the canonical VERBS list.
 */

import { ENGINE_LIST_VERB } from "./handlers-engines.ts"
import { fullSchema, groupSchema, schemaIndex, verbSchema } from "./schema.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"
import { ROUTINE_VERBS } from "./verbs-automations.ts"
import { CREATE_VERBS } from "./verbs-create.ts"
import { DRIVE_VERBS } from "./verbs-drive.ts"
import { EDIT_VERBS } from "./verbs-edit.ts"
import { FEEDBACK_VERBS } from "./verbs-feedback.ts"
import { ISSUE_VERBS } from "./verbs-issues.ts"
import { LIFECYCLE_VERBS } from "./verbs-lifecycle.ts"
import { READ_VERBS } from "./verbs-read.ts"
import { WORK_ITEM_VERBS } from "./verbs-work-items.ts"
import { WORKTREE_VERBS } from "./verbs-worktree.ts"

/**
 * The `schema` verb's handler — LEVELED so it never dumps everything by
 * default:
 *   - no flags  → compact index (groups + verb names + summaries, NO flags)
 *   - --verb N  → one verb's full flag detail
 *   - --group G → the verbs in one group (compact)
 *   - --all     → the complete spec (every verb AND every flag)
 *
 * Lives HERE (not in `./schema.ts`, which owns the render functions this
 * calls) because it's referenced inside the {@link VERBS} array literal
 * below, which is evaluated at module-load time — a handler imported from a
 * module that itself imports `VERBS` back from here would still be
 * `undefined` at that point (load-order circular-import hazard).
 */
async function handleSchema(ctx: VerbContext): Promise<unknown> {
  const verbName = ctx.args.str("verb")
  if (verbName) {
    const v = findVerb(verbName)
    if (!v) throw new ApiError(`unknown verb: ${verbName}`, "BAD_VERB")
    return verbSchema(v)
  }
  const group = ctx.args.str("group")
  if (group) return groupSchema(group)
  if (ctx.args.bool("all")) return fullSchema()
  return schemaIndex()
}

/** Output the alias → canonical map so callers (and the schema) stay in sync. */
export const VERB_ALIASES: Readonly<Record<string, string>> = { "spawn-task": "add" }

/**
 * Verbs that were REMOVED, mapped to the argv that replaces them.
 *
 * Deliberately not aliases: `fan-out` folded into `add --count` and
 * `set-vendor` became `set-command`, and both changed their flag contract in
 * the process — an alias would silently accept the old flags and do
 * something subtly different. `archive` (issue #75) had no successor hiding
 * state — its replacement is the destructive-but-recoverable `delete`. A
 * retired verb instead fails loud with
 * `UNKNOWN_VERB` plus the `nextCommandArgs` an agent can run verbatim, which
 * is the same self-healing contract every other high-traffic rejection uses.
 */
export const RETIRED_VERBS: Readonly<Record<string, { hint: string; nextCommandArgs: readonly string[] }>> = {
  "fan-out": {
    hint: "fan-out was folded into `add`: pass --count N (or --agents claude:2,codex:1) to spawn N parallel tasks of one prompt",
    nextCommandArgs: ["api", "add", "--help"],
  },
  "set-vendor": {
    hint: "set-vendor was replaced by `set-command`, which takes the engine's raw launch command (an engine id from `engine-list`, or a full command line)",
    nextCommandArgs: ["api", "set-command", "--help"],
  },
  // `archive` went away with the archived-task dimension itself (issue #75) —
  // there is no "hide but keep" left; `delete` is the cleanup, and its branch
  // always survives unless the caller explicitly passes --delete-branch.
  archive: {
    hint: "archive was removed: there is no hide-without-delete anymore — use `delete` to remove a finished task and its worktree; the git branch survives (pass --delete-branch explicitly only when the history may go)",
    nextCommandArgs: ["api", "delete", "--help"],
  },
}

/**
 * Verb groups for LEVELED exploration. An agent reads the compact index
 * (groups + verb summaries), then drills into one verb or one group —
 * instead of slurping every flag of every verb and polluting its context.
 */
export const VERB_GROUPS: Readonly<Record<string, readonly string[]>> = {
  discover: ["schema", "engine-list"],
  read: ["list", "get-task", "collect", "digest", "agent-turns", "pty-list", "read-output", "inspect"],
  create: ["add"],
  drive: ["send", "dispatch", "note", "note-list", "set-active", "pane-open", "pane-close", "notify", "engine-report"],
  edit: ["rename", "set-branch", "set-command", "set-status"],
  issues: ["issue-list", "issue-create", "issue-set-status", "issue-update"],
  workitems: ["workitem-list", "workitem-start"],
  routine: [
    "routine-list",
    "routine-create",
    "routine-update",
    "routine-set-enabled",
    "routine-delete",
    "routine-run-now",
    "routine-runs",
  ],
  lifecycle: ["pin", "land", "delete"],
  worktree: ["ensure-worktree", "adopt", "discover-adoptable"],
  feedback: ["feedback"],
}

/** The `schema` verb spec — kept here because its handler references VERBS. */
const SCHEMA_VERB: VerbSpec = {
  name: "schema",
  summary:
    "Explore the API. Default = a COMPACT index (groups + verb summaries, no flags). Drill in with --verb / --group; --all for the full spec.",
  flags: [
    { name: "verb", type: "string", placeholder: "NAME", description: "Full flag detail for ONE verb." },
    { name: "group", type: "string", placeholder: "G", description: "List the verbs in one group (compact)." },
    {
      name: "all",
      type: "bool",
      description: "The COMPLETE spec — every verb AND every flag (large; avoid by default).",
    },
  ],
  offline: true,
  handler: handleSchema,
}

// VERBS — ordered for help readability: discovery, reads, create, drive,
// feedback, issues/routine/workitems, edit, lifecycle, worktree.
export const VERBS: readonly VerbSpec[] = [
  SCHEMA_VERB,
  ENGINE_LIST_VERB,
  ...READ_VERBS,
  ...CREATE_VERBS,
  ...DRIVE_VERBS,
  ...FEEDBACK_VERBS,
  ...ISSUE_VERBS,
  ...ROUTINE_VERBS,
  ...WORK_ITEM_VERBS,
  ...EDIT_VERBS,
  ...LIFECYCLE_VERBS,
  ...WORKTREE_VERBS,
]

/** Verb names in canonical order (schema/help/tests). */
export const API_VERBS = VERBS.map((v) => v.name)

export function findVerb(name: string): VerbSpec | undefined {
  const canonical = VERB_ALIASES[name] ?? name
  return VERBS.find((v) => v.name === canonical)
}
