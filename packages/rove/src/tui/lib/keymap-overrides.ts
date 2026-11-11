/**
 * Apply policy for user keybinding overrides (~/.rove/settings/keybindings.yaml).
 * Zero opentui imports because vitest can't load `@opentui/*` (transitive
 * `.scm` assets); the loader (`src/tui/context/keybindings-user.ts`) is a thin
 * read → `Bun.YAML.parse` → these functions wrapper. Parsing lives in
 * `keymap-overrides-parse.ts`, re-exported here.
 */

import type { KeymapOverrideEntry } from "./keymap-overrides-parse"

export {
  type KeymapOverrideEntry,
  extractKeybindingOverrides,
  normalizeChord,
} from "./keymap-overrides-parse"

type OverridableHint = {
  keys: string
}

/** Structural slice of `RoveBinding`; avoids importing the opentui-tainted keybindings module. */
export type OverridableBinding = {
  id: string
  scope: string
  keys: readonly string[]
  prefixKeys?: readonly string[]
  hint?: OverridableHint
  /** Exempt from the bare-character rule: the binding is live only where nothing is typed. */
  bareKeys?: boolean
}

export type AppliedOverride = {
  id: string
  keys: readonly string[]
  defaultKeys: readonly string[]
}

/**
 * Position contract for a direction-multiplexed id: handlers receive the
 * matched chord's index (`Binding.slot`, from `bindByIds`), so an override
 * must respect what each position means.
 */
type SlotContract = {
  /** Used in warnings and the docs. */
  layout: string
  /** What each chord of one full set means, in order; a recorder asks for them one by one. */
  slots?: readonly string[]
  /** Null when `count` chords satisfy the layout; otherwise the problem. */
  validateCount: (count: number) => string | null
}

/** Alternating pairs: even slots → `first`, odd slots → `second`. */
function pairContract(first: string, second: string): SlotContract {
  const layout = `alternating [${first}, ${second}] pairs`
  return {
    layout,
    slots: [first, second],
    validateCount: (count) =>
      count >= 2 && count % 2 === 0 ? null : `needs ${layout} (an even number of chords — got ${count})`,
  }
}

/**
 * Handlers map `slot % 2`, so any even count works (`[j, k, down, up]` and
 * `[w, s]` alike). Re-validated on live reload, which re-applies from scratch.
 */
const SLOT_CONTRACTS: Readonly<Record<string, SlotContract>> = {
  "sidebar.goto": pairContract("top (double-tap)", "bottom"),
  "sidebar.nav": pairContract("down", "up"),
  "files.nav": pairContract("down", "up"),
  "diff.review.cursor": pairContract("down", "up"),
  "sidebar.search.nav": pairContract("down", "up"),
  "files.hierarchy": pairContract("collapse", "expand"),
  "files.tab": pairContract("previous tab", "next tab"),
  // Not a pair: slot 0 = quit confirm, slot 1 = the native workspace's second
  // ctrl+q hard exit. One chord keeps the confirm and drops the two-stage exit.
  "app.quit": {
    layout: "[quit confirm, hard exit] (second chord optional)",
    validateCount: (count) => (count <= 2 ? null : `needs [quit confirm, hard exit] (1 or 2 chords — got ${count})`),
  },
}

/** The chords one recording of `id` must collect: a label per slot, or none for a plain one-chord binding. */
export function recordSlotLabels(id: string): readonly string[] {
  return SLOT_CONTRACTS[id]?.slots ?? []
}

/** Scopes where a bare single-character chord would steal typed input. */
const NO_BARE_LETTER_SCOPES = new Set(["global", "workspace", "terminal"])

function scopesOverlap(a: string, b: string): boolean {
  return a === b || a === "global" || b === "global"
}

/**
 * MUTATES matching rows in place (`keys`, and `hint.keys` so F1 / the footer
 * advertise the user's chord). Returns what landed plus every warning.
 */
export function applyKeymapOverrides(
  keymap: readonly OverridableBinding[],
  entries: readonly KeymapOverrideEntry[],
): { applied: AppliedOverride[]; warnings: string[] } {
  const warnings: string[] = []
  const applied: AppliedOverride[] = []

  for (const entry of entries) {
    const row = keymap.find((b) => b.id === entry.id)
    if (!row) {
      warnings.push(`${entry.id}: unknown binding id (press F1 in Rove for the full list)`)
      continue
    }
    if (row.keys.length === 0 && row.prefixKeys === undefined) {
      warnings.push(`${entry.id}: not customizable — the key is handled outside the keymap (doc-only row)`)
      continue
    }

    // Slot ids need a chord count matching the layout. Unbind ([]) is exempt.
    const contract = SLOT_CONTRACTS[entry.id]
    if (contract && entry.keys.length > 0) {
      const problem = contract.validateCount(entry.keys.length)
      if (problem) {
        warnings.push(`${entry.id}: ${problem} — keeping the default`)
        continue
      }
    }

    // Boundary rule (docs/KEYBINDINGS.md): a bare char on a text-accepting
    // scope steals input. `shift+<char>` is just the uppercase char, same rule.
    const keys = entry.keys.filter((chord) => {
      const typedChar = chord.length === 1 || (chord.startsWith("shift+") && chord.length === "shift+".length + 1)
      if (typedChar && !row.bareKeys && NO_BARE_LETTER_SCOPES.has(row.scope)) {
        warnings.push(
          `${entry.id}: "${chord}" dropped — a bare character on a ${row.scope}-scope binding would steal typed input (add a modifier)`,
        )
        return false
      }
      return true
    })
    if (keys.length === 0 && entry.keys.length > 0) {
      warnings.push(`${entry.id}: no chords survived validation — keeping the default`)
      continue
    }
    // All-or-nothing for slot ids: dropping one chord shifts every later slot.
    if (contract && keys.length !== entry.keys.length) {
      warnings.push(
        `${entry.id}: a dropped chord would shift the slot layout (${contract.layout}) — keeping the default`,
      )
      continue
    }

    const defaultKeys = row.keys
    const mutable = row as { keys: readonly string[]; hint?: OverridableHint }
    mutable.keys = keys
    if (row.hint) {
      if (keys.length === 0) {
        // A hint advertising a dead chord is worse than none.
        mutable.hint = undefined
      } else {
        row.hint.keys = keys.join("/")
      }
    }
    applied.push({ id: entry.id, keys, defaultKeys })
  }

  // Conflicts only for override-introduced chords; default same-chord pairs
  // (sidebar.select / sidebar.search.submit) are intentionally mode-gated.
  for (const change of applied) {
    for (const chord of change.keys) {
      const owner = keymap.find((b) => b.id === change.id)
      if (!owner) continue
      for (const other of keymap) {
        if (other.id === change.id) continue
        if (!other.keys.includes(chord)) continue
        if (!scopesOverlap(owner.scope, other.scope)) continue
        warnings.push(
          `${change.id}: "${chord}" also fires ${other.id} (${other.scope} scope) — last registration wins; consider a different chord`,
        )
      }
    }
  }

  return { applied, warnings }
}
