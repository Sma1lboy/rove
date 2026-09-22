/**
 * The ENGINE half of an `add`: which engine a new task launches, at what
 * reasoning level, and on which model — typed out, or filled from an
 * auto-effort tier. Both `addOne` and `addParallel` route through it so the
 * two paths cannot drift on the engine contract.
 */

import {
  type TierTarget,
  describeTierBlock,
  isAutoEffortTier,
  readAutoEffortTable,
  tierBlock,
} from "../../engine/auto-effort.ts"
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
 * `--tier`: fill (engine, model, effort) from the auto-effort table and
 * record the tier on the task. Exclusive with the three explicit flags —
 * a caller who wrote both believes both applied. The target then passes the
 * same gates a hand-picked engine does (`engine-list` membership, login,
 * `assertEngineAcceptsModel`, `assertEngineAcceptsEffort`), so a tier that
 * cannot start fails HERE with the reason, not minutes later at launch.
 */
export async function tierFields(ctx: VerbContext): Promise<EngineFields | undefined> {
  const tier = ctx.args.str("tier")?.trim()
  if (!tier) return undefined
  if (!isAutoEffortTier(tier)) {
    throw new ApiError(
      `--tier must be one of swift, standard, deep (got ${JSON.stringify(tier)})`,
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  for (const flag of ["command", "model", "effort", "agents"] as const) {
    if (ctx.args.str(flag)) {
      throw new ApiError(
        `--${flag} conflicts with --tier, which already fills the engine, model and effort from the auto-effort table — pass one or the other`,
        "CONFLICTING_FLAGS",
        helpStep("add"),
      )
    }
  }
  const table = readAutoEffortTable()
  if (!table) {
    throw new ApiError(
      "auto effort is not configured — a tier has no engine (autoEffort.<tier>.engine in state.json); set it in Settings → Auto effort",
      "TIER_UNAVAILABLE",
      helpStep("add"),
    )
  }
  const target: TierTarget = table[tier]
  const status = await detectEngineStatus(target.engine)
  const block = tierBlock(target, {
    engineIds: new Set(await engineListIds()),
    accountKind: () => status.account?.kind ?? null,
  })
  if (block) {
    throw new ApiError(`tier ${tier} cannot start: ${describeTierBlock(block)}`, "TIER_UNAVAILABLE", {
      tier,
      block,
      hint: "Retarget the tier in Settings → Auto effort, or pass --command/--model/--effort by hand.",
      nextCommandArgs: ["api", "engine-list"],
    })
  }
  const vendor = resolveCommandProtocol(target.engine)
  if (target.model) assertEngineAcceptsModel(vendor, target.model, ["api", "engine-list"])
  if (target.effort) assertEngineAcceptsEffort(vendor, target.effort, ["api", "engine-list"])
  return { choice: { command: target.engine, vendor }, effort: target.effort, model: target.model, tier }
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
