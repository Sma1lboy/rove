/**
 * Framework-free host-boot pieces for `src/tui-react/lib/host-boot.tsx`, kept
 * apart so the render-option contract and exit backstops can't drift between
 * boot paths.
 */

/**
 * Kitty flags: opentui's defaults only (disambiguate + alternate keys). NOT
 * `allKeysAsEscapes`: it makes terminals send IME commits as `CSI 0 u`, which
 * crashes iTerm2 3.5.x (typing Chinese quit the app). Cost: the ctrl-hold
 * shortcut guide (bare modifier press/release) never shows, as on
 * Terminal.app and tmux.
 */
const KITTY_KEYBOARD = {} as const

/** Terminal snapshots and host rendering share a 60fps cadence. */
export function hostTargetFps(): number {
  return 60
}

/**
 * Shared by every host: transparent bg, passthrough external output, no
 * exit-on-Ctrl+C (hosts own quit), alternate screen. `onDestroy` is spread in
 * only when present.
 */
export function hostRenderOptions(onDestroy?: () => void): Record<string, unknown> {
  const base = {
    backgroundColor: "transparent",
    externalOutputMode: "passthrough",
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    useKittyKeyboard: KITTY_KEYBOARD,
    targetFps: hostTargetFps(),
  }
  return onDestroy ? { ...base, onDestroy } : base
}

/**
 * Inline variant for CLI-command hosts (`kobe update list`, onboarding): a
 * `heightRows` footer on the MAIN screen, scrollback visible above, cleared
 * on exit. Subcommands should feel like a prompt, not an app.
 */
export function inlineRenderOptions(heightRows: number, onDestroy?: () => void): Record<string, unknown> {
  const base = {
    backgroundColor: "transparent",
    // split-footer's default capture-stdout replays stray logs above the
    // footer instead of letting them corrupt it.
    exitOnCtrlC: false,
    screenMode: "split-footer",
    footerHeight: heightRows,
    useKittyKeyboard: KITTY_KEYBOARD,
  }
  return onDestroy ? { ...base, onDestroy } : base
}

/**
 * Pages quit via `process.exit()`, which fires "exit" but NOT "beforeExit",
 * opentui's only hook; without this, mouse tracking / kitty stay on and the
 * prompt drowns in `35;57;38M…` until `reset`. `destroy()` is idempotent and
 * synchronous, so it's safe in "exit" and a no-op after a normal destroy.
 */
export function installExitRestoreBackstop(renderer: { destroy(): void }): void {
  process.on("exit", () => renderer.destroy())
}

/** DECSET 2004 — the terminal wraps pasted text in `\x1b[200~ … \x1b[201~`. */
const BRACKETED_PASTE_ON = "\x1b[?2004h"
const BRACKETED_PASTE_OFF = "\x1b[?2004l"

/**
 * Enable BRACKETED PASTE; returns the restore, also registered on "exit".
 * Without it a paste arrives as keystrokes, so each newline is an Enter and
 * the first line of a multi-line paste into an engine tab gets SUBMITTED.
 * With it opentui buffers the paste into one `paste` event (it parses the
 * markers but never enables the mode) and `pty-xterm-base.ts#paste` re-frames
 * it for engines that asked for the mode. A terminal left in the mode breaks
 * the next shell's paste.
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
 * Work a signal-triggered exit must not truncate. A fixed sleep can't know
 * when work is done (too long for an idle host, too short for a slow
 * rebuild), so the exit waits on registered work instead. Synchronous
 * exit-time work (KV flush, paste restore) runs on `process.on("exit")` and
 * needs nothing here. Currently empty; this is the seam.
 */
const exitCriticalWork = new Set<Promise<unknown>>()

/** Returns `work` unchanged, so it wraps in place: `await holdExitFor(rebuild())`. */
export function holdExitFor<T>(work: Promise<T>): Promise<T> {
  exitCriticalWork.add(work)
  const forget = (): void => {
    exitCriticalWork.delete(work)
  }
  work.then(forget, forget)
  return work
}

/** Loops because work registered while waiting still counts (a follow-up must not be cut in half). */
export async function whenExitReady(): Promise<void> {
  while (exitCriticalWork.size > 0) await Promise.allSettled([...exitCriticalWork])
}

/**
 * opentui's SIGHUP/SIGTERM handler only destroys the renderer, never exits,
 * and installing it replaced the default "terminate". A host's event loop
 * stays alive (socket, watcher, timers), so every kill/teardown would leave it
 * running forever with a revoked tty, reparented to launchd. Register AFTER
 * render resolves so opentui's handler (restore + onDestroy) runs first.
 * `ceilingMs` is a logged watchdog for work that never settles.
 */
export function installPaneExitBackstop(opts: { ceilingMs?: number; exit?: (code: number) => void } = {}): void {
  const ceilingMs = opts.ceilingMs ?? 5000
  const exit = opts.exit ?? ((code: number) => process.exit(code))
  let exitScheduled = false
  let exited = false
  /** Ceiling and readiness both fire on a slow hang; exit only once (a double exit is a false signal under test). */
  const exitOnce = (): void => {
    if (exited) return
    exited = true
    exit(0)
  }
  const scheduleExit = () => {
    if (exitScheduled) return
    exitScheduled = true
    const ceiling = setTimeout(() => {
      console.error(
        `[rove] exit backstop: ${exitCriticalWork.size} task(s) still in flight after ${ceilingMs}ms — exiting anyway`,
      )
      exitOnce()
    }, ceilingMs)
    ceiling.unref?.()
    void whenExitReady().then(() => {
      clearTimeout(ceiling)
      exitOnce()
    })
  }
  for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"] as const) {
    process.on(signal, scheduleExit)
  }
}

/**
 * Signal-FREE leak defense: a SIGKILLed parent chain (an OOM kill) delivers
 * nothing, reparents the host to init, and it lives on with a revoked tty
 * feeding the next OOM. The parent is always a shell, so PPID 1 means the
 * terminal is gone. Polled: macOS has no parent-death event for a running
 * child; 5s on a 0-work check is free.
 */
export function installOrphanExitWatchdog(intervalMs = 5000): () => void {
  const timer = setInterval(() => {
    if (process.ppid === 1) process.exit(0)
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
