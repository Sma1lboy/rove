/** @jsxImportSource @opentui/react */
/**
 * Dialog stack: `useDialog` → `{ replace, push, pop, clear, stack, size,
 * setSize }`, dialog bodies passed as THUNKS so each body is created fresh
 * per render of the provider.
 *
 * The provider dims its background subtree and puts the pointer-catching
 * overlay above it. Do not implement the dimmer as a translucent full-screen
 * box: opentui's alpha box fill replaces wide-glyph cells with spaces. The
 * renderable that held native focus when the first dialog opened is refocused
 * after the stack empties, and the card stays opaque in transparent mode.
 */

import type { Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTheme } from "../context/theme"
import { ModalScopeContext, useBindings } from "../lib/keymap"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useLatest } from "../lib/use-latest"
import { useTerminalDimensions } from "../lib/use-terminal-dimensions"

/** Dialog BODY horizontal padding: 2 cells, 1 below the narrow breakpoint. Follows live resize. */
export function useDialogPaddingX(): number {
  const dims = useTerminalDimensions()
  return isNarrowWidth(dims.width) ? 1 : 2
}

export type DialogSize = "small" | "medium" | "large" | "xlarge"
export type DialogPlacement = "center" | "upper-fifth"

const DIALOG_CONTENT_OPACITY = 0.5
const TRANSPARENT_DIALOG_CONTENT_OPACITY = 0.75

