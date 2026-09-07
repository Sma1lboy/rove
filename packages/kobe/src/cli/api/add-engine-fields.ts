/**
 * The ENGINE half of an `add`: which engine a new task launches, and at what
 * reasoning level.
 *
 * Split from `handlers-add.ts`, which owns the create ORCHESTRATION — flag
 * conflicts, the single-vs-parallel split, per-sibling failure rows, prompt
 * delivery. This file owns one question instead: given the caller's
 * `--command` / `--effort`, what engine fields does `task.create` carry? Both
 * `addOne` and `addParallel` route through it, so the two paths cannot drift
 * on the engine contract the way they once did on `--status`/`--pin`.
 */

import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import type { VendorId } from "../../types/vendor.ts"
import { assertEngineAcceptsEffort } from "./handlers-engines.ts"
import type { VerbContext } from "./types.ts"

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
export function enginePayload(choice: EngineChoice, effort?: string): Record<string, string> {
  return {
    ...(choice.command ? { command: choice.command } : {}),
    ...(choice.vendor ? { vendor: choice.vendor } : {}),
    // Wire key is `effort`; the daemon maps it to the record's `modelEffort`
    // (`handlers-task.ts` task.create). Sending `modelEffort` here is silently
    // dropped — the create succeeds and the level simply never lands.
    ...(effort ? { effort } : {}),
  }
}

/**
 * `--effort`, validated against the engine(s) this create will actually
 * launch — before anything is created, so a bad level costs no orphan task.
 *
 * Deliberately not an `enum` flag: levels are per-engine and a plugin engine
 * may declare its own, so the closed list lives on the registry entry, not on
 * the flag spec (the same reason `set-effort` takes a free string). It shares
 * that verb's gate, so a level `add` accepts is one `set-effort` would accept
 * too.
 *
 * A fan-out validates EVERY engine in the plan: `--agents claude:1,codex:1
 * --effort xhigh` is rejected outright rather than applied to the codex
 * sibling and silently dropped on the claude one.
 */
export function effortFor(ctx: VerbContext, engines: readonly VendorId[]): string | undefined {
  const level = ctx.args.str("effort")?.trim()
  if (!level) return undefined
  for (const engine of new Set(engines)) {
    assertEngineAcceptsEffort(engine, level, ["api", "engine-list"])
  }
  return level
}
