/**
 * The ENGINE half of an `add`: which engine a new task launches, at what
 * reasoning level, and on which model — typed out, or filled from an
 * auto-routing tier. Both `addOne` and `addParallel` route through it so the
 * two paths cannot drift on the engine contract.
 */

import { classifyTier, readClassifierConfig } from "../../engine/auto-routing-classifier.ts"
import {
  type AutoRoutingTier,
  type TierTarget,
  describeTierBlock,
  isAutoRoutingTier,
  readAutoRoutingTable,
  tierBlock,
} from "../../engine/auto-routing.ts"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { detectEngineStatus } from "../../engine/engine-status.ts"
import type { VendorId } from "../../types/vendor.ts"
import { assertEngineAcceptsEffort, assertEngineAcceptsModel, engineListIds } from "./handlers-engines.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/** The engine fields a create carries: the raw command + its resolved protocol. */
export interface EngineChoice {
  readonly command?: string
  readonly vendor?: VendorId
}

/**
 * Resolve `--command` into what a task record needs. A bare preset id stays
 * verbatim in `command` (so a later `engineCommand.<id>` edit in Settings
 * still reaches this task) with its declared protocol alongside; a full
 * command line records both too. No `--command` = the repo's default engine,
 * which is a preset id, so it goes in the same two fields.
 */
export async function engineChoice(ctx: VerbContext, repo: string): Promise<EngineChoice> {
  const command = ctx.args.str("command")
  if (command) return { command, vendor: resolveCommandProtocol(command) }
  const fallback = await ctx.runtime.defaultVendor(repo)
  return fallback ? { command: fallback, vendor: fallback } : {}
}

/** The engine fields as a flat `task.create` payload fragment. */
export function enginePayload(
  choice: EngineChoice,
  effort?: string,
  model?: string,
  tier?: string,
): Record<string, string> {
  return {
    ...(choice.command ? { command: choice.command } : {}),
    ...(choice.vendor ? { vendor: choice.vendor } : {}),
    // Wire key is `effort` (the daemon maps it to `modelEffort`); sending
    // `modelEffort` is silently dropped.
    ...(effort ? { effort } : {}),
    // `model` / `tier` are the wire key AND the record field — no remap.
    ...(model ? { model } : {}),
    ...(tier ? { tier } : {}),
  }
}

/** The three engine fields, and which of `--command/--model/--effort` a tier replaces. */
export interface EngineFields {
  readonly choice: EngineChoice
  readonly effort?: string
  readonly model?: string
  readonly tier?: string
}

/**
 * What `--tier` resolved to. `fields` absent = no tier applies and the caller
 * falls back to the typed-out engine fields; `note` is the one line `--tier
 * auto` has to say for itself, present whether or not a tier came back.
 */
export interface TierOutcome {
  readonly fields?: EngineFields
  readonly note?: string
}

/**
 * `--tier auto`: ask the configured classifier which tier this prompt
 * deserves (`engine/auto-routing-classifier.ts`).
 *
 * Declining is the ordinary case, not an error: the classifier is off by
 * default, the key may be unset, the endpoint may be slow or wrong, and the
 * answer may simply not be confident enough. All of those create the task
 * with the engine fields the caller already had — a picker that can fail a
 * create is a dependency, and this is an accelerator. The only hard failure
 * is asking to classify NOTHING, which is a flag mistake the caller wants to
 * hear about before a task exists.
 */
