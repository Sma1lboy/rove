/**
 * Every task gets its own colour, stable across restarts: the task id picks
 * only a HUE; lightness and chroma come from the theme accent, so each task
 * colour weighs the same as the accent it stands in for. After oh-my-pi's
 * session colour (MIT, © Mario Zechner, Can Bölük).
 */

import { RGBA } from "@opentui/core"
import { SEMANTIC_GUARD_DEG, hueDistance, hueOfInts, taskColorInts } from "@sma1lboy/rove-core/theme/color-math.ts"
import type { Theme } from "../context/theme-core"

export { SEMANTIC_GUARD_DEG, hueDistance }

/** OKLCH hue in degrees, or undefined for greys and palette inks. */
export function hueOf(color: RGBA): number | undefined {
  if (color.intent !== "rgb") return undefined
  return hueOfInts(color.toInts())
}

function computeTaskColor(taskId: string, theme: Theme): RGBA {
  const ink = (c: RGBA) => c.toInts() as [number, number, number, number]
  const [r, g, b, a] = taskColorInts(taskId, {
    accent: ink(theme.accent),
    background: ink(theme.background),
    success: ink(theme.success),
    warning: ink(theme.warning),
    error: ink(theme.error),
  })
  return RGBA.fromInts(r, g, b, a)
}

const cache = new Map<string, RGBA>()
const CACHE_LIMIT = 256

/** The task's colour under `theme`; a palette/default accent passes through unchanged. */
export function taskColor(taskId: string, theme: Theme): RGBA {
  if (theme.accent.intent !== "rgb") return theme.accent
  const key = [taskId, theme.accent, theme.background, theme.success, theme.warning, theme.error]
    .map((part) => (typeof part === "string" ? part : part.toInts().join()))
    .join("|")
  const hit = cache.get(key)
  if (hit) return hit
  const color = computeTaskColor(taskId, theme)
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, color)
  return color
}
