/** @jsxImportSource @opentui/react */
/**
 * Embedded terminal pane — React port of `tui/panes/terminal/Terminal.tsx`
 * (issue #16 React migration). Same seam: the PureTUI Workspace Host
 * mounts it as the center column running the task's real interactive
 * engine CLI (its `command` prop); it also works as a plain worktree
 * shell. Body: a headless xterm screen snapshot fed by the task PTY,
 * clipped via opentui's `overflow` + viewport slicing.
 *
 * Shared framework-free logic (PTY backend, key encoding, SGR→StyledText,
 * viewport math, grid selection) is imported straight from the Solid
 * cluster `tui/panes/terminal/*` — this file (plus its `use-terminal-*`
 * hooks) owns only the React reactivity. See the Solid original for the
 * full lifecycle rationale (acquire/subscribe contract, never-kill-on-
 * unmount, dead-shell banner, F5 reset). Deltas below.
 *
 * Solid→React translation notes:
 *   - `cwd`/`taskId`/`focused`/`resetToken` are plain values, not
 *     Accessors — React re-renders on prop change.
 *   - The Solid original's declaration-order comment ("selection memo
 *     BEFORE the render memos — cursorRows reads selection() during its
 *     EAGER first evaluation, a later declaration is a TDZ crash") is a
 *     Solid-specific hazard: `createMemo` evaluates eagerly at
 *     declaration time there. React's `useMemo` evaluates lazily off a
 *     dependency array during render, so no such ordering constraint
 *     exists — the hooks below are ordered for readability, not
 *     correctness.
 *   - Body-box measurement and the resize-push / host-cursor-anchor
 *     effects live in `use-terminal-geometry.ts` and
 *     `use-terminal-host-cursor.ts`. They receive the PTY handle and the
 *     computed viewport cursor after `useTerminalPty` has produced them,
 *     so the call order in this file remains the same and there is no
 *     chicken-and-egg hook-ordering hazard.
 */

