/**
 * Settings → Auto effort: the three tier targets, read from the reactive kv
 * (so a change lands on screen at once) and edited through the SAME
 * change-engine picker a task row uses — engine list, effort chips, model
 * input — so a tier's three fields are chosen the way a task's are. The
 * gate (`tierBlock`) is what the section renders under each row; it runs on
 * the engines Settings lists plus the account probes the Engines section
 * already performs, never a second detector.
 */

import {
  AUTO_EFFORT_TIERS,
  type AutoEffortTable,
  type AutoEffortTier,
  type TierBlock,
  autoEffortKey,
  readAutoEffortTable,
  tierBlock,
} from "../../../engine/auto-effort"
import type { EngineStatus } from "../../../engine/engine-status"
import type { VendorId } from "../../../types/task"
import type { KVContext } from "../../context/kv"
import type { DialogContext } from "../../ui/dialog"
import { EnginePickerDialog } from "../engine-picker-dialog"

export interface AutoEffortSettings {
  /** The effective table; null while a tier has its engine blanked. */
  readonly table: AutoEffortTable | null
  /** Why a tier cannot start (null = it can; undefined = probes still running). */
  readonly block: (tier: AutoEffortTier) => TierBlock | null | undefined
  /** Open the picker seeded with the tier's target; writes the three keys on submit. */
  readonly edit: (tier: AutoEffortTier) => Promise<void>
}

export function useAutoEffortSettings(
  kv: KVContext,
  dialog: DialogContext,
  /** The engines Settings lists — the membership half of the gate. */
  engineList: () => readonly VendorId[],
  /** The Engines section's account probes; null while in flight. */
  statuses: readonly EngineStatus[] | null,
): AutoEffortSettings {
  const table = readAutoEffortTable((key) => kv.get(key))
  const engineIds = new Set(engineList())

  function block(tier: AutoEffortTier): TierBlock | null | undefined {
    if (!table) return undefined
    if (statuses === null) return undefined
    const byVendor = new Map(statuses.map((s) => [s.vendor, s]))
    return tierBlock(table[tier], {
      engineIds,
      accountKind: (engine) => byVendor.get(engine)?.account?.kind ?? null,
    })
  }

  async function edit(tier: AutoEffortTier): Promise<void> {
    const current = table?.[tier]
    const engines = engineList()
    const pick = await EnginePickerDialog.show(dialog, {
      engines: engines.length > 0 ? engines : current ? [current.engine] : [],
      current: current?.engine ?? engines[0] ?? "claude",
      currentEffort: current?.effort,
      currentModel: current?.model,
    })
    if (!pick) return
    kv.set(autoEffortKey(tier, "engine"), pick.vendor)
    // Absent = the engine takes none; `""` clears — either way the persisted
    // field is emptied, so a default from the shipped table cannot leak back
    // under an engine that never declared it.
    kv.set(autoEffortKey(tier, "model"), pick.model ?? "")
    kv.set(autoEffortKey(tier, "effort"), pick.effort ?? "")
  }

  return { table, block, edit }
}

export { AUTO_EFFORT_TIERS }
