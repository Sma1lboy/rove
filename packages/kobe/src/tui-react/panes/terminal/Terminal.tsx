/** @jsxImportSource @opentui/react */
/**
 * Embedded terminal pane: the task's interactive engine CLI (`command`) or a
 * plain worktree shell, drawn from a headless xterm snapshot fed by the task
 * PTY. The lifecycle contract (acquire/subscribe, never-kill-on-unmount,
 * dead-shell banner, F5 reset) is documented on `use-terminal-pty.ts`.
 */

import type { EngineTerminalPresentation } from "@/types/terminal-presentation"
import type { BoxRenderable } from "@opentui/core"
import { useMemo, useState } from "react"
import { ImeCursorRetention } from "../../../tui/panes/terminal/ime-cursor"
import { type PtyRegistry, getDefaultPtyRegistry } from "../../../tui/panes/terminal/registry"
import { isShellMissing } from "../../../tui/panes/terminal/terminal-render"
import {
  FOLLOW_VIEWPORT,
  type ViewportScrollState,
  computeViewport,
  moveViewportScroll,
  resolveViewportScrollOffset,
  viewportCursor,
} from "../../../tui/panes/terminal/viewport"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useDialog } from "../../ui/dialog"
import { useTerminalBindings } from "./keys"
import { TerminalSearchBar } from "./search-bar"
import { useTerminalGeometry } from "./use-terminal-geometry"
import { useTerminalHostCursor } from "./use-terminal-host-cursor"
import { useTerminalPaint } from "./use-terminal-paint"
import { useTerminalPointerForward } from "./use-terminal-pointer-forward"
import { useTerminalPty } from "./use-terminal-pty"
import { useTerminalReset } from "./use-terminal-reset"
import { useTerminalSearch } from "./use-terminal-search"
import { useTerminalSelection } from "./use-terminal-selection"

/* --------------------------------------------------------------------- */
/*  Public surface                                                        */
/* --------------------------------------------------------------------- */

export type TerminalProps = {
  /** Working dir for the shell. Null disables the pane (no task). */
  cwd: string | null
  /** Stable id used for pty registry keying. */
  taskId: string | null
  focused?: boolean
  /** Raw keystroke bytes just written: the optimistic activity feed (engine tabs only). */
  onUserInput?: (data: string) => void
  /**
   * The visible chat tab / active split leaf for macOS IME placement; unlike
   * `focused`, stays true when Sidebar or Files own the keyboard. Inactive
   * leaves pass false so background output can't steal the anchor. Only an
   * explicit true makes this the unfocused attachment-paste target.
   */
  imeAnchorActive?: boolean
  /** Ask the host to focus this pane on click: the pane's selection handlers
   *  consume the click before the workspace wrapper sees it. */
  onRequestFocus?: () => void
  /** Override the embedded process argv (e.g. `["claude"]` to embed an
   *  interactive Claude Code session instead of a plain shell). */
  command?: readonly string[]
  /**
   * Typed into a FRESH spawn right after `command` starts (`TaskPtyOpts.
   * initialInput`) — the shell-wrapped engine launch. Reattaches to an
   * existing session never resend it.
   */
  initialInput?: string
  /** Paste-delivery first message + the binary its up-probe matches; pasted
   *  once a fresh spawn is up, never on reattach. */
  firstMessage?: string
  engineBin?: string
  /**
   * Fires once on PTY exit (or dead at mount); absent = leave the dead shell +
   * exit banner up. `info.deadOnAttach` marks an exit found on reattach, so
   * the tab layer can resume instead of degrading.
   */
  onExit?: (info?: { deadOnAttach?: boolean }) => void
  /** Bump to force a fresh PTY acquire under the same pty key. Ignored on mount. */
  resetToken?: number
  /** Optional registry override (tests inject a mock-backed registry). */
  registry?: PtyRegistry
  /** Vendor-owned full-screen presentation policy for the original engine leaf. */
  terminalPresentation?: EngineTerminalPresentation
}

/* --------------------------------------------------------------------- */
/*  Component                                                             */
/* --------------------------------------------------------------------- */