import type { EngineTerminalPresentation } from "@/types/terminal-presentation"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import { StyledText } from "@opentui/core"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ImeCursorRetention } from "../../../tui/panes/terminal/ime-cursor"
import { type PtyRegistry, getDefaultPtyRegistry } from "../../../tui/panes/terminal/registry"
import { rowsToStyledText } from "../../../tui/panes/terminal/sgr-to-text-chunk"
import { isShellMissing, overlayCursor, sealRowEndAttributes } from "../../../tui/panes/terminal/terminal-render"
import { overlaySelection } from "../../../tui/panes/terminal/terminal-selection"
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
import { useLatest } from "../../lib/use-latest"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { useTerminalBindings } from "./keys"
import { useTerminalGeometry } from "./use-terminal-geometry"
import { useTerminalHostCursor } from "./use-terminal-host-cursor"
import { useTerminalPty } from "./use-terminal-pty"
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
  /** Raw keystroke bytes just written to the PTY — the optimistic
   *  activity feed (engine tabs only; see workspace/optimistic-activity). */
  onUserInput?: (data: string) => void
  /**
   * Whether this mounted terminal represents the visible chat tab / active
   * split leaf for macOS IME placement. Unlike `focused`, this stays true when
   * keyboard ownership moves to Sidebar or Files. Inactive split leaves pass
   * false so background output cannot steal the shared anchor. An explicit
   * true also designates the sole unfocused attachment-paste target; omission
   * remains IME-compatible but fails closed for attachment routing.
   */
  imeAnchorActive?: boolean
  /**
   * Ask the host to focus this pane (mouse click). Needed because opentui
   * mouse events don't bubble to the workspace wrapper's `onMouseUp`, and
   * this pane's own selection handlers consume the click — so a bare click
   * inside the terminal would never reach the global focus setter.
   */
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
  /** Paste-delivery vendor's first message + the engine binary its up-probe
   *  matches (`TaskPtyOpts.firstMessage`, issue #25): the hosted backend
   *  pastes it once the fresh-spawned engine is up; reattaches never
   *  redeliver it. */
  firstMessage?: string
  engineBin?: string
  /**
   * Fires once when the PTY reports exit (or is already dead at mount) —
   * `undefined` for the default "leave the dead shell + exit banner up"
   * behavior. Used by `TerminalTabs.tsx` to auto-close command tabs and
   * to degrade engine tabs to a shell. `info.deadOnAttach` marks an exit
   * discovered on reattach (engine died while the TUI was away) so the
   * tab layer can resume instead of degrading.
   */
  onExit?: (info?: { deadOnAttach?: boolean }) => void
  /**
   * Bump this to force a fresh PTY acquire under the SAME `cwd`/`taskId`
   * — for a caller whose underlying command changed without the pty key
   * changing. Ignored on the initial mount.
   */
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
  const { theme } = useTheme()
  const t = useT()
  const registry = props.registry ?? getDefaultPtyRegistry()

  // Local "focus" — the pane manages its own focus on click unless the
  // caller drives it via `props.focused` (behavior tests).
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

  const { pty, snapshot, snapshotWindow, cursor, exited, acquireError, forceReacquire } = useTerminalPty({
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

  // Shared by the ctrl+pgup/pgdn chords and the mouse wheel. Positive
  // `lines` moves toward newer output, negative moves up into history.
  // Clamped to the real history depth.
  const scrollBy = (lines: number): void => {
    setScrollState((current) => moveViewportScroll(current, snapshot.length, bodyRows, lines, snapshotWindow))
  }

  /**
   * Emulator order for ANY scroll this pane performs — a wheel tick or a
   * selection drag hanging past an edge. An app that owns its own scrollback
   * (mouse tracking, or a fullscreen app on the alternate screen) gets wheel
   * events; only when it wants neither do we move kobe's local viewport.
   * Engine tabs are why this matters for the drag: Claude Code runs on the
   * ALTERNATE screen, where there is no local scrollback to move at all, so a
   * drag held at the edge has to ask the app to scroll, exactly as the wheel
   * does. `screenX`/`screenY` are absolute pointer coords. Returns true when
   * the scroll was forwarded — the selection hook then tracks the content
   * shifts the app's redraws cause under the fixed snapshot rows.
   */
  const scrollFromPointer = (lines: number, screenX: number, screenY: number): boolean => {
    if (lines === 0) return false
    const direction = lines < 0 ? "up" : "down"
    if (pty && !pty.killed && bodyEl) {
      const col = Math.max(1, screenX - bodyEl.screenX + 1)
      const row = Math.max(1, screenY - bodyEl.screenY + 1)
      if (pty.wheel(direction, col, row)) {
        for (let i = 1; i < Math.abs(lines); i++) pty.wheel(direction, col, row)
        return true
      }
    }
    scrollBy(lines)
    return false
  }

  /* --------- viewport slicing ---------- */

  // Rows visible after applying scroll offset. offset 0 means
  // follow-bottom: render only the last body-height rows.
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
    scrollBy: scrollFromPointer,
  })

  const terminalColors = useMemo(() => {
    const foreground = theme.text.toInts()
    const background = theme.background.toInts()
    return {
      foreground: [foreground[0], foreground[1], foreground[2]],
      background: [background[0], background[1], background[2]],
    } as const
  }, [theme])

  const cursorRows = useMemo(() => {
    const withSelection = overlaySelection(
      visibleRows,
      selection.selection,
      visibleRange.start,
      bodyGeometry?.cols ?? 80,
    )
    // While a selection is active, the synthetic cursor cell is hidden
    // (tmux copy-mode behavior): cursor and selection share the same
    // inverse styling, so a cursor sitting just past the selection read
    // as the highlight overrunning by one blinking cell.
    const cursorWhileUnselected = focused && !selection.selection ? visibleCursor : null
    return overlayCursor(withSelection, cursorWhileUnselected, terminalColors)
  }, [visibleRows, selection.selection, visibleRange.start, bodyGeometry, focused, visibleCursor, terminalColors])

  // Flatten every visible row into ONE `StyledText` — see the Solid
  // original for why a single element (not per-row `<text>`s) is load-
  // bearing for the cursor positioning math.
  //
  // `sealRowEndAttributes` is a local workaround for an opentui renderer bug
  // (attributes open at a row's last column leak into the rest of the frame —
  // the "wrapped URL underlines everything below it" report). Its doc comment
  // has the full mechanism; drop this call once opentui resets per row.
  const styledSnapshot = useMemo(() => {
    const sealed = sealRowEndAttributes(
      cursorRows,
      bodyGeometry?.cols ?? 80,
      terminalColors.foreground,
      terminalColors.background,
    )
    return new StyledText(rowsToStyledText(sealed))
  }, [cursorRows, bodyGeometry, terminalColors])

  // Imperative content push — opentui 0.4 won't accept StyledText as a
  // JSX child or through the content prop (stringifies it).
  const [snapshotTextEl, setSnapshotTextEl] = useState<TextRenderable | null>(null)
  useEffect(() => {
    // `isDestroyed` guard: when the pane flips pty→null (failed reset) the
    // <text> unmounts, but its null ref lands a render AFTER this effect
    // re-runs with the stale element — writing to it throws "TextBuffer is
    // destroyed" into the error boundary.
    if (snapshotTextEl && !snapshotTextEl.isDestroyed) snapshotTextEl.content = styledSnapshot
  }, [snapshotTextEl, styledSnapshot])

  /* --------- reset (F5, confirm-gated) ---------- */

  const dialog = useDialog()
  // A modal input owns the native cursor while it is open. Side-pane focus
  // does not: the visible terminal remains the stable IME fallback there.
  const imeAnchorActive = (props.imeAnchorActive ?? true) && dialog.stack.length === 0
  const unfocusedAttachmentTarget = props.imeAnchorActive === true && dialog.stack.length === 0
  const resetTaskIdRef = useLatest(props.taskId)
  const resetCwdRef = useLatest(props.cwd)
  const mountedRef = useRef(true)
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const requestReset = (): void => {
    if (!pty) return
    // Snapshot at click-time so a task switch mid-confirm doesn't reset
    // the wrong shell.
    const ptyAtClick = pty
    const cwdAtClick = props.cwd
    const taskIdAtClick = props.taskId
    const geometryAtClick = bodyGeometry
    if (!cwdAtClick || !taskIdAtClick || !geometryAtClick) return
    void DialogConfirm.show(dialog, t("terminal.reset.title"), t("terminal.reset.body"), "cancel").then((ok) => {
      if (ok !== true || !mountedRef.current) return
      if (resetTaskIdRef.current !== taskIdAtClick || resetCwdRef.current !== cwdAtClick) return
      forceReacquire(cwdAtClick, taskIdAtClick, geometryAtClick, ptyAtClick)
    })
  }

  useTerminalBindings({
    focused,
    // TerminalSplit explicitly assigns IME ownership to its active leaf.
    // Require that explicit signal here so standalone/future mounts fail closed.
    unfocusedAttachmentTarget,
    write: (data) => {
      if (!pty || pty.killed) return
      pty.write(data)
      // Engine tabs feed the optimistic sidebar-activity overlay: the
      // triggering/interrupting keypress is visible here long before the
      // hook round trip confirms it. Wired only for engine leaves.
      props.onUserInput?.(data)
    },
    paste: (text) => {
      if (!pty || pty.killed) return
      pty.paste(text)
    },
    scroll: scrollBy,
    reset: requestReset,
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
    // Borderless by design: the workspace layout wrapper owns the focus
    // border; this pane is pure content.
    <box
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        if (evt.button !== 0) return
        // Focus on press — but ONLY when not already focused, so clicking
        // inside a focused terminal is a pure no-op. A text-selection
        // drag still works regardless.
        if (!focused) props.onRequestFocus?.()
        const cell = selection.cellFromEvent(evt)
        if (!cell) return
        selection.beginSelection(cell)
      }}
      onMouseDrag={(evt) => {
        // Past the top/bottom edge this keeps scrolling on its own — opentui
        // captures the drag here, so the coordinates stay real off-pane.
        selection.dragTo(evt)
      }}
      onMouseUp={() => {
        setFocusedLocal(true)
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
        // Native terminal wheel semantics, in emulator order: the app
        // enabled mouse tracking → forward the wheel; fullscreen app
        // without it → arrow-key fallback (both inside pty.wheel); ONLY
        // otherwise scroll kobe's local scrollback.
        const scroll = evt.scroll
        if (!scroll || (scroll.direction !== "up" && scroll.direction !== "down")) return
        // One line per event — opentui's parser emits delta:1 per wheel
        // tick already granulated by the host terminal.
        const step = Math.max(1, scroll.delta || 1)
        const forwarded = scrollFromPointer(scroll.direction === "up" ? -step : step, evt.x, evt.y)
        // A wheel tick mid-drag scrolls the app too — the selection must
        // follow that shift exactly as it follows the edge pull's.
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
      {scrollOffset > 0 ? (
        <box
          position="absolute"
          zIndex={10}
          left={0}
          right={0}
          bottom={0}
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.warning} wrapMode="none">
            {t("terminal.scrolledBack", { lines: scrollOffset })}
          </text>
        </box>
      ) : null}

      <box ref={(r: BoxRenderable | null) => setBodyEl(r)} onSizeChange={bumpGeomTick} flexGrow={1} overflow="hidden">
        {/* Body */}
        {pty ? (
          // One multi-line `<text>` for the whole snapshot (rows flattened
          // with `\n`) — one <text> per row inside a flex column shifts
          // body.screenY, landing the cursor a row above the prompt.
          //
          // `selectable={false}`: this pane runs its OWN grid selection (see
          // `use-terminal-selection`), and opentui's text-flow selection can't
          // work over a snapshot that is replaced every frame. Left on, it also
          // swallows the drag — the renderer routes a live text selection to
          // whatever sits under the pointer instead of capturing it to this
          // pane, so a drag past the edge would never reach us at all.
          <text
            fg={theme.text}
            wrapMode="none"
            selectable={false}
            ref={(r: TextRenderable | null) => setSnapshotTextEl(r)}
          />
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
