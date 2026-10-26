/**
 * `routine-create` / `routine-update`'s `--vendor`, `--model` and `--effort`.
 * Pins are validated here, against the engine runs will launch, because a bad
 * pin otherwise surfaces only at the first unattended firing. A pinned routine
 * always stores the vendor its pins were judged against: the daemon has no
 * repo default, and resolving one at dispatch would let a later default change
 * launch the pins on an engine nobody checked them against.
 */

import type { Automation } from "@sma1lboy/rove-daemon/daemon/contracts"
import { DEFAULT_TASK_VENDOR } from "../../types/task.ts"
import type { VendorId } from "../../types/vendor.ts"
import { daemonOf } from "./handler-helpers.ts"
import { assertEngineAcceptsEffort, assertEngineAcceptsModel, taskEngine } from "./handlers-engines.ts"
import type { VerbContext } from "./types.ts"

type RoutineRow = Pick<Automation, "id" | "repo" | "vendor" | "model" | "modelEffort">

const RECOVER = ["api", "engine-list"] as const

/** The engine a routine run launches: explicit vendor → repo default (projectless: skipped) → `DEFAULT_TASK_VENDOR`. */
export async function routineRunEngine(
  ctx: VerbContext,
  repo: string | undefined,
  vendor: VendorId | undefined,
): Promise<VendorId> {
  return vendor ?? (repo ? await ctx.runtime.defaultVendor(repo) : undefined) ?? DEFAULT_TASK_VENDOR
}

async function pinnedEngine(
  ctx: VerbContext,
  repo: string | undefined,
  vendor: VendorId | undefined,
  model?: string,
  effort?: string,
): Promise<VendorId> {
  const engine = await routineRunEngine(ctx, repo, vendor)
  const protocol = taskEngine({ vendor: engine })
  if (model) assertEngineAcceptsModel(protocol, model, RECOVER)
  if (effort) assertEngineAcceptsEffort(protocol, effort, RECOVER)
  return engine
}

/** Engine fields for a new routine; pins carry the resolved vendor with them. */
export async function createEngineFields(ctx: VerbContext, repo: string | undefined): Promise<Record<string, string>> {
  const vendor = ctx.args.vendor()
  const model = ctx.args.str("model")?.trim()
  const effort = ctx.args.str("effort")?.trim()
  if (!model && !effort) return vendor ? { vendor } : {}
  return {
    vendor: await pinnedEngine(ctx, repo, vendor, model, effort),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  }
}

/**
 * Engine fields for an existing routine. An empty flag sends `null`, which
 * clears; a cleared vendor under surviving pins is re-resolved and stored.
 */
export async function updateEngineFields(ctx: VerbContext, id: string): Promise<Record<string, string | null>> {
  const hasVendor = ctx.args.present("vendor")
  const hasModel = ctx.args.present("model")
  const hasEffort = ctx.args.present("effort")
  if (!hasVendor && !hasModel && !hasEffort) return {}
  const vendor = ctx.args.vendor()
  const model = ctx.args.str("model")?.trim() || undefined
  const effort = ctx.args.str("effort")?.trim() || undefined
  const fields: Record<string, string | null> = {
    ...(hasVendor ? { vendor: vendor ?? null } : {}),
    ...(hasModel ? { model: model ?? null } : {}),
    ...(hasEffort ? { effort: effort ?? null } : {}),
  }
  const { automations } = await daemonOf(ctx).request<{ automations: RoutineRow[] }>("automation.list", {})
  const routine = automations.find((a) => a.id === id)
  // An unknown id is the daemon's error to report, with its own wording.
  if (!routine) return fields
  const nextModel = hasModel ? model : routine.model
  const nextEffort = hasEffort ? effort : routine.modelEffort
  if (!nextModel && !nextEffort) return fields
  const nextVendor = hasVendor ? vendor : routine.vendor
  const engine = await pinnedEngine(ctx, routine.repo, nextVendor, nextModel, nextEffort)
  return engine === routine.vendor && !hasVendor ? fields : { ...fields, vendor: engine }
}
