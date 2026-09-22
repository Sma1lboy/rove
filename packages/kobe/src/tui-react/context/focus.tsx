/** @jsxImportSource @opentui/react */
/**
 * Pane focus — global, single source of truth. Pane wrappers set focus on
 * click, panes gate their keybindings on it, and global single-letter
 * shortcuts gate on the workspace NOT being focused.
 */

import { useRenderer } from "@opentui/react"
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react"
import { useLatest } from "../lib/use-latest"

/** The primary panes in kobe's layout. */
export type PaneId = "sidebar" | "workspace" | "files" | "terminal"

/** Cycle order — used by `tab` / `shift+tab`. */
const PANE_ORDER = ["sidebar", "workspace", "files", "terminal"] as const satisfies readonly PaneId[]

export type FocusContextValue = {
  focused: PaneId
  is: (pane: PaneId) => boolean
  setFocused: (pane: PaneId) => void
  /** Cycle by ±1 through PANE_ORDER. */
  cycle: (delta: 1 | -1) => void
}

const FocusContext = createContext<FocusContextValue | null>(null)

/**
 * Defaults to `sidebar`: cold boot has no task selected, and single-letter
 * global shortcuts work because no composer is claiming keys.
 */
export function FocusProvider(props: { children?: ReactNode; initial?: PaneId }) {
  const [focused, setFocusedState] = useState<PaneId>(props.initial ?? "sidebar")
  const renderer = useRenderer()
  const focusedRef = useLatest(focused)

  /**
   * Blur the natively focused renderable BEFORE flipping pane state, or a
   * composer textarea eats keystrokes for one tick after chording away.
   */
  const setFocused = useCallback(
    (pane: PaneId): void => {
      if (focusedRef.current === pane) return
      const current = renderer?.currentFocusedRenderable
      if (current && !current.isDestroyed) {
        try {
          current.blur()
        } catch {
          // Best-effort: pane focus must flip even if blur throws.
        }
      }
      setFocusedState(pane)
    },
    [renderer],
  )

  const cycle = useCallback(
    (delta: 1 | -1): void => {
      const idx = PANE_ORDER.indexOf(focusedRef.current)
      const next = (idx + delta + PANE_ORDER.length) % PANE_ORDER.length
      setFocused(PANE_ORDER[next] as PaneId)
    },
    [setFocused],
  )

  const value = useMemo<FocusContextValue>(
    () => ({
      focused,
      is: (pane: PaneId) => focused === pane,
      setFocused,
      cycle,
    }),
    [focused, setFocused, cycle],
  )

  return <FocusContext.Provider value={value}>{props.children}</FocusContext.Provider>
}

/** Throws outside `<FocusProvider>` — that's a bug, so fail loud. */
export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext)
  if (!ctx) {
    throw new Error("useFocus: must be called inside <FocusProvider>. See src/tui-react/context/focus.tsx.")
  }
  return ctx
}

/** Null outside a provider, for subscribers that degrade in focus-less mounts (render tests). */
export function useOptionalFocus(): FocusContextValue | null {
  return useContext(FocusContext)
}
