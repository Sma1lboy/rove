/** @jsxImportSource @opentui/react */
import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef } from "react"
import { useTheme } from "../context/theme"

const DialogFocusContext = createContext<((element: Renderable) => void) | null>(null)

export function useDialogFocus<T extends Renderable>(focused: boolean) {
  const follow = useContext(DialogFocusContext)
  const ref = useRef<T | null>(null)
  const reveal = useCallback(() => {
    if (focused && ref.current) follow?.(ref.current)
  }, [focused, follow])
  useEffect(() => reveal(), [reveal])
  return { ref, onSizeChange: reveal }
}

/** The form scrolls within the card; its header, errors and actions stay visible. */
export function DialogBody(props: { children: ReactNode }) {
  const { theme } = useTheme()
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const focused = useRef<Renderable | null>(null)
  const reveal = useCallback(() => {
    const element = focused.current
    if (element && !element.isDestroyed) scroll.current?.scrollChildIntoView(element.id)
  }, [])
  const follow = useCallback(
    (element: Renderable) => {
      focused.current = element
      reveal()
    },
    [reveal],
  )

  return (
    <DialogFocusContext.Provider value={follow}>
      <scrollbox
        ref={scroll}
        flexGrow={0}
        flexShrink={1}
        overflow="hidden"
        scrollX={false}
        marginBottom={1}
        // The default 100% minimum stretches short forms to the card height.
        contentOptions={{ minHeight: 0 }}
        horizontalScrollbarOptions={{ visible: false }}
        onSizeChange={reveal}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.backgroundDialog, foregroundColor: theme.borderActive },
        }}
      >
        <box gap={1} paddingTop={1} flexShrink={0} onSizeChange={reveal}>
          {props.children}
        </box>
      </scrollbox>
    </DialogFocusContext.Provider>
  )
}
