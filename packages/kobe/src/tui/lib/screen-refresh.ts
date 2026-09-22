/**
 * Full repaint when the terminal changed shape under the renderer, plus a
 * manual repair chord.
 *
 * Bug: OpenTUI 0.4.3 renders by diffing, and `processResize` (index-xt9f071j.js
 * ~9124) never sets `forceFullRepaintRequested` in `alternate-screen` mode (only
 * suspend/resume, a capability reply, split-footer replay do). A terminal that
 * reflowed its grid on resize leaves cells the renderer thinks it owns, so
 * diffed frames never clear them: overlapping sidebar rows, quota line over the
 * footer, never self-heals. Measured on Windows 11 through a real ConPTY: at
 * 70x20 the engine pane read `RuncseveralRAIecoding` (leftovers from the
 * 120-column frame).
 *
 * Not the bug (measured): Bun 1.4.2 emulates `SIGWINCH` on win32 and fires it
 * (plus stdout `resize`, fresh `columns`/`rows`) while the process READS stdin
 * — libuv gets the size from a `WINDOW_BUFFER_SIZE_EVENT` on the console input
 * handle, so a process not reading stdin sees nothing and a paused one gets it
 * on resume. OpenTUI's handler works; layout re-flows; only leftovers stay.
 *
 * The self-heal installs are win32-only ({@link needsScreenSelfHeal}) so
 * macOS/Linux frames stay byte-identical; the fix likely helps there too, but
 * an extra full frame per resize needs checking on a real macOS terminal first.
 * {@link redrawScreen} is cross-platform and chord-only.
 */

/** The slice of `CliRenderer` this module drives. */
export interface RefreshableRenderer {
  readonly screenMode: string
  requestRender(): void
}

/** {@link RefreshableRenderer} plus the two events {@link installScreenSelfHeal} listens to. */
export interface RepaintEventRenderer extends RefreshableRenderer {
  on(event: "resize" | "focus", listener: () => void): unknown
  off(event: "resize" | "focus", listener: () => void): unknown
}

/** CUP to 1,1 — `ESC [ H`. */
const ANSI_HOME = "\x1b[H"
/** ED 2 — erase the whole display, `ESC [ 2 J`. */
const ANSI_ERASE_SCREEN = "\x1b[2J"

/** win32 only — see the module header. */
export function needsScreenSelfHeal(platform: NodeJS.Platform): boolean {
  return platform === "win32"
}

/**
 * Request one non-diffed frame by setting OpenTUI's `private
 * forceFullRepaintRequested` (UPSTREAM GAP: no public API, and patching
 * `node_modules` is off the table, so the cast stays confined here).
 *
 * Skips split-footer (inline) hosts: there the flag drives
 * `flushPendingSplitCommits`, which would replay the user's scrollback.
 *
 * @returns whether a repaint was actually requested.
 */
export function requestFullRepaint(renderer: RefreshableRenderer): boolean {
  if (renderer.screenMode !== "alternate-screen") return false
  const internals = renderer as unknown as { forceFullRepaintRequested: boolean }
  internals.forceFullRepaintRequested = true
  renderer.requestRender()
  return true
}

/**
 * Write raw bytes without racing the renderer: with `useThread` on (OpenTUI's
 * default except Linux) JS and the native render thread share fd 1, so a direct
 * stdout write can land mid-escape-sequence. `writeOut` queues on the native
 * side that emits frames. Falls back to the stream with no renderer (tests,
 * mocks) or if `writeOut` disappears.
 */
export function writeThroughRenderer(
  renderer: RefreshableRenderer | null | undefined,
  chunk: string,
  fallback: Pick<NodeJS.WriteStream, "write"> = process.stdout,
): void {
  const writeOut = (renderer as unknown as { writeOut?: (chunk: string) => unknown } | null | undefined)?.writeOut
  try {
    if (typeof writeOut === "function") writeOut.call(renderer, chunk)
    else fallback.write(chunk)
  } catch {
    /* swallow — every caller here is best-effort chrome, never content */
  }
}

/**
 * The "repair the screen" chord: erase, then full repaint. The erase is needed
 * because with `transparentBackground` repainted cells are alpha 0, so anything
 * the frame doesn't cover (background image, stale output) would stay visible.
 *
 * @returns whether the redraw ran (false in inline/split-footer hosts, which
 *   share the main screen with the shell and must never erase it).
 */
export function redrawScreen(renderer: RefreshableRenderer): boolean {
  if (renderer.screenMode !== "alternate-screen") return false
  writeThroughRenderer(renderer, ANSI_HOME + ANSI_ERASE_SCREEN)
  return requestFullRepaint(renderer)
}

/**
 * Force a full frame on:
 *   - **resize** — OpenTUI already applied the new geometry, so this is the
 *     first frame at the new size.
 *   - **focus** — Windows Terminal re-renders panes on tab/split switch and
 *     font-size change, sometimes without a size change (so no resize event),
 *     leaving the returning pane wrong.
 *
 * No-op detach off win32.
 */
export function installScreenSelfHeal(opts: {
  renderer: RepaintEventRenderer
  platform?: NodeJS.Platform
}): () => void {
  const platform = opts.platform ?? process.platform
  if (!needsScreenSelfHeal(platform)) return () => {}
  const { renderer } = opts
  const repaint = (): void => {
    requestFullRepaint(renderer)
  }
  renderer.on("resize", repaint)
  renderer.on("focus", repaint)
  return () => {
    renderer.off("resize", repaint)
    renderer.off("focus", repaint)
  }
}
