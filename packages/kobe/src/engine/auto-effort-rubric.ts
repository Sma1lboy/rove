/**
 * The judgement the tier classifier applies, as data.
 *
 * One question, asked of every prompt: **how much of the PROCEDURE does the
 * model have to work out for itself?** Not "how hard is this", not "how long
 * will it take" — those are outcomes, and a classifier that guesses at them
 * is guessing at the engine's day rather than reading the user's sentence.
 *
 *   procedure given            → swift
 *   goal given, procedure not  → standard
 *   goal itself to be found    → deep
 *
 * Two things here are shaped by what `docs/design/auto-effort-classifier-interface.md`
 * measured, and both cost points when dropped:
 *   - each tier carries its OWN boundary rule against its neighbours, rather
 *     than one shared paragraph in the instructions (+3.2 points there);
 *   - labelled examples ride along in `state`, because prose cannot express
 *     the actual floor of "swift" and examples can (swift recall 32% → 62%).
 *
 * **These strings are not the ones that measured 73.0% on core-94.** That
 * rubric (`rubric-annotator-v5.md`) and its 24 golden examples live in an
 * unpublished local repo with no remote; this file is written from the
 * criterion the design doc states, and has NOT been evaluated. Treat the
 * accuracy as unknown until someone runs it against a labelled set. Replacing
 * it is the point of `autoEffort.classifierRubric` — a caller passes its own
 * {@link TierRubric} and none of this text is consulted.
 */

import { AUTO_EFFORT_TIERS, type AutoEffortTier } from "./auto-effort.ts"

/** One tier's case, as the wire format's `criteria` entry wants it. */
export interface TierCriterion {
  /** What this tier IS — the positive case, judged on its own. */
  readonly what: string
  /** Where it stops: the rule that separates it from its neighbours. */
  readonly boundary: string
}

/** A labelled example. `task` is a prompt someone might actually type. */
export interface TierExample {
  readonly task: string
  readonly tier: AutoEffortTier
}

export interface TierRubric {
  readonly role: string
  readonly criterion: string
  readonly criteria: Readonly<Record<AutoEffortTier, TierCriterion>>
  readonly examples: readonly TierExample[]
}

export const DEFAULT_TIER_RUBRIC: TierRubric = {
  role:
    "You read the first message a developer sends an AI coding agent and decide how much of the PROCEDURE " +
    "the agent must reason out for itself. You are not estimating difficulty, size, or how long the work takes.",
  criterion:
    "Read task_text. Decide how much of the procedure it already contains, and pick the matching tier. " +
    "labelled_examples shows where each tier actually starts and stops — calibrate against them, " +
    "especially for the low end of swift.",
  criteria: {
    swift: {
      what:
        "The message already carries the procedure: it names the file, the symbol, or the exact edit, " +
        "or it points at a reference implementation to copy, or it is a mechanical change (rename, bump, " +
        "format, revert, move) where knowing what to do is knowing how to do it.",
      boundary:
        "Stops at the point where the agent must decide WHERE the change goes. " +
        "A named file or symbol keeps it here; 'somewhere in the auth code' is standard.",
    },
    standard: {
      what:
        "The goal is stated plainly and the procedure is not: add this feature, fix this specific broken " +
        "behaviour, write tests for this module. The agent has to find the code and choose an approach, " +
        "but it is not in doubt about what 'done' means.",
      boundary:
        "Above swift because no file, symbol or reference implementation is handed over. " +
        "Below deep because the outcome is already decided — the agent is choosing HOW, never WHETHER or WHAT.",
    },
    deep: {
      what:
        "The goal itself has to be found: a symptom with no known cause, an open question, a request to " +
        "investigate, design, compare options, or decide what should change. The agent's first job is " +
        "working out what the work IS.",
      boundary:
        "Above standard because 'done' is not defined yet. " +
        "A stated outcome with an unknown route is standard; an unknown outcome is deep.",
    },
  },
  examples: [
    { task: "in src/cli/flags.ts rename parseArgs to parseFlags and update the callers", tier: "swift" },
    { task: "bump the zod dependency to 3.23 and fix whatever breaks in the types", tier: "swift" },
    { task: "revert the last commit on this branch, it broke CI", tier: "swift" },
    { task: "add a --json flag to the status command, same shape as list --json already emits", tier: "swift" },
    { task: "format every file under packages/core with the repo's biome config", tier: "swift" },
    { task: "the retry helper in net/retry.ts should use exponential backoff instead of a fixed 200ms", tier: "swift" },
    { task: "copy the pagination pattern from UsersTable into OrdersTable", tier: "swift" },
    { task: "delete the unused legacy/ folder and drop its entry from tsconfig paths", tier: "swift" },
    { task: "add dark mode to the settings page", tier: "standard" },
    { task: "write unit tests for the session store", tier: "standard" },
    { task: "the sidebar flickers when a task is renamed — fix it", tier: "standard" },
    { task: "let users export their data as CSV from the account page", tier: "standard" },
    { task: "our API returns 500 when the body is empty, it should be a 400 with a message", tier: "standard" },
    { task: "make the build faster, it takes 4 minutes now", tier: "standard" },
    { task: "migrate the auth middleware off express-session to our own cookie handling", tier: "standard" },
    { task: "add rate limiting to the public endpoints", tier: "standard" },
    { task: "users say the app feels slow after about an hour — find out why", tier: "deep" },
    { task: "we keep getting flaky failures in CI, figure out what's going on", tier: "deep" },
    { task: "should we move the queue off redis? write up the options", tier: "deep" },
    { task: "there's a memory leak somewhere in the daemon", tier: "deep" },
    { task: "design how multi-tenant billing should work in this codebase", tier: "deep" },
    { task: "review this repo and tell me what's most worth fixing", tier: "deep" },
    { task: "something is wrong with our websocket reconnect logic, it drops messages sometimes", tier: "deep" },
    { task: "plan the work to support offline mode", tier: "deep" },
  ],
}

/** The `criteria` map as the wire format wants it — one object per tier. */
export function rubricCriteria(rubric: TierRubric): Record<AutoEffortTier, TierCriterion> {
  const out = {} as Record<AutoEffortTier, TierCriterion>
  for (const tier of AUTO_EFFORT_TIERS) out[tier] = rubric.criteria[tier]
  return out
}
