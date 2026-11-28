/**
 * Tailwind class recipes for appearance-pack framing, declarative slots,
 * error banners, and the Settings → Appearance pack picker.
 */

import type {
  AppearanceDensity,
  AppearanceFrame,
  AppearanceSlotSurface,
  AppearanceSlotVariant,
} from "@sma1lboy/rove-client/appearance/index.ts"

export const AP_ERROR_BANNER =
  "flex flex-wrap items-center gap-2 border-b-hairline border-error bg-surface px-3 py-1.5 font-mono text-meta text-ink"
export const AP_ERROR_BADGE = "rounded-xs bg-error px-1.5 py-0.5 font-semibold text-paper"
export const AP_ERROR_MSG = "min-w-0 flex-1 truncate text-error"
export const AP_ERROR_ACTIONS = "ml-auto flex flex-none items-center gap-2"

export const AP_PACK_GRID = "grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-2"
export const apPackCardClass = (active: boolean): string =>
  `flex min-w-0 flex-col gap-1 rounded-sm border-hairline p-2.5 text-left ${active ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"}`
export const AP_PACK_HEAD = "flex min-w-0 items-center justify-between gap-2 font-sans text-body font-medium text-ink"
export const AP_PACK_TAG = "shrink-0 rounded-xs bg-inset px-1.5 py-0.5 font-mono text-meta text-muted"
export const AP_PACK_DESC = "line-clamp-2 font-sans text-meta text-muted"

export const AP_ERROR_BOX =
  "flex flex-col gap-2 rounded-sm border-hairline border-error bg-inset p-3 font-mono text-meta text-ink"
export const AP_ERROR_STACK =
  "m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xs bg-paper p-2 font-mono text-meta text-muted"

export const AP_DECL_ROW_BASE =
  "flex w-full min-w-0 flex-col gap-0.5 rounded-sm px-2.5 py-1.5 text-left transition-colors"
export const AP_DECL_PRIMARY = "flex min-w-0 items-center gap-1.5 text-title text-ink"
export const AP_DECL_SECONDARY = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-meta text-muted"
export const AP_DECL_PILL =
  "inline-flex items-center gap-1 rounded-xs bg-inset px-1.5 py-0.5 font-mono text-meta text-muted"

export const AP_CARD_PANE = "rounded-md border-hairline border-line bg-surface overflow-hidden"

export function apShellClass(frame: AppearanceFrame | undefined): string {
  return frame === "cards" ? "bg-paper p-[var(--ap-shell-pad,8px)] gap-[var(--ap-pane-gap,8px)]" : ""
}

export function apPaneCardClass(frame: AppearanceFrame | undefined): string {
  return frame === "cards" ? AP_CARD_PANE : ""
}

export function apDensityRowClass(density: AppearanceDensity | undefined): string {
  if (density === "compact") return "min-h-6 py-0.5 px-2"
  if (density === "spacious") return "min-h-11 py-2 px-3"
  return "min-h-8 py-1.25 px-2.5"
}

export function apSlotSurfaceClass(surface: AppearanceSlotSurface | undefined, selected: boolean): string {
  if (surface === "surface")
    return selected ? "bg-menu border-hairline border-accent" : "bg-surface border-hairline border-line hover:bg-hover"
  if (surface === "inset") return selected ? "bg-menu border-hairline border-accent" : "bg-inset hover:bg-hover"
  if (surface === "accentSoft")
    return selected ? "bg-accent-soft border-hairline border-accent" : "bg-accent-soft/60 hover:bg-accent-soft"
  if (surface === "paper") return selected ? "bg-menu" : "bg-paper hover:bg-hover"
  if (surface === "sidebar") return selected ? "bg-menu" : "bg-sidebar hover:bg-hover"
  if (surface === "engineTint") {
    return selected
      ? "border-hairline border-accent bg-[color-mix(in_srgb,var(--ap-engine-color,var(--accent))_22%,var(--surface))]"
      : "border-hairline border-line bg-[color-mix(in_srgb,var(--ap-engine-color,var(--surface))_11%,var(--surface))] hover:bg-[color-mix(in_srgb,var(--ap-engine-color,var(--surface))_17%,var(--surface))]"
  }
  return selected ? "bg-menu" : "hover:bg-hover"
}

export function apSlotVariantClass(variant: AppearanceSlotVariant | undefined): string {
  if (variant === "card") return "rounded-md mb-1"
  if (variant === "pill") return "rounded-full px-3"
  if (variant === "compact") return "rounded-xs py-0.5"
  if (variant === "minimal") return "rounded-none px-1.5"
  return "rounded-sm"
}

export const AP_STATUS_BAR =
  "col-span-full flex min-w-0 items-center gap-3 border-t-hairline border-line bg-surface px-3 py-1 font-mono text-meta whitespace-nowrap text-muted"

export const AP_PANEL_HEADER =
  "flex min-w-0 items-center justify-between gap-2 border-b-hairline border-line bg-surface px-2.5 py-1.5 font-mono text-meta text-ink"
export const AP_PANEL_SUMMARY =
  "flex flex-wrap items-center gap-2 border-b-hairline border-line bg-inset px-2.5 py-1.5 font-mono text-meta text-muted"
