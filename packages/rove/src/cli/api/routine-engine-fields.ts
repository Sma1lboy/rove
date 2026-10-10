/**
 * `routine-create` / `routine-update`'s `--model` and `--effort`: pinned on the
 * routine and handed to every task a run creates. Validated here, against the
 * engine those runs will launch, because a bad pin otherwise surfaces only at
 * the first unattended firing.
 */

import type { VendorId } from "../../types/vendor.ts"
import { daemonOf } from "./handler-helpers.ts"
import { assertEngineAcceptsEffort, assertEngineAcceptsModel, taskEngine } from "./handlers-engines.ts"
import type { VerbContext } from "./types.ts"

interface RoutineRow {
  readonly id: string
  readonly repo: string
  readonly vendor?: string
}

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
  if (!hasModel && !hasEffort) return {}
  const model = ctx.args.str("model")?.trim() || undefined
  const effort = ctx.args.str("effort")?.trim() || undefined
  if (model || effort) {
    let engine = ctx.args.present("vendor") ? ctx.args.vendor() : undefined
    if (!ctx.args.present("vendor")) {
      const { automations } = await daemonOf(ctx).request<{ automations: RoutineRow[] }>("automation.list", {})
      const routine = automations.find((a) => a.id === id)
      // An unknown id is the daemon's error to report, with its own wording.
      if (routine) engine = (routine.vendor as VendorId | undefined) ?? (await ctx.runtime.defaultVendor(routine.repo))
    }
    validate(engine, model, effort)
  }
  return {
    ...(hasModel ? { model: model ?? null } : {}),
    ...(hasEffort ? { effort: effort ?? null } : {}),
  }
}
