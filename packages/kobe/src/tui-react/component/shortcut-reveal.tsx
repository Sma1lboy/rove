/** @jsxImportSource @opentui/react */
/**
 * React/OpenTUI adapter for prefix-tap presentation.
 *
 * The dispatcher-owned `prefixHudState.armed` is the only interaction state.
 * Settings changes only whether the complete guide is accompanied by local
 * control badges.
 */

import { type ReactNode, createContext, useContext, useMemo } from "react"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { prefixHudState } from "../../tui/lib/prefix-hud"
import {
  PREFIX_TAP_PRESENTATION_KEY,
  type PrefixTapPresentation,
  normalizePrefixTapPresentation,
} from "../../tui/lib/prefix-tap-presentation"
import { shortcutCaption } from "../../tui/lib/shortcut-reveal"
import { useKeymapVersion } from "../context/keybindings"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { currentBindingReachability, useBindingStackVersion } from "../lib/keymap"
import { useAccessor } from "../lib/use-accessor"

export type ShortcutRevealPresentation = Readonly<{
  mode: PrefixTapPresentation
  activeSurface: PrefixTapPresentation | null
}>

const DEFAULT_PRESENTATION: ShortcutRevealPresentation = {
  mode: "local",
  activeSurface: null,
}

const ShortcutRevealContext = createContext<ShortcutRevealPresentation>(DEFAULT_PRESENTATION)

export function useShortcutRevealPresentation(): ShortcutRevealPresentation {
  return useContext(ShortcutRevealContext)
}

export function ShortcutRevealProvider(props: { readonly children: ReactNode }) {
  const kv = useOptionalKV()
  const hud = useAccessor(prefixHudState)
  const mode = normalizePrefixTapPresentation(kv?.get(PREFIX_TAP_PRESENTATION_KEY))
  const value = useMemo<ShortcutRevealPresentation>(
    () => ({
      mode,
      activeSurface: hud.armed ? mode : null,
    }),
    [mode, hud.armed],
  )
  return <ShortcutRevealContext.Provider value={value}>{props.children}</ShortcutRevealContext.Provider>
}

/** Display-only keycap anchored by a `position="relative"` click target. */
export function ShortcutRevealBadge(props: { readonly bindingId: string; readonly cover?: boolean }) {
  const { activeSurface } = useShortcutRevealPresentation()
  if (activeSurface !== "local") return null
  return <ActiveShortcutRevealBadge bindingId={props.bindingId} cover={props.cover} />
}

/** Subscribe to live keymap changes only during the short reveal window. */
function ActiveShortcutRevealBadge(props: { readonly bindingId: string; readonly cover?: boolean }) {
  const { theme } = useTheme()
  useKeymapVersion()
  useBindingStackVersion()
  const caption = shortcutCaption({
    bindingId: props.bindingId,
    reachability: currentBindingReachability(),
    prefixKey: currentPrefixConfiguration().key,
  })

  if (!caption) return null
  return (
    <box
      position="absolute"
      left={props.cover ? 0 : undefined}
      right={0}
      top={0}
      zIndex={20}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.backgroundElement}
      justifyContent="flex-end"
    >
      <text fg={theme.primary} wrapMode="none">
        {caption}
      </text>
    </box>
  )
}
