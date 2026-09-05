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
import { ApiError, VERB_GROUP_IDS, type VerbContext, type VerbGroup, type VerbSpec } from "./types.ts"
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
    // The SAME rejection `api <verb>` raises for the same typo — including the
    // RETIRED_VERBS migration step. Probing a name is what `schema --verb` is
    // FOR, so a bare `BAD_VERB` here withheld the recovery argv exactly where a
    // caller is looking for it.
    if (!v) throw unknownVerbError(verbName)
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
 * the process — an alias would silently accept the superseded flags and do
 * something subtly different. `archive` has no successor hiding state — its
 * replacement is the destructive-but-recoverable `delete`. A removed verb
 * instead fails loud with
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
  // `archive` went away with the archived-task dimension itself: there is no
  // "hide but keep"; `delete` is the cleanup, and its branch always survives
  // unless the caller explicitly passes --delete-branch.
  archive: {
    hint: "archive was removed: there is no hide-without-delete anymore — use `delete` to remove a finished task and its worktree; the git branch survives (pass --delete-branch explicitly only when the history may go)",
    nextCommandArgs: ["api", "delete", "--help"],
  },
}

const SCHEMA_STEP = {
  hint: "list every valid verb + flag as JSON, then retry with a real verb",
  nextCommandArgs: ["api", "schema"],
} as const

/**
 * The typed rejection for a verb name that does not resolve. A REMOVED verb
 * ({@link RETIRED_VERBS}) points at its replacement instead of the schema
 * index — an agent that learned `fan-out` from an older skill or a stale
 * transcript gets the exact argv for `add --count`, not a 40-verb dump to
 * re-derive it from.
 *
 * Lives here rather than in `api-cmd.ts` so BOTH callers can reach it: the
 * dispatcher's unknown-verb path and `schema --verb`, which cannot import the
 * dispatcher back (load-order cycle).
 */
export function unknownVerbError(verbName: string): ApiError {
  const retired = RETIRED_VERBS[verbName]
  if (retired) {
    return new ApiError(`unknown verb: ${verbName} (removed)`, "UNKNOWN_VERB", {
      hint: retired.hint,
      nextCommandArgs: [...retired.nextCommandArgs],
    })
  }
  // BAD_VERB (not UNKNOWN_VERB) for a name that never existed — the
  // documented code for a typo'd verb, unchanged.
  return new ApiError(`unknown verb: ${verbName}`, "BAD_VERB", SCHEMA_STEP)
}

/** The `schema` verb spec — kept here because its handler references VERBS. */
const SCHEMA_VERB: VerbSpec = {
  name: "schema",
  group: "discover",
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

/**
 * Verb groups for LEVELED exploration. An agent reads the compact index
 * (groups + verb summaries), then drills into one verb or one group — instead
 * of slurping every flag of every verb and polluting its context.
 *
 * DERIVED from `VerbSpec.group`, not hand-written. Stating a verb's group
 * twice (once by which `verbs-*.ts` declares it, once in a table here) lets
 * the table half be forgotten, silently producing a group that `--group` then
 * rejects as unknown. One declaration, one source of truth —
 * `VerbGroup` is a closed union, so an ungrouped verb is a type error.
 *
 * Group order follows {@link VERB_GROUP_IDS}; verbs within a group follow the
 * canonical {@link VERBS} order, so every listing agrees.
 */
export const VERB_GROUPS: Readonly<Record<VerbGroup, readonly string[]>> = (() => {
  const byGroup = Object.fromEntries(VERB_GROUP_IDS.map((g) => [g, [] as string[]])) as Record<VerbGroup, string[]>
  for (const v of VERBS) byGroup[v.group].push(v.name)
  return byGroup
})()

export function findVerb(name: string): VerbSpec | undefined {
  const canonical = VERB_ALIASES[name] ?? name
  return VERBS.find((v) => v.name === canonical)
}
