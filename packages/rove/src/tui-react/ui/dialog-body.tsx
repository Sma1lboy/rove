/** @jsxImportSource @opentui/react */
import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

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
  const t = useT()
  const renderer = useRenderer()
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const [overflow, setOverflow] = useState({ above: 0, below: 0 })
  useEffect(() => {
    const body = scroll.current
    if (!body) return
    let previous: typeof overflow | undefined
    const refresh = () => {
      const above = Math.max(0, body.scrollTop)
      const below = Math.max(0, body.content.height - body.viewport.height - above)
      if (previous?.above === above && previous.below === below) return
      previous = { above, below }
      setOverflow(previous)
    }
    // Measure after Yoga settles, including keyboard, mouse and resize scrolls.
    renderer.addPostProcessFn(refresh)
    refresh()
    return () => renderer.removePostProcessFn(refresh)
  }, [renderer])
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
      <text height={1} flexShrink={0} fg={theme.textMuted} wrapMode="none">
        {[
          overflow.above > 0 ? t("newTask.scroll.moreAbove", { count: overflow.above }) : "",
          overflow.below > 0 ? t("newTask.scroll.moreBelow", { count: overflow.below }) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </text>
    </DialogFocusContext.Provider>
  )
}
