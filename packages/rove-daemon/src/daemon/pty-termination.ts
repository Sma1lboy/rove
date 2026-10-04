/**
 * Ending a PTY child — the escalation, and the bounded waits around it.
 * Knows nothing of sessions; pure over its arguments so the platform
 * behaviour is testable without spawning.
 */

import type { PtyChild } from "./pty-driver.ts"

/**
 * True if `exited` settled inside `ms`; false on timeout. A rejection counts
 * as settled — an exit is an exit however the runtime reports it.
 *
 * Every wait on a child's exit MUST go through this: node-pty's `exited`
 * resolves only when ConPTY delivers `onExit` (Bun's always settles), so one
 * wedged child would otherwise hang the host's shutdown.
 */
export async function settledWithin(exited: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = await Promise.race([
    exited.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms)
    }),
  ])
  if (timer) clearTimeout(timer)
  return settled
}

/**
 * POSIX process-group signaling for PTY children. A hosted engine spawns its
 * own subtree (shell → engine → helpers); signaling the negative pid reaches
 * the whole group, with a per-process fallback for runtimes that do not make
 * the PTY child a group leader.
 *
 * On Windows (no groups, no signals) the fallback is node-pty's `kill()`,
 * which `TerminateProcess`es the shell alone; the subtree is ended by the
 * driver's `endTree` in {@link terminatePtyChild}, so this only releases the
 * handle there.
 *
 * Every signal Rove sends a PTY subtree goes through here, so `onSignal` is
 * the complete record of Rove's own killing. Node can't expose the killer's
 * pid (`SA_SIGINFO`), so attribution is by elimination: no line here for a
 * dead engine's group means something OUTSIDE Rove sent the signal.
 */
export function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  fallback: () => void,
  platform: NodeJS.Platform = process.platform,
  onSignal?: (line: string) => void,
): void {
  if (platform !== "win32" && pid > 1) {
    try {
      process.kill(-pid, signal)
      onSignal?.(`sent ${signal} to process group -${pid}`)
      return
    } catch {
      // Some runtimes do not make the PTY child its own group leader.
    }
  }
  try {
    fallback()
    onSignal?.(`sent ${signal} to pid ${pid} (per-process fallback)`)
  } catch {
    /* already gone */
  }
}

/** Let a cooperative terminal child shut down before escalating to SIGKILL. */
const TERMINATION_GRACE_MS = 500

/**
 * End one PTY child: SIGTERM its process group, escalate to SIGKILL past a
 * short grace, then fire `onSettled`. BOUNDED (see {@link settledWithin}) so a
 * wedged node-pty child can't hang shutdown and `kobe reset`; a child that
 * outlives SIGKILL is beyond reach, and reporting it dead beats never returning.
 *
 * With a driver `endTree` (node-pty on Windows) the subtree ends FIRST, then
 * `kill()` releases the pseudo console — the reverse closes the console while
 * the tree is still there to walk. Keyed on the driver, not
 * `process.platform`: `taskkill /F` on a test fake's made-up pid would kill
 * whatever real process holds it.
 */
export async function terminatePtyChild(
  proc: PtyChild,
  onSettled: () => void,
  onSignal?: (line: string) => void,
): Promise<void> {
  if (proc.endTree) {
    onSignal?.(await proc.endTree())
    // node-pty throws once the child exited; swallowed by the fallback path.
    signalProcessGroup(proc.pid, "SIGKILL", () => proc.kill("SIGKILL"), process.platform, onSignal)
    await settledWithin(proc.exited, TERMINATION_GRACE_MS)
    onSettled()
    return
  }
  signalProcessGroup(proc.pid, "SIGTERM", () => proc.kill("SIGTERM"), process.platform, onSignal)
  if (!(await settledWithin(proc.exited, TERMINATION_GRACE_MS))) {
    signalProcessGroup(proc.pid, "SIGKILL", () => proc.kill("SIGKILL"), process.platform, onSignal)
    await settledWithin(proc.exited, TERMINATION_GRACE_MS)
  }
  onSettled()
}
