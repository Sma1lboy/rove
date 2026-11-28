/** Long enough for a healthy restore, short enough that a stuck one still lets us leave. */
const RESTORE_TIMEOUT_MS = 2000

export type RestorableRenderer = { destroy(): void; readonly closed?: Promise<unknown> }

/**
 * Destroy the renderer and resolve once the terminal is restored (capped; never
 * rejects). `destroy()` only schedules the restore, so exiting, exec'ing or
 * handing the terminal to a blocking child before `closed` settles leaves the
 * alt screen and mouse tracking up.
 */
export async function restoreTerminal(renderer: RestorableRenderer | null | undefined): Promise<void> {
  if (!renderer) return
  try {
    renderer.destroy()
    if (!renderer.closed) return
    await Promise.race([renderer.closed, new Promise((resolve) => setTimeout(resolve, RESTORE_TIMEOUT_MS))])
  } catch (err) {
    // silent-catch-ok: the caller is leaving the TUI; no screen for a toast.
    console.error("Rove: terminal restore failed:", err)
  }
}
