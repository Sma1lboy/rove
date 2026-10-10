/**
 * `routine-create` / `routine-update`'s `--model` and `--effort`: pinned on the
 * routine and handed to every task a run creates. Validated here, against the
 * engine those runs will launch, because a bad pin otherwise surfaces only at
 * the first unattended firing.
 */

import type { Automation } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { VendorId } from "../../types/vendor.ts"
import { daemonOf } from "./handler-helpers.ts"
import { assertEngineAcceptsEffort, assertEngineAcceptsModel, taskEngine } from "./handlers-engines.ts"
import type { VerbContext } from "./types.ts"

type RoutineRow = Pick<Automation, "id" | "repo" | "vendor" | "model" | "modelEffort">

const RECOVER = ["api", "engine-list"] as const

function validate(engine: VendorId | undefined, model?: string, effort?: string): void {
  if (!engine) return
  const protocol = taskEngine({ vendor: engine })
  if (model) assertEngineAcceptsModel(protocol, model, RECOVER)
  if (effort) assertEngineAcceptsEffort(protocol, effort, RECOVER)
}

/** Payload for a new routine. No vendor = the repo's default engine, as at dispatch. */
export async function createEnginePins(ctx: VerbContext, repo: string): Promise<Record<string, string>> {
  const model = ctx.args.str("model")?.trim()
  const effort = ctx.args.str("effort")?.trim()
  if (!model && !effort) return {}
  validate(ctx.args.vendor() ?? (await ctx.runtime.defaultVendor(repo)), model, effort)
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}

/** Patch for an existing routine. An empty flag sends `null`, which clears the pin. */
export async function updateEnginePins(ctx: VerbContext, id: string): Promise<Record<string, string | null>> {
  const hasModel = ctx.args.present("model")
  const hasEffort = ctx.args.present("effort")
  const hasVendor = ctx.args.present("vendor")
  if (!hasModel && !hasEffort && !hasVendor) return {}
  const model = ctx.args.str("model")?.trim() || undefined
  const effort = ctx.args.str("effort")?.trim() || undefined
  if (hasVendor || model || effort) {
    const { automations } = await daemonOf(ctx).request<{ automations: RoutineRow[] }>("automation.list", {})
    const routine = automations.find((a) => a.id === id)
    // An unknown id is the daemon's error to report, with its own wording.
    if (routine) {
      const vendor = hasVendor ? ctx.args.vendor() : routine.vendor
      const engine = vendor ?? (await ctx.runtime.defaultVendor(routine.repo))
      validate(engine, hasModel ? model : routine.model, hasEffort ? effort : routine.modelEffort)
    }
  }
  return {
    ...(hasModel ? { model: model ?? null } : {}),
    ...(hasEffort ? { effort: effort ?? null } : {}),
  }
}
