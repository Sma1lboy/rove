/**
 * Auto effort — three user-facing depth tiers (`swift` / `standard` /
 * `deep`), each mapped to a concrete (engine, model, effort) target.
 *
 * Two things live here and deliberately never reference each other:
 *   - the TABLE (which engine/model/effort a tier launches) — shipped with a
 *     default and overridden per field in `state.json`
 *     (`autoEffort.<tier>.engine|model|effort`, see docs/CONFIGURATION.md);
 *   - the GATE (can this target start at all) — the same four checks the
 *     dispatch face already runs one by one: the engine is one `engine-list`
 *     names, its login (when detectable) is not `none`, its protocol declares
 *     a model flag when a model is set, and it declares the effort level when
 *     one is set. "Which model deserves `deep`" is taste, and is not checked.
 *
 * What a tier MEANS to the user is copy (`tasks.tier.*` in the i18n catalog),
 * and that copy names no vendor. No classifier, no auto-pick: the tier is a
 * one-keystroke fill of three fields the user can still see and change.
 *
 * State-reading through an injected getter, so the CLI passes
 * `getPersistedString` and the TUI passes its reactive `kv.get`.
 */

import { getPersistedString } from "@/state/repos"
import type { VendorId } from "@/types/vendor"
import { protocolEntry } from "./engine-presets.ts"

export const AUTO_EFFORT_TIERS = ["swift", "standard", "deep"] as const
export type AutoEffortTier = (typeof AUTO_EFFORT_TIERS)[number]

export function isAutoEffortTier(value: string | undefined): value is AutoEffortTier {
  return (AUTO_EFFORT_TIERS as readonly string[]).includes(value ?? "")
}

/** What one tier launches. `engine` is an id `engine-list` names. */
export interface TierTarget {
  readonly engine: VendorId
  readonly model?: string
  readonly effort?: string
}

export type AutoEffortTable = Readonly<Record<AutoEffortTier, TierTarget>>

/**
 * The shipped table: one engine, three models — the only spread this
 * machine can verify on 2026-09-17 (claude declares no effort levels, so
 * the tiers differ by model alone). Users retarget any field in Settings.
 */
export const DEFAULT_AUTO_EFFORT: AutoEffortTable = {
  swift: { engine: "claude", model: "sonnet" },
  standard: { engine: "claude", model: "opus" },
  deep: { engine: "claude", model: "fable" },
}

export type TierField = "engine" | "model" | "effort"

/** state.json key for one field of one tier. */
export function autoEffortKey(tier: AutoEffortTier, field: TierField): string {
  return `autoEffort.${tier}.${field}`
}

type Getter = (key: string) => unknown

function stringAt(get: Getter, key: string): string | undefined {
  const raw = get(key)
  return typeof raw === "string" ? raw : undefined
}

/**
 * The effective table: the default with every persisted field laid over it.
 * `null` = auto effort is NOT configured — some tier has its engine blanked
 * (`""` in state.json). A missing tier is never guessed at, and the callers
 * (the new-task tier row, `add --tier`) treat null as "no such feature".
 */
export function readAutoEffortTable(get: Getter = getPersistedString): AutoEffortTable | null {
  const table: Partial<Record<AutoEffortTier, TierTarget>> = {}
  for (const tier of AUTO_EFFORT_TIERS) {
    const base = DEFAULT_AUTO_EFFORT[tier]
    const engine = stringAt(get, autoEffortKey(tier, "engine"))
    if (engine !== undefined && !engine.trim()) return null
    const model = stringAt(get, autoEffortKey(tier, "model"))
    const effort = stringAt(get, autoEffortKey(tier, "effort"))
    const resolvedModel = model === undefined ? base.model : model.trim() || undefined
    const resolvedEffort = effort === undefined ? base.effort : effort.trim() || undefined
    table[tier] = {
      engine: engine?.trim() || base.engine,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(resolvedEffort ? { effort: resolvedEffort } : {}),
    }
  }
  return table as AutoEffortTable
}

/** Why a tier cannot start, in a shape both the CLI error and the Settings row render. */
export type TierBlock =
  | { readonly kind: "engine"; readonly engine: string }
  | { readonly kind: "account"; readonly engine: string }
  | { readonly kind: "model"; readonly engine: string; readonly model: string }
  | { readonly kind: "effort"; readonly engine: string; readonly effort: string; readonly levels: readonly string[] }

export interface TierGateDeps {
  /** Every id `engine-list` would print. */
  readonly engineIds: ReadonlySet<string>
  /**
   * The engine's detected account kind: `"none"` = detector ran, found no
   * login; `null` = no detector (contrib/plugin/custom), which passes —
   * absent is "not detectable", never "not logged in".
   */
  readonly accountKind: (engine: VendorId) => string | null
}

/**
 * The gate. Order matches the failure a launch would hit first. Reuses the
 * registry facts the `add --model` / `set-effort` gates read
 * (`modelArgv`, `effortLevels`) on the engine's PROTOCOL, so a preset
 * `mycodex` declaring codex is judged as codex.
 */
export function tierBlock(target: TierTarget, deps: TierGateDeps): TierBlock | null {
  const { engine } = target
  if (!deps.engineIds.has(engine)) return { kind: "engine", engine }
  if (deps.accountKind(engine) === "none") return { kind: "account", engine }
  const entry = protocolEntry(engine)
  if (target.model && !entry.modelArgv) return { kind: "model", engine, model: target.model }
  if (target.effort) {
    const levels = entry.effortLevels ?? []
    if (!levels.includes(target.effort)) return { kind: "effort", engine, effort: target.effort, levels }
  }
  return null
}

/** Plain-text rendering of a block, for the CLI error and `rove doctor`-style surfaces. */
export function describeTierBlock(block: TierBlock): string {
  switch (block.kind) {
    case "engine":
      return `engine ${block.engine} is not one engine-list names`
    case "account":
      return `engine ${block.engine} is not logged in`
    case "model":
      return `engine ${block.engine} declares no model flag, so model ${JSON.stringify(block.model)} cannot be passed`
    case "effort":
      return block.levels.length === 0
        ? `engine ${block.engine} declares no reasoning effort levels`
        : `engine ${block.engine} does not accept effort ${JSON.stringify(block.effort)} — it declares ${block.levels.join(", ")}`
  }
}
