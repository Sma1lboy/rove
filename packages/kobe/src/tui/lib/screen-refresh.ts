/**
 * Repaint the whole screen when the terminal changed shape underneath the
 * renderer, and give the user a chord to repair it by hand.
 *
 * ## What actually goes wrong on Windows
 *
 * OpenTUI 0.4.3 renders by DIFFING against its model of what the terminal is
 * showing, and `processResize` (index-xt9f071j.js ~9124) never sets
 * `forceFullRepaintRequested` in `alternate-screen` mode — the flag is set on
 * suspend/resume, on a capability reply, and on a split-footer replay, and
 * nowhere else. A terminal that reflowed its own grid while resizing has
 * moved cells the renderer still believes it owns, so the next diffed frame
 * writes only what CHANGED and leaves the reflowed leftovers in place. That
 * is the reported symptom exactly: sidebar rows overlapping each other, the
 * quota line drawn over the footer, fragments of the pane you already left —
 * and it never self-heals, because every later frame is another diff.
 *
 * Measured on this repo's Windows 11 machine, driving the BUILT TUI through a
 * real ConPTY (what Windows Terminal uses) and decoding only the bytes emitted
 * after each resize: at 70x20 the engine pane came back reading
 * `RuncseveralRAIecoding` — "Run several AI coding" with the spaces still
 * holding glyphs from the 120-column frame.
 *
 * ## What does NOT go wrong (measured, against the original suspicion)
 *
 * Windows DOES deliver resizes to Rove. Bun 1.4.2 emulates `SIGWINCH` on
 * win32 and fires it — along with `stdout`'s `resize` event and fresh
 * `columns`/`rows` — whenever the process is READING stdin, which every TUI
 * is. libuv learns the new size from a `WINDOW_BUFFER_SIZE_EVENT` record on
 * the console INPUT handle, so a process that never touches stdin sees none
 * of it (that is what made the first probe here look like a dead signal), and
 * one that pauses stdin gets the event on resume instead. OpenTUI's SIGWINCH
 * handler therefore works on Windows, and Rove needs no resize source of its
 * own. The layout DOES re-flow to the new size on the unfixed build; only the
 * leftovers stay.
 *
 * ## Platform gating
 *
 * The two repaint installs are win32-only ({@link needsScreenSelfHeal}), so
 * macOS and Linux keep byte-for-byte the frames they emit today. The
 * mechanism is not Windows-specific and the same repaint would very likely
 * help there, but "one extra full frame per resize" is a visual-cost call
 * that has to be watched on a real macOS terminal first.
 * {@link redrawScreen} is the cross-platform piece, and it only runs when the
 * user presses the chord.
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

/**
 * Does this platform get Rove's own screen repair?
 *
 * win32 only — see the "Platform gating" note in the module header.
 */
export function needsScreenSelfHeal(platform: NodeJS.Platform): boolean {
  return platform === "win32"
}

/**
 * Reach past OpenTUI's `private forceFullRepaintRequested` to ask for one
 * non-diffed frame.
 *
 * UPSTREAM GAP: OpenTUI 0.4.3 sets that flag itself on suspend/resume, on a
 * capability reply, and on a split-footer replay, but exposes no public way
 * to ask for it — and does NOT set it in `processResize` for
 * `alternate-screen` mode, which is the case this module exists to repair.
 * Patching `node_modules` is off the table, so the reach is confined to this
 * one function and one cast.
 *
 * Split-footer (inline) hosts are skipped on purpose: there the flag drives
 * `flushPendingSplitCommits`, which replays captured scrollback rather than
 * repainting a screen, and a spurious force would re-emit the user's output.
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
 * Send raw bytes to the terminal WITHOUT racing the renderer.
 *
 * `process.stdout.write` from JS and the native render thread both hold fd 1
 * whenever `useThread` is on (OpenTUI's default everywhere but Linux), so a
 * bell / OSC notification written straight to stdout can land in the middle
 * of a frame's escape sequences. Routing it through OpenTUI's `writeOut`
 * queues it on the same native side that emits frames: identical bytes,
 * defined ordering.
 *
 * Falls back to the stream when there is no renderer (render tests, mock
 * hosts) or when OpenTUI stops exposing `writeOut`.
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
 * The user-facing "repair the screen" action: erase the alternate screen,
 * then repaint every cell.
 *
 * The erase is what a full repaint alone cannot do. With
 * `transparentBackground` on, the theme's background and panel slots are
 * rewritten to alpha 0, so a repainted cell carries no opaque color of its
 * own — anything the renderer's frame does not cover (a terminal background
 * image, another program's leftovers) stays visible. ED 2 gives the frame a
 * clean surface first.
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
 * Repaint the whole screen after the terminal changed shape or came back.
 *
 *   - **resize** — OpenTUI has already applied the new geometry and emitted
 *     the event by the time this runs, so the forced frame is the FIRST one
 *     drawn at the new size. That is the fix for the leftovers described in
 *     the module header.
 *   - **focus** — Windows Terminal reflows and re-renders its panes on
 *     tab/split switches and on a font-size change. Some of those leave the
 *     cell grid the same size, so no resize is delivered and the diffing
 *     renderer has nothing to correct, yet the pane the user comes back to is
 *     already wrong. A focus-in is a cheap, user-triggered moment to spend
 *     one non-diffed frame.
 *
 * Installs nothing off win32; returns a no-op detach there.
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
