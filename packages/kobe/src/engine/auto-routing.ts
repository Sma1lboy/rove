/**
 * Auto routing: tiers `swift` / `standard` / `deep`, each mapped to an (engine,
 * model, effort) target. Two parts that never reference each other:
 *   - the TABLE — a default, overridden per field in `state.json`
 *     (`autoRouting.<tier>.engine|model|effort`, docs/CONFIGURATION.md);
 *   - the GATE — can the target start: engine listed by `engine-list`, login
 *     not `none`, model flag declared if a model is set, effort level declared
 *     if an effort is set. Which model deserves `deep` is taste, unchecked.
 *
 * Tier copy (`tasks.tier.*`) names no vendor. No auto-pick: a tier fills three
 * fields the user can still see and change. State is read through an injected
 * getter (CLI: `getPersistedString`, TUI: reactive `kv.get`). Keys were
 * `autoEffort.*` up to v0.9.219; `state/state-key-migration.ts` moves them.
 */

import { getPersistedString } from "@/state/repos"
import type { VendorId } from "@/types/vendor"
import { protocolEntry } from "./engine-presets.ts"

export const AUTO_ROUTING_TIERS = ["swift", "standard", "deep"] as const
export type AutoRoutingTier = (typeof AUTO_ROUTING_TIERS)[number]

export function isAutoRoutingTier(value: string | undefined): value is AutoRoutingTier {
  return (AUTO_ROUTING_TIERS as readonly string[]).includes(value ?? "")
}

/** What one tier launches. `engine` is an id `engine-list` names. */
export interface TierTarget {
  readonly engine: VendorId
  readonly model?: string
  readonly effort?: string
}

export type AutoRoutingTable = Readonly<Record<AutoRoutingTier, TierTarget>>

/** One engine, three models: claude declares no effort levels, so tiers differ by model alone. */
export const DEFAULT_AUTO_ROUTING: AutoRoutingTable = {
  swift: { engine: "claude", model: "sonnet" },
  standard: { engine: "claude", model: "opus" },
  deep: { engine: "claude", model: "fable" },
}

export type TierField = "engine" | "model" | "effort"

/** state.json key for one field of one tier. */
export function autoRoutingKey(tier: AutoRoutingTier, field: TierField): string {
  return `autoRouting.${tier}.${field}`
}

type Getter = (key: string) => unknown

function stringAt(get: Getter, key: string): string | undefined {
  const raw = get(key)
  return typeof raw === "string" ? raw : undefined
}

/**
 * The default with persisted fields laid over it. `null` = NOT configured (some
 * tier's engine is `""`); callers treat it as "no such feature", never guess.
 */
export function readAutoRoutingTable(get: Getter = getPersistedString): AutoRoutingTable | null {
  const table: Partial<Record<AutoRoutingTier, TierTarget>> = {}
  for (const tier of AUTO_ROUTING_TIERS) {
    const base = DEFAULT_AUTO_ROUTING[tier]
    const engine = stringAt(get, autoRoutingKey(tier, "engine"))
    if (engine !== undefined && !engine.trim()) return null
    const model = stringAt(get, autoRoutingKey(tier, "model"))
    const effort = stringAt(get, autoRoutingKey(tier, "effort"))
    const resolvedModel = model === undefined ? base.model : model.trim() || undefined
    const resolvedEffort = effort === undefined ? base.effort : effort.trim() || undefined
    table[tier] = {
      engine: engine?.trim() || base.engine,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(resolvedEffort ? { effort: resolvedEffort } : {}),
    }
  }
  return table as AutoRoutingTable
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
  /** `"none"` = detector found no login; `null` = no detector, which passes. */
  readonly accountKind: (engine: VendorId) => string | null
}

/**
 * Checks run in the order a launch would fail. Reads `modelArgv`/`effortLevels`
 * on the engine's PROTOCOL, so a preset declaring codex is judged as codex.
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
