/** The slice of OpenTUI's renderer a quit needs. */
type RestorableRenderer = {
  destroy(): void
  /** Settles once the terminal is restored (alt screen left, mouse tracking off). */
  readonly closed: Promise<void>
}

/** Long enough for a healthy restore, short enough that a stuck one still quits. */
const RESTORE_TIMEOUT_MS = 2000

/**
 * Quit only after the terminal is restored. `destroy()` schedules the restore
 * and returns; exiting before `closed` settles leaves the alt screen up, with
 * the shell prompt painted over the dead UI.
 */
export async function exitAfterRestore(
  renderer: RestorableRenderer | null | undefined,
  exit: () => void,
  timeoutMs = RESTORE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (renderer) {
      renderer.destroy()
      await Promise.race([
        renderer.closed,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        }),
      ])
    }
  } catch (err) {
    // silent-catch-ok: exiting next; no screen for a toast.
    console.error("Rove: terminal restore failed during quit:", err)
  } finally {
    clearTimeout(timer)
  }
  exit()
}
