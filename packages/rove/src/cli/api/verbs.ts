/**
 * Declarative verb registry; per-domain specs live in `verbs-*.ts`. The
 * `schema` verb lives here because it references VERBS/findVerb at load time.
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
 * Lives here, not in `./schema.ts`: {@link VERBS} is built at module load, and
 * a handler imported from a module that imports `VERBS` back would still be
 * `undefined` then.
 */
async function handleSchema(ctx: VerbContext): Promise<unknown> {
  const verbName = ctx.args.str("verb")
  if (verbName) {
    const v = findVerb(verbName)
    // Same rejection as `api <verb>`, including the RETIRED_VERBS recovery argv.
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
 * Removed verbs → the argv that replaces them. Not aliases: the successors
 * changed their flag contract, so an alias would silently accept superseded
 * flags. Fails loud with `UNKNOWN_VERB` + runnable `nextCommandArgs`.
 */
const RETIRED_VERBS: Readonly<Record<string, { hint: string; nextCommandArgs: readonly string[] }>> = {
  "fan-out": {
    hint: "fan-out was folded into `add`: pass --count N (or --agents claude:2,codex:1) to spawn N parallel tasks of one prompt",
    nextCommandArgs: ["api", "add", "--help"],
  },
  "set-vendor": {
    hint: "set-vendor was replaced by `set-command`, which takes the engine's raw launch command (an engine id from `engine-list`, or a full command line)",
    nextCommandArgs: ["api", "set-command", "--help"],
  },
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
 * Rejection for an unresolved verb; a {@link RETIRED_VERBS} name points at its
 * replacement instead of the schema index. Here, not in `api-cmd.ts`, so
 * `schema --verb` can reach it without a load-order cycle.
 */
export function unknownVerbError(verbName: string): ApiError {
  const retired = RETIRED_VERBS[verbName]
  if (retired) {
    return new ApiError(`unknown verb: ${verbName} (removed)`, "UNKNOWN_VERB", {
      hint: retired.hint,
      nextCommandArgs: [...retired.nextCommandArgs],
    })
  }
  // BAD_VERB is the documented code for a name that never existed.
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
 * Verb groups for leveled exploration, DERIVED from `VerbSpec.group` (a closed
 * union, so an ungrouped verb is a type error). Group order follows
 * {@link VERB_GROUP_IDS}; verbs within a group follow {@link VERBS}.
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