export function Terminal(props: TerminalProps) {
  return <TerminalSession key={props.taskId} {...props} />
}

function TerminalSession(props: TerminalProps) {
  const { theme } = useTheme()
  const t = useT()
  const registry = props.registry ?? getDefaultPtyRegistry()

  // Self-managed focus unless the caller drives `props.focused`.
  const [focusedLocal, setFocusedLocal] = useState(false)
  const focused = props.focused ?? focusedLocal

  const [scrollState, setScrollState] = useState<ViewportScrollState>(FOLLOW_VIEWPORT)

  const { bodyEl, setBodyEl, bodyRows, bodyGeometry, bumpGeomTick, dims, geomTick } = useTerminalGeometry()
  const defaultColors = useMemo(() => {
    const [foregroundR, foregroundG, foregroundB] = theme.text.toInts()
    const [backgroundR, backgroundG, backgroundB] = theme.background.toInts()
    const hex = (r: number, g: number, b: number): `#${string}` =>
      `#${[r, g, b].map((component) => component.toString(16).padStart(2, "0")).join("")}`
    return {
      foreground: hex(foregroundR, foregroundG, foregroundB),
      background: hex(backgroundR, backgroundG, backgroundB),
    }
  }, [theme])
  const alternateScreenStyleRewrites = useMemo(
    () => props.terminalPresentation?.alternateScreenStyleRewrites(defaultColors),
    [props.terminalPresentation, defaultColors],
  )

  const { pty, snapshot, snapshotWindow, wrapped, cursor, exited, acquireError, forceReacquire } = useTerminalPty({
    cwd: props.cwd,
    taskId: props.taskId,
    command: props.command,
    initialInput: props.initialInput,
    firstMessage: props.firstMessage,
    engineBin: props.engineBin,
    defaultColors,
    alternateScreenStyleRewrites,
    resetToken: props.resetToken,
    onExit: props.onExit,
    registry,
    bodyGeometry,
    onFreshPty: () => setScrollState(FOLLOW_VIEWPORT),
  })

  // A historical view is anchored to an absolute PTY row, not to the live
  // bottom. The fallback offset preserves degraded pipe/mock behavior.
  const scrollOffset = resolveViewportScrollOffset(snapshot.length, bodyRows, scrollState, snapshotWindow)

  // Positive `lines` = toward newer output; clamped to the real history depth.
  const scrollBy = (lines: number): void => {
    setScrollState((current) => moveViewportScroll(current, snapshot.length, bodyRows, lines, snapshotWindow))
  }

  // Pointer → PTY routing in emulator order (wheel and buttons); the pane
  // only scrolls its local viewport when the app wants neither.
  const { scrollFromPointer, forwardMouse } = useTerminalPointerForward({ pty, bodyEl, scrollBy })

  /* --------- viewport slicing ---------- */

  // offset 0 = follow-bottom.
  const visibleRange = useMemo(
    () => computeViewport(snapshot.length, bodyRows, scrollOffset),
    [snapshot.length, bodyRows, scrollOffset],
  )
  const visibleRows = useMemo(() => snapshot.slice(visibleRange.start, visibleRange.end), [snapshot, visibleRange])
  // Cursor is only meaningful when following the bottom of the buffer;
  // once scrolled back, the live (x,y) refers to the LIVE viewport.
  const visibleCursor = useMemo(
    () => viewportCursor(cursor, scrollOffset, visibleRange),
    [cursor, scrollOffset, visibleRange],
  )
  // The inverse-cell cursor above follows the PTY's current visibility.
  // macOS IME anchoring instead retains the last valid coordinate while an
  // app briefly hides its cursor during a redraw.
  const [imeCursorRetention] = useState(() => new ImeCursorRetention())
  const imeCursor = imeCursorRetention.update(pty, cursor)
  const visibleImeCursor = useMemo(
    () => viewportCursor(imeCursor, scrollOffset, visibleRange),
    [imeCursor, scrollOffset, visibleRange],
  )

  /* --------- selection ---------- */

  const selection = useTerminalSelection({
    bodyEl,
    bodyGeometry,
    bodyRows,
    visibleRangeStart: visibleRange.start,
    snapshot,
    snapshotWindow,
    wrapped,
    scrollBy: scrollFromPointer,
    // Read, not clicked: the app can take the mouse under an existing selection.
    appOwnsMouse: pty?.appOwnsMouse ?? false,
  })

  /* --------- scrollback search ---------- */

  const search = useTerminalSearch({
    focused,
    snapshot,
    snapshotWindow,
    wrapped,
    bodyRows,
    onAlternateScreen: pty?.onAlternateScreen ?? false,
    scrollState,
    setScrollState,
  })

  const terminalColors = useMemo(() => {
    const foreground = theme.text.toInts()
    const background = theme.background.toInts()
    return {
      foreground: [foreground[0], foreground[1], foreground[2]],
      background: [background[0], background[1], background[2]],
    } as const
  }, [theme])

  const setSnapshotGrid = useTerminalPaint({
    visibleRows,
    firstRow: visibleRange.start,
    cols: bodyGeometry?.cols ?? 80,
    selection: selection.selection,
    paintMatches: search.paint,
    cursor: visibleCursor,
    focused,
    colors: terminalColors,
  })

  /* --------- reset (F5, confirm-gated) ---------- */

  const dialog = useDialog()
  // A modal input owns the native cursor while it is open. Side-pane focus
  // does not: the visible terminal remains the stable IME fallback there.
  const imeAnchorActive = (props.imeAnchorActive ?? true) && dialog.stack.length === 0
  const unfocusedAttachmentTarget = props.imeAnchorActive === true && dialog.stack.length === 0
  const requestReset = useTerminalReset({
    pty,
    acquireError,
    cwd: props.cwd,
    taskId: props.taskId,
    bodyGeometry,
    forceReacquire,
    dialog,
  })

  /**
   * Copy the live selection, then drop it. False = no selection, so ctrl+c
   * goes through as SIGINT. Keyed on "a selection exists", not the platform:
   * Rove draws the selection, so no emulator knows to claim the chord.
   */
  const copySelectionIfAny = (): boolean => {
    if (!selection.selection) return false
    selection.copySelection()
    selection.endDragging()
    selection.clearSelection()
    return true
  }

  useTerminalBindings({
    focused,
    // Require TerminalSplit's explicit ownership signal; other mounts fail closed.
    unfocusedAttachmentTarget,
    inputModes: () => pty?.inputModes() ?? { applicationCursorKeys: false, applicationKeypad: false },
    copySelection: copySelectionIfAny,
    write: (data) => {
      // Selection-aware ctrl+c, here because BOTH input paths funnel through
      // `write`: the one choke point the interrupt byte can't bypass.
      if (data === "\x03" && copySelectionIfAny()) return
      if (!pty || pty.killed) return
      pty.write(data)
      // The keypress is visible here long before the hook round trip confirms it.
      props.onUserInput?.(data)
    },
    paste: (text) => {
      if (!pty || pty.killed) return
      pty.paste(text)
    },
    scroll: scrollBy,
    reset: requestReset,
    searchActive: search.active,
    openSearch: search.open,
    stepSearch: search.step,
    closeSearch: search.close,
  })

  /* --------- resize-push + host-cursor anchor ---------- */

  useTerminalHostCursor({
    pty,
    bodyEl,
    bodyGeometry,
    visibleImeCursor,
    imeAnchorActive,
    dims,
    geomTick,
  })

  /* --------- view ---------- */

  return (
    // Borderless: the workspace wrapper owns the focus border.
    <box
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        // Focus on press only when unfocused; a click in a focused pane is a no-op.
        if (!focused) props.onRequestFocus?.()
        if (forwardMouse("down", evt)) return
        if (evt.button !== 0) return
        const cell = selection.cellFromEvent(evt)
        if (!cell) return
        selection.beginSelection(cell)
      }}
      onMouseDrag={(evt) => {
        if (forwardMouse("drag", evt)) return
        // opentui captures the drag, so coordinates stay real off-pane.
        selection.dragTo(evt)
      }}
      onMouseUp={(evt) => {
        setFocusedLocal(true)
        if (forwardMouse("up", evt)) return
        if (!selection.isDragging()) return
        selection.endDragging()
        if (selection.selection) {
          // Real drag: copy and keep the highlight (cleared on next click).
          selection.copySelection()
        } else {
          // Plain click: clear any previous selection.
          selection.clearSelection()
        }
      }}
      onMouseScroll={(evt) => {
        // Emulator order: mouse tracking → forward; fullscreen without it →
        // arrow keys (both in pty.wheel); ONLY otherwise local scrollback.
        const scroll = evt.scroll
        if (!scroll || (scroll.direction !== "up" && scroll.direction !== "down")) return
        // One line per event: the host terminal already granulated the ticks.
        const step = Math.max(1, scroll.delta || 1)
        const forwarded = scrollFromPointer(scroll.direction === "up" ? -step : step, evt.x, evt.y)
        // A wheel tick mid-drag scrolls the app; the selection must follow.
        if (forwarded) selection.noteAppScroll()
      }}
    >
      {/* Scroll affordance overlays the historical viewport instead of
          joining this flex column. A flow child would shrink `bodyEl` by
          one row on the first wheel tick, resize xterm, invalidate its
          absolute-line epoch, and put the stream back on a drifting
          relative offset. */}
      {exited ? (
        <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
          <text fg={theme.error} wrapMode="none">
            {t("terminal.exited")}
          </text>
        </box>
      ) : null}
      {search.active ? (
        <TerminalSearchBar
          query={search.query}
          index={search.index}
          matchCount={search.matchCount}
          unavailable={search.unavailable}
        />
      ) : null}
      {/* The query row states where you are, so it replaces this hint rather
          than stacking on it — both are bottom-anchored overlays. */}
      {scrollOffset > 0 && !search.active ? (
        <box
          position="absolute"
          zIndex={10}
          left={0}
          right={0}
          bottom={0}
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          gap={1}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          // `backgroundElement`: `backgroundPanel` is alpha-0 in transparent
          // mode, and a readable overlay must never go transparent.
          backgroundColor={theme.backgroundElement}
        >
          <text fg={theme.warning} wrapMode="none">
            {t("terminal.scrolledBack", { lines: scrollOffset })}
          </text>
          <text
            fg={theme.info}
            wrapMode="none"
            onMouseUp={(event) => {
              event.stopPropagation()
              if (event.button !== 0) return
              selection.clearSelection()
              scrollBy(-snapshot.length)
              props.onRequestFocus?.()
            }}
          >
            {t("terminal.scrollFirst")}
          </text>
          <text
            fg={theme.info}
            wrapMode="none"
            onMouseUp={(event) => {
              event.stopPropagation()
              if (event.button !== 0) return
              selection.clearSelection()
              setScrollState(FOLLOW_VIEWPORT)
              props.onRequestFocus?.()
            }}
          >
            {t("terminal.scrollLatest")}
          </text>
        </box>
      ) : null}

      {/* The inline arrow is load-bearing, not an oversight: it re-attaches on
          every render, which is what re-runs the geometry measurement until
          Yoga has laid the box out. See `use-terminal-geometry.ts`. */}
      <box ref={(r: BoxRenderable | null) => setBodyEl(r)} onSizeChange={bumpGeomTick} flexGrow={1} overflow="hidden">
        {/* Body */}
        {pty ? (
          <box flexGrow={1} overflow="hidden" ref={setSnapshotGrid} />
        ) : (
          <box paddingLeft={1} paddingTop={1} flexDirection="column" gap={0}>
            {acquireError ? (
              <>
                <text fg={theme.error} wrapMode="word">
                  {isShellMissing(acquireError)
                    ? t("terminal.unavailable.shellMissing")
                    : t("terminal.unavailable.spawnFailed")}
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  {acquireError}
                </text>
                <text fg={theme.textMuted}>{t("terminal.unavailable.retry")}</text>
              </>
            ) : (
              <text fg={theme.textMuted}>{t("terminal.noTask")}</text>
            )}
          </box>
        )}
      </box>
    </box>
  )
}
