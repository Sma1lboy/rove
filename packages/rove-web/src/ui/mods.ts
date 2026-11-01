/** The Mods page: the DOM half of the mod element vocabulary (the TUI half is mods-page.tsx). */

import type { ModTone } from "@sma1lboy/rove/src/tui/panes/mods/mods-core.ts"

const MOD_TONE: Readonly<Record<ModTone, string>> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  muted: "text-muted",
}

export const MODS_PAGE = "flex flex-col gap-3"
export const MODS_EMPTY = "[&_p]:mx-0 [&_p]:my-1"
export const MOD_PANE = "rounded-md border-hairline border-line px-3 pt-2 pb-3 font-mono"
export const MOD_PANE_TITLE = "mb-2 text-meta leading-[inherit] text-ink"
/** A row box lets its fields take the spare width, as the TUI's does. */
export const modBoxClass = (row: boolean, framed: boolean): string =>
  `flex min-w-0 items-start ${row ? "[&>form]:flex-[1_1_12em] [&>form]:self-center" : ""} ${framed ? "rounded-sm border-hairline border-line" : ""}`
export const modTextClass = (tone: ModTone | undefined, bold: boolean): string =>
  `whitespace-pre-wrap wrap-anywhere ${tone ? MOD_TONE[tone] : "text-ink"} ${bold ? "font-bold" : ""}`
/** A button in its tone's ink (`font: inherit`, then bold over it), washed with that ink on hover (ungated, as the sheet had) and under the cursor. */
export const modButtonClass = (tone: ModTone, cursor: boolean): string =>
  `cursor-pointer rounded-sm border-hairline border-current px-2.5 py-0.5 [font:inherit] font-bold! ${MOD_TONE[tone]} ${cursor ? "bg-[color-mix(in_srgb,currentcolor_18%,transparent)]" : "bg-transparent [&:hover]:bg-[color-mix(in_srgb,currentcolor_18%,transparent)]"}`
export const MOD_FIELD = "flex min-w-0 max-w-[40em] self-stretch"
export const MOD_FIELD_INPUT = "w-full font-mono"