function Dialog(props: {
  children?: ReactNode
  size?: DialogSize
  placement?: DialogPlacement
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  const dismissRef = useRef(false)
  // medium = 80 cols, small = 50; narrow PTYs cap at width-2 via maxWidth.
  const width = props.size === "xlarge" ? 140 : props.size === "large" ? 110 : props.size === "small" ? 50 : 80

  const VERTICAL_MARGIN = 2
  // Narrow: always centered; upper-fifth anchoring wastes rows a phone lacks.
  const upperFifth = props.placement === "upper-fifth" && !isNarrowWidth(dimensions.width)
  // Back up one cell for the card's paddingTop so the header lands at exactly one fifth.
  const headerTop = Math.max(VERTICAL_MARGIN, Math.floor(dimensions.height / 5))
  const cardTop = upperFifth ? Math.max(VERTICAL_MARGIN, headerTop - 1) : 0
  const maxCardHeight = Math.max(
    8,
    upperFifth ? dimensions.height - cardTop - VERTICAL_MARGIN : dimensions.height - VERTICAL_MARGIN * 2,
  )

  return (
    <box
      onMouseDown={() => {
        dismissRef.current = !!renderer?.getSelection()
      }}
      onMouseUp={() => {
        if (dismissRef.current) {
          dismissRef.current = false
          return
        }
        props.onClose?.()
      }}
      width={dimensions.width}
      height={dimensions.height}
      alignItems="center"
      // Most dialogs stay centered. Attention queues may opt into an upper
      // anchor so their header aligns with the viewport's first fifth.
      justifyContent={upperFifth ? "flex-start" : "center"}
      paddingTop={cardTop}
      position="absolute"
      zIndex={3000}
      left={0}
      top={0}
      shouldFill={false}
    >
      <box
        onMouseUp={(e: { stopPropagation(): void }) => {
          dismissRef.current = false
          e.stopPropagation()
        }}
        width={width}
        maxWidth={dimensions.width - 2}
        maxHeight={maxCardHeight}
        flexShrink={1}
        // Content-sized + maxHeight: tall cards hit the cap and clip.
        flexGrow={0}
        // ALWAYS opaque, even in transparent mode, or panes bleed through the text.
        backgroundColor={theme.backgroundDialog}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  )
}

type StackEntry = { key: number; element: () => ReactNode; onClose?: () => void }

/** Per-entry React key seq, so consecutive dialogs of the SAME component
 *  don't reconcile in place and leak input state. */
let entrySeq = 0

export type DialogContext = {
  /**
   * Empty the stack. Pass `refocus: false` when the dialog action itself
   * navigates to a different pane, so the deferred restore cannot pull native
   * focus back to the pane that was active before the dialog opened.
   */
  clear(options?: { refocus?: boolean }): void
  /** Replace the current dialog. The thunk runs inside the provider's render, so hooks resolve. */
  replace(thunk: () => ReactNode, onClose?: () => void): void
  push(thunk: () => ReactNode, onClose?: () => void): void
  pop(): void
  readonly stack: readonly StackEntry[]
  readonly size: DialogSize
  setSize(size: DialogSize): void
  readonly placement: DialogPlacement
  setPlacement(placement: DialogPlacement): void
}

const ctx = createContext<DialogContext | null>(null)

export function DialogProvider(props: { children?: ReactNode }) {
  const [stack, setStack] = useState<readonly StackEntry[]>([])
  const [size, setSize] = useState<DialogSize>("medium")
  const [placement, setPlacement] = useState<DialogPlacement>("center")
  const renderer = useRenderer()
  const { transparentBackground } = useTheme()

  const focusRef = useRef<Renderable | null>(null)
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cancel a pending refocus on unmount: it could hit a destroyed renderable.
  useEffect(
    () => () => {
      if (refocusTimer.current) clearTimeout(refocusTimer.current)
    },
    [],
  )

  const refocus = useCallback(() => {
    if (refocusTimer.current) clearTimeout(refocusTimer.current)
    refocusTimer.current = setTimeout(() => {
      const focus = focusRef.current
      if (!focus || focus.isDestroyed) return
      function find(item: Renderable): boolean {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const root = renderer?.root
      if (!root) return
      if (!find(root)) return
      focus.focus()
    }, 1)
  }, [renderer])

  // A ref so replace/push/pop/clear stay identity-stable.
  const stackRef = useLatest(stack)

  const captureFocusIfFirst = useCallback(() => {
    // Opening the NEXT dialog in the same turn (`clear()` then `replace()`)
    // must cancel the pending refocus, or ~1ms later it steals the new input's focus.
    if (refocusTimer.current) clearTimeout(refocusTimer.current)
    if (stackRef.current.length === 0) {
      focusRef.current = renderer?.currentFocusedRenderable ?? null
      focusRef.current?.blur()
    }
  }, [renderer])

  // With a text selection the FIRST press clears it, the next closes. Never
  // disable the binding on a selection: a stale highlight would kill esc.
  const dismissTop = useCallback(() => {
    const selection = renderer?.getSelection()
    if (selection) {
      renderer?.clearSelection()
      if (selection.getSelectedText()) return
    }
    const current = stackRef.current.at(-1)
    current?.onClose?.()
    setStack((s) => s.slice(0, -1))
    refocus()
  }, [renderer, refocus])

  const value = useMemo<DialogContext>(
    () => ({
      clear(options) {
        for (const item of stackRef.current) item.onClose?.()
        setSize("medium")
        setPlacement("center")
        setStack([])
        if (options?.refocus === false) focusRef.current = null
        else refocus()
      },
      replace(thunk, onClose) {
        captureFocusIfFirst()
        for (const item of stackRef.current) item.onClose?.()
        setSize("medium")
        setPlacement("center")
        setStack([{ key: ++entrySeq, element: thunk, onClose }])
      },
      push(thunk, onClose) {
        captureFocusIfFirst()
        setStack((s) => [...s, { key: ++entrySeq, element: thunk, onClose }])
      },
      pop() {
        const current = stackRef.current.at(-1)
        current?.onClose?.()
        setStack((s) => s.slice(0, -1))
        if (stackRef.current.length <= 1) refocus()
      },
      get stack() {
        // Read the snapshot so identity visibly follows the stack; return the
        // ref so holders of an older context object see the latest stack.
        void stack
        return stackRef.current
      },
      get size() {
        return size
      },
      setSize,
      get placement() {
        return placement
      },
      setPlacement,
    }),
    // `stack` is a dependency on purpose: consumers gate on
    // `dialog.stack.length`, and without a new value on push/pop a host could
    // keep its gates disabled after Escape until something re-renders it.
    [stack, size, placement, refocus, captureFocusIfFirst],
  )

  const top = stack.at(-1)
  const contentOpacity = top ? (transparentBackground ? TRANSPARENT_DIALOG_CONTENT_OPACITY : DIALOG_CONTENT_OPACITY) : 1
  return (
    <ctx.Provider value={value}>
      <box flexGrow={1} backgroundColor={top && !transparentBackground ? "black" : "transparent"}>
        <box flexGrow={1} opacity={contentOpacity}>
          {props.children}
        </box>
      </box>
      <box position="absolute" zIndex={3000}>
        {top ? (
          // Modal precedence is DECLARED, not positional: body bindings join
          // MODAL_SCOPE and `insertRegistration` slots the barrier below them,
          // regardless of effect-commit order.
          <ModalScopeContext value={MODAL_SCOPE}>
            <ModalBarrier dismissTop={dismissTop} />
            <Dialog key={top.key} onClose={() => value.clear()} size={size} placement={placement}>
              {top.element()}
            </Dialog>
          </ModalScopeContext>
        ) : null}
      </box>
    </ctx.Provider>
  )
}

/** One process, one dialog overlay → one scope token (module-stable). */
const MODAL_SCOPE = Symbol("kobe.dialog.modal")

/**
 * Mounted exactly while a dialog is up: esc/ctrl+c dismiss AND the modal
 * cut-off. Keys the body doesn't handle stop here, so background bindings
 * need no `dialog.stack.length === 0` gates. `modalOwner` (stack position)
 * + `modal: true` (cut-off) are the contract; see RegisteredBinding.
 */
function ModalBarrier(props: { dismissTop: () => void }) {
  useBindings(
    () => ({
      modal: true,
      bindings: [
        { key: "escape", cmd: props.dismissTop },
        { key: "ctrl+c", cmd: props.dismissTop },
      ],
    }),
    { modalOwner: MODAL_SCOPE },
  )
  return null
}

export function useDialog(): DialogContext {
  const value = useContext(ctx)
  if (!value) throw new Error("useDialog must be used within a DialogProvider")
  return value
}

/** The dialog context, or null outside a provider. */
export function useOptionalDialog(): DialogContext | null {
  return useContext(ctx)
}

/**
 * Open a dialog resolving one value: `body` wires `resolve` to submit/cancel;
 * dismissal via the stack resolves `undefined`. Not for dialogs that also
 * resolve on onClose (e.g. SettingsDialog).
 */
export function showDialog<T>(
  dialog: DialogContext,
  body: (resolve: (value: T | undefined) => void) => ReactNode,
  opts?: { size?: DialogSize },
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    dialog.replace(
      () => body(resolve),
      () => resolve(undefined),
    )
    if (opts?.size) dialog.setSize(opts.size)
  })
}
