/**
 * Desktop pet — the ASCII creature a tab row wears when the opt-in
 * `rove.desktop_pet` flag is on.
 *
 * Framework-free (no opentui/React) so the two decisions that matter are
 * testable as plain values: WHICH pet a tab gets, and WHICH face it makes
 * for a given activity state. The row renderer only paints the 3-cell frame
 * this module hands it.
 *
 * One pet per tab, keyed on the tab's id so a tab keeps the same creature
 * across re-renders and restarts (`petSpeciesOf`). The mood is derived from
 * the SAME per-tab `TaskActivityState` the sidebar's state glyph and the
 * kanban card badge read (`petMoodOf`) — no second activity source exists
 * here, which is the point: the pet can never disagree with the glyph.
 *
 * Every frame is exactly {@link PET_CELLS} cells wide, so a row's label
 * budget can subtract one fixed number whether the pet is a cat or a dango.
 * ASCII only — one cell per character in every monospace font.
 */

import type { TaskActivityState } from "@/engine/hook-events"
import { isAttentionActivity } from "./panes/sidebar/row-view"

/**
 * The persisted opt-in flag. Default OFF: the pet is decoration, and the
 * default interface has to stay exactly as it was for anyone who never flips
 * it. Read/written through the KV store like every other preference.
 */
export const DESKTOP_PET_KEY = "rove.desktop_pet"

/** Two species, so a worktree's tabs are visibly not all the same animal. */
export type PetSpecies = "cat" | "dango"

/**
 * The four faces the brief calls for. `waiting` is the one the reader acts
 * on — the engine is blocked on a human (permission, rate limit, error,
 * dead), the same set the sidebar marks `!`.
 */
export type PetMood = "running" | "waiting" | "done" | "idle"

/** Every frame is this many cells — the row's fixed pet spend. */
export const PET_CELLS = 3

const PET_FRAMES: Record<PetSpecies, Record<PetMood, string>> = {
  cat: { running: ">_<", waiting: "o_o", done: "^_^", idle: "._." },
  dango: { running: "(o)", waiting: "(?)", done: "(*)", idle: "( )" },
}

/** Species in a stable order — the deterministic-hash contract's companion. */
export const PET_SPECIES: readonly PetSpecies[] = ["cat", "dango"]

/**
 * Which pet a tab gets. Deterministic on the tab id (its navigation key, so
 * unique within a task) and stable across restarts — a pet that swapped
 * species on every render would read as a glitch, not a companion.
 */
export function petSpeciesOf(tabId: string): PetSpecies {
  let hash = 0
  for (const ch of tabId) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return PET_SPECIES[hash % PET_SPECIES.length] ?? "cat"
}

/**
 * The face for an activity state. `undefined` (the daemon has never reported
 * this tab) reads as idle, exactly like the sidebar's `○` — both mean
 * "nothing to do here". Attention states map to `waiting`, so the pet and the
 * `!` glyph agree about which rows need you.
 */
export function petMoodOf(state: TaskActivityState | undefined): PetMood {
  if (state === "running") return "running"
  if (state === "turn_complete") return "done"
  if (isAttentionActivity(state)) return "waiting"
  return "idle"
}

/** The frame to paint. Pure lookup — the renderer owns colour, not shape. */
export function petFrameOf(species: PetSpecies, mood: PetMood): string {
  return PET_FRAMES[species][mood]
}
