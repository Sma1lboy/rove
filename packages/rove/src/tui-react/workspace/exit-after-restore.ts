import type { CliRenderer } from "@opentui/core"

/** Long enough for a healthy restore, short enough that a stuck one still quits. */
const RESTORE_TIMEOUT_MS = 2000

/**
 * Quit only after the terminal is restored. `destroy()` schedules the restore
 * and returns; exiting before `closed` settles leaves the alt screen up, with
 * the shell prompt painted over the dead UI.
 */
export async function exitAfterRestore(
  renderer: Pick<CliRenderer, "destroy" | "closed">,
  exit: () => void,
): Promise<void> {
  try {
    renderer.destroy()
    await Promise.race([renderer.closed, new Promise((resolve) => setTimeout(resolve, RESTORE_TIMEOUT_MS))])
  } catch (err) {
    // silent-catch-ok: exiting next; no screen for a toast.
    console.error("Rove: terminal restore failed during quit:", err)
  }
  exit()
}
