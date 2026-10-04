import { useMemo } from "react"
import { COLORBLIND_KEY, DEFAULT_COLORBLIND, normalizeColorblind } from "../../state/colorblind"
import { type DiffInks, diffInks } from "../../tui/context/theme-core"
import { useOptionalKV } from "./kv"
import { useTheme } from "./theme"

/**
 * The active theme's added/removed pair, honouring the colorblind setting.
 * Memoized: `<diff>` rebuilds its whole view whenever a colour prop changes
 * identity, and a turned ink is a fresh RGBA each call.
 */
export function useDiffInks(): DiffInks {
  const { theme } = useTheme()
  const kv = useOptionalKV()
  const colorblind = normalizeColorblind(kv?.get(COLORBLIND_KEY, DEFAULT_COLORBLIND)) === "on"
  return useMemo(() => diffInks(theme, colorblind), [theme, colorblind])
}