async function autoTier(prompt: string | undefined): Promise<{ tier?: AutoRoutingTier; note: string }> {
  if (!prompt?.trim()) {
    throw new ApiError(
      "--tier auto classifies the first message — pass --prompt/--prompt-file, or name a tier explicitly",
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  const outcome = await classifyTier(prompt, readClassifierConfig())
  if (outcome.kind === "picked") {
    const { tier, confidence } = outcome.verdict
    return { tier, note: `auto → ${tier} (confidence ${confidence.toFixed(2)})` }
  }
  const detail = outcome.detail ? `: ${outcome.detail}` : ""
  return { note: `auto → no tier (${outcome.reason}${detail})` }
}

/**
 * `--tier`: fill (engine, model, effort) from the auto-routing table and
 * record the tier on the task. Exclusive with the three explicit flags —
 * a caller who wrote both believes both applied. The target then passes the
 * same gates a hand-picked engine does (`engine-list` membership, login,
 * `assertEngineAcceptsModel`, `assertEngineAcceptsEffort`), so a tier that
 * cannot start fails HERE with the reason, not minutes later at launch.
 *
 * `auto` runs the same gauntlet: the classifier only chooses WHICH row of the
 * table to read, and a row it picks that cannot start is refused exactly as a
 * hand-typed one is — except that for `auto` "refused" means falling back to
 * the caller's own fields rather than failing the create.
 */
export async function tierFields(ctx: VerbContext, prompt?: string): Promise<TierOutcome> {
  const requested = ctx.args.str("tier")?.trim()
  if (!requested) return {}
  if (requested !== "auto" && !isAutoRoutingTier(requested)) {
    throw new ApiError(
      `--tier must be one of swift, standard, deep, auto (got ${JSON.stringify(requested)})`,
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  for (const flag of ["command", "model", "effort", "agents"] as const) {
    if (ctx.args.str(flag)) {
      throw new ApiError(
        `--${flag} conflicts with --tier, which already fills the engine, model and effort from the auto-routing table — pass one or the other`,
        "CONFLICTING_FLAGS",
        helpStep("add"),
      )
    }
  }
  const table = readAutoRoutingTable()
  if (!table) {
    // A tier the CALLER named is a refusal: they asked for a table that does
    // not exist. `auto` is not — "never fails a create" has no exceptions,
    // and an unconfigured table is the most ordinary reason of all for the
    // classifier to have nothing to say. It also costs nothing to notice
    // here, BEFORE the prompt is sent anywhere.
    if (requested === "auto") return { note: "auto → no tier (auto routing is not configured)" }
    throw new ApiError(
      "auto routing is not configured — a tier has no engine (autoRouting.<tier>.engine in state.json); set it in Settings → Auto routing",
      "TIER_UNAVAILABLE",
      helpStep("add"),
    )
  }
  // The table is read BEFORE the classifier runs: with auto routing switched
  // off there is no row for any answer to name, and sending the prompt to a
  // third party to learn that would be a network call for nothing.
  let tier: AutoRoutingTier
  let note: string | undefined
  if (requested === "auto") {
    const picked = await autoTier(prompt)
    note = picked.note
    if (!picked.tier) return { note }
    tier = picked.tier
  } else {
    tier = requested
  }
  const target: TierTarget = table[tier]
  const status = await detectEngineStatus(target.engine)
  const block = tierBlock(target, {
    engineIds: new Set(await engineListIds()),
    accountKind: () => status.account?.kind ?? null,
  })
  if (block) {
    // A tier the CALLER named is a refusal — they asked for a target that
    // cannot start, and silently launching something else would be worse. A
    // tier the CLASSIFIER named is not: it guessed at a row this machine
    // cannot run, which is our problem, not the caller's.
    if (requested === "auto") return { note: `${note} — unusable: ${describeTierBlock(block)}` }
    throw new ApiError(`tier ${tier} cannot start: ${describeTierBlock(block)}`, "TIER_UNAVAILABLE", {
      tier,
      block,
      hint: "Retarget the tier in Settings → Auto routing, or pass --command/--model/--effort by hand.",
      nextCommandArgs: ["api", "engine-list"],
    })
  }
  const vendor = resolveCommandProtocol(target.engine)
  // These two throw, and a classifier's pick is never allowed to fail a
  // create. `tierBlock` above covers the same ground, so the two cannot
  // disagree today — but "cannot fail" has to be a rule the code keeps, not
  // one that holds because two checks happen to agree.
  try {
    if (target.model) assertEngineAcceptsModel(vendor, target.model, ["api", "engine-list"])
    if (target.effort) assertEngineAcceptsEffort(vendor, target.effort, ["api", "engine-list"])
  } catch (err) {
    if (requested !== "auto") throw err
    return { note: `${note} — unusable: ${err instanceof Error ? err.message : String(err)}` }
  }
  return {
    fields: { choice: { command: target.engine, vendor }, effort: target.effort, model: target.model, tier },
    ...(note ? { note } : {}),
  }
}

/**
 * Run `body`, and if it throws an {@link ApiError}, re-raise the same error
 * with the `--tier auto` note merged into its data.
 *
 * Lives here rather than in the create handler because everything else about
 * what a tier decided lives here, and the reason this exists is the same
 * reason {@link tierFields} returns a note at all: the decision has to reach
 * the caller whether the create went well or badly.
 *
 * Re-raising rather than mutating: an ApiError may be shared or inspected by
 * the caller that built it, and a handler quietly editing someone else's
 * error object is a worse bargain than one extra allocation. A non-ApiError
 * throw is left exactly as it is — wrapping it would change its type on a
 * path whose whole job is to report faithfully.
 */
export async function withTierNote<T>(note: Record<string, string>, body: () => Promise<T>): Promise<T> {
  if (Object.keys(note).length === 0) return body()
  try {
    return await body()
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    throw new ApiError(err.message, err.code, { ...err.data, ...note })
  }
}

/**
 * `--model`, gated the way {@link effortFor} gates `--effort`: every engine in
 * the plan must declare a model flag, or the pin is refused before any task
 * exists. Free string otherwise — the engine's own spelling, verbatim.
 */
export function modelFor(ctx: VerbContext, engines: readonly VendorId[]): string | undefined {
  const model = ctx.args.str("model")?.trim()
  if (!model) return undefined
  for (const engine of new Set(engines)) {
    assertEngineAcceptsModel(engine, model, ["api", "engine-list"])
  }
  return model
}

/**
 * `--effort`, validated against the engine(s) this create will actually
 * launch — before anything is created, so a bad level costs no orphan task.
 *
 * Not an `enum` flag: levels are per-engine (plugins may declare their own),
 * so the list lives on the registry entry; shares `set-effort`'s gate.
 *
 * A fan-out validates EVERY engine: `--agents claude:1,codex:1 --effort
 * xhigh` is rejected rather than silently dropped on the claude sibling.
 */
export function effortFor(ctx: VerbContext, engines: readonly VendorId[]): string | undefined {
  const level = ctx.args.str("effort")?.trim()
  if (!level) return undefined
  for (const engine of new Set(engines)) {
    assertEngineAcceptsEffort(engine, level, ["api", "engine-list"])
  }
  return level
}
