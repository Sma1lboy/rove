/**
 * Framework-free host-boot pieces shared by the Solid pane host
 * (`./host-boot.tsx`) and the React one (`src/tui-react/lib/host-boot.tsx`,
 * issue #15 G3). Extracted so the render-option contract and the
 * exit-signal backstop cannot drift between the two boot paths.
 */

/**
 * The render-option set shared by every host: transparent background (the
 * terminal's own bg shows through), passthrough external output, no
 * exit-on-Ctrl+C (hosts own their quit semantics), alternate screen, kitty
 * keyboard protocol. `onDestroy` is the only delta any host ever had; it's
 * spread in only when present so a host without teardown passes the exact
 * same shape as before.
 */
export function hostRenderOptions(onDestroy?: () => void): Record<string, unknown> {
  const base = {
    backgroundColor: "transparent",
    externalOutputMode: "passthrough",
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    useKittyKeyboard: {},
  }
  return onDestroy ? { ...base, onDestroy } : base
}

/**
 * Inline (ink-style) variant for CLI-command hosts (`kobe update list`,
 * onboarding): a reserved `heightRows` footer on the MAIN screen instead of
 * the alternate screen — the shell's scrollback stays visible above, and
 * the footer is cleared on exit so the prompt returns where it was. The
 * runtime TUI (workspace, panes) keeps `hostRenderOptions`; anything a user
 * reaches through a subcommand should feel like a prompt, not an app.
 */
export function inlineRenderOptions(heightRows: number, onDestroy?: () => void): Record<string, unknown> {
  const base = {
    backgroundColor: "transparent",
    // No externalOutputMode override: split-footer defaults to
    // capture-stdout, which replays stray logs above the footer instead of
    // letting them corrupt it.
    exitOnCtrlC: false,
    screenMode: "split-footer",
    footerHeight: heightRows,
    useKittyKeyboard: {},
  }
  return onDestroy ? { ...base, onDestroy } : base
}

/**
 * Terminal-restore backstop: pages quit via `process.exit()` (every
 * `onClose`), which fires "exit" but NOT "beforeExit" — the only hook
 * opentui registers. Without this, mouse tracking / kitty keyboard stay
 * enabled and the shell prompt drowns in `35;57;38M…` reports until a
 * manual `reset`. `destroy()` is idempotent (`_isDestroyed` guard) and
 * restores terminal+input state synchronously, so it is safe inside the
 * sync-only "exit" handler; a normal destroy beforehand makes this a no-op.
 */
export function installExitRestoreBackstop(renderer: { destroy(): void }): void {
  process.on("exit", () => renderer.destroy())
}

/** DECSET 2004 — the terminal wraps pasted text in `\x1b[200~ … \x1b[201~`. */
const BRACKETED_PASTE_ON = "\x1b[?2004h"
const BRACKETED_PASTE_OFF = "\x1b[?2004l"

/**
 * Ask the host terminal for BRACKETED PASTE, and give it back on exit.
 *
 * Without this the terminal delivers a paste as ordinary keystrokes, so every
 * newline in the pasted text is an Enter: paste three lines into an engine tab
 * and the first line is SUBMITTED while the rest land wherever the engine went
 * next. With it the terminal frames the paste, opentui's key parser buffers
 * the whole thing into one `paste` event (it knows the markers but never turns
 * the mode on), the focused pane hands it to its PTY as a paste, and
 * `pty-xterm-base.ts#paste` re-frames it for the engine when the engine itself
 * asked for the mode. Every other link of that chain already existed.
 *
 * Returns the restore, which is also registered on "exit" — pages quit through
 * `process.exit()`, and a terminal left in bracketed-paste mode makes the next
 * shell's own paste handling look broken.
 */
export function installBracketedPasteMode(stdout: NodeJS.WriteStream = process.stdout): () => void {
  if (!stdout.isTTY) return () => {}
  const write = (seq: string): void => {
    try {
      stdout.write(seq)
    } catch {
      /* a revoked tty must not take the host down */
    }
  }
  write(BRACKETED_PASTE_ON)
  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    write(BRACKETED_PASTE_OFF)
  }
  process.on("exit", restore)
  return restore
}

/**
 * Exit-signal backstop (orphaned-helper leak): opentui's own exit handler
 * for SIGHUP/SIGTERM only destroys the renderer — it never calls
 * process.exit — and installing that listener replaced the signals' default
 * "terminate" action. A host keeps its event loop alive (daemon socket,
 * file watcher, poll timers), so every tmux `kill-pane` / `respawn-pane -k`
 * / session teardown would leave the process running forever with a revoked
 * tty, reparented to launchd. Register AFTER render resolves so opentui's
 * handler (terminal restore + onDestroy) runs first.
 *
 * The exit is DELAYED, not immediate: some flows kill the session their own
 * pane lives in and then keep orchestrating (togglePreview's
 * kill→rebuild→switch, ensureSession's vendor-switch rebuild) — an instant
 * exit on the incoming SIGHUP would truncate them. Five seconds is enough
 * for any in-flight tmux sequence; the pane is already gone from the
 * screen, so the tail is invisible.
 */
export function installPaneExitBackstop(): void {
  let exitScheduled = false
  const scheduleExit = () => {
    if (exitScheduled) return
    exitScheduled = true
    setTimeout(() => process.exit(0), 5000)
  }
  for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"] as const) {
    process.on(signal, scheduleExit)
  }
}

/**
 * Orphan watchdog (issue #25) — the signal-FREE half of the leak defense.
 * The signal backstop above only fires when a signal actually arrives; when
 * the parent chain is SIGKILLed (2026-07-07: OOM killed the tmux server and
 * 41 pane hosts survived reparented to init, ~8.7GB RSS, which then fed the
 * next OOM), nothing is delivered and the host lives forever with a revoked
 * tty. A host's parent is always its tmux pane shell or the user's shell,
 * so PPID 1 can only mean "my pane/terminal is gone" — exit.
 *
 * Poll, don't listen: there is no parent-death event on macOS for an
 * already-running child. 5s cadence on a 0-work check is free.
 */
export function installOrphanExitWatchdog(intervalMs = 5000): () => void {
  const timer = setInterval(() => {
    if (process.ppid === 1) process.exit(0)
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
