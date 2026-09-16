/** @jsxImportSource @opentui/react */
/**
 * One tab row's desktop pet. `null` unless the opt-in `rove.desktop_pet` flag
 * is on, so the default rail renders exactly as it did before this existed.
 *
 * The state it reflects is the SAME `TabTreeRow` already resolved for the
 * row's state glyph — the per-tab activity the sidebar reads, with the task
 * rollup as its only fallback (`tabRowActivity`). The pet therefore cannot
 * disagree with the `○`/spinner/`!` beside it: there is no second source, and
 * a tab with no daemon signal idles here exactly as it rests at `○` there.
 *
 * Kept a component rather than a function returning a string so it can read
 * the flag through the KV context and re-render when Settings flips it.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator-payloads"
import type { RGBA } from "@opentui/core"
import { DESKTOP_PET_KEY, PET_CELLS, type PetMood, petFrameOf, petMoodOf, petSpeciesOf } from "../../../tui/desktop-pet"
import { type KVContext, useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"

/**
 * Whether the flag is on. Exported so a row can budget the pet's cells from
 * the SAME read the pet itself uses — the label truncation and the frame
 * then cannot disagree about whether a pet is on the row.
 */
export function desktopPetEnabled(kv: KVContext | null | undefined): boolean {
  return kv?.get(DESKTOP_PET_KEY, false) === true
}

/** Mood → the tone the frame reads in. `waiting` borrows the attention
 *  colour, the same red the `!` glyph uses, so the two agree. */
function petTone(theme: ReturnType<typeof useTheme>["theme"], mood: PetMood): RGBA {
  switch (mood) {
    case "running":
      return theme.primary
    case "waiting":
      return theme.warning
    case "done":
      return theme.success
    default:
      return theme.textMuted
  }
}

export function TabPet(props: { readonly tabId: string; readonly activity: TaskEngineState | undefined }) {
  const kv = useOptionalKV()
  const { theme } = useTheme()
  // Optional KV: a render test or a preview with no provider simply shows no
  // pet, which is the same as the flag being off.
  if (!desktopPetEnabled(kv)) return null
  const mood = petMoodOf(props.activity?.state)
  return (
    <text fg={petTone(theme, mood)} wrapMode="none" width={PET_CELLS} flexShrink={0}>
      {petFrameOf(petSpeciesOf(props.tabId), mood)}
    </text>
  )
}
