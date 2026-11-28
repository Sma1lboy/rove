/**
 * Applies the active appearance pack's color overrides and layout tokens onto
 * `document.documentElement`, cleaning up previously set properties whenever the
 * pack changes or falls back to default.
 */

import {
  type AppearanceManifest,
  resolveAppearanceCssColors,
  resolveAppearanceEngineColors,
} from "@sma1lboy/rove-client/appearance/index.ts"
import type { Mode } from "../prefs-theme.ts"
import { appearanceTokensStore } from "./runtime.ts"

const LAYOUT_VARS = ["--radius", "--radius-sm", "--radius-xs", "--hairline", "--ap-pane-gap", "--ap-shell-pad"] as const

let lastColorVars: string[] = []

/** Apply active appearance pack CSS vars & data attributes; pass `null` to restore defaults. */
export function applyAppearanceTokens(
  root: HTMLElement,
  manifest: AppearanceManifest | null,
  mode: Mode,
  baseVars: Readonly<Record<string, string>>,
): void {
  for (const name of lastColorVars) {
    if (name in baseVars) root.style.setProperty(name, baseVars[name])
    else root.style.removeProperty(name)
  }
  for (const name of LAYOUT_VARS) root.style.removeProperty(name)
  delete root.dataset.apFrame
  delete root.dataset.apDensity
  delete root.dataset.apPack

  if (!manifest) {
    lastColorVars = []
    appearanceTokensStore.set(baseVars)
    return
  }

  const colorOverrides = resolveAppearanceCssColors(manifest.colors, mode)
  lastColorVars = Object.keys(colorOverrides)
  for (const [name, value] of Object.entries(colorOverrides)) {
    root.style.setProperty(name, value)
  }

  const layout = manifest.layout
  if (layout) {
    if (layout.radius !== undefined) root.style.setProperty("--radius", `${layout.radius}px`)
    if (layout.radiusSm !== undefined) root.style.setProperty("--radius-sm", `${layout.radiusSm}px`)
    if (layout.radiusXs !== undefined) root.style.setProperty("--radius-xs", `${layout.radiusXs}px`)
    if (layout.paneGap !== undefined) root.style.setProperty("--ap-pane-gap", `${layout.paneGap}px`)
    if (layout.shellPadding !== undefined) root.style.setProperty("--ap-shell-pad", `${layout.shellPadding}px`)
    if (layout.borderStyle === "none") root.style.setProperty("--hairline", "0px")
    else if (layout.borderStyle === "solid") root.style.setProperty("--hairline", "1px")
    if (layout.frame) root.dataset.apFrame = layout.frame
    if (layout.density) root.dataset.apDensity = layout.density
  }
  root.dataset.apPack = manifest.name

  appearanceTokensStore.set({ ...baseVars, ...colorOverrides })
}

/** Resolve an engine's accent/card tint color from the active pack's `colors.engineColors`. */
export function engineColorForPack(
  manifest: AppearanceManifest | null | undefined,
  engineId: string | undefined,
  mode: Mode,
): string | undefined {
  if (!manifest?.colors?.engineColors) return undefined
  const map = resolveAppearanceEngineColors(manifest.colors, mode)
  if (engineId && map[engineId]) return map[engineId]
  return map.default
}
