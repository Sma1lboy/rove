/**
 * Selecting never copies. An engine that draws its own selection sends its copy as OSC 52 when the
 * mouse lets go; that text is held for the copy chord. An OSC 52 that follows a key is the engine's
 * own copy command and goes straight to the clipboard.
 */

/** An engine answers a release within a frame or two; a later write is its own doing. */
const RELEASE_COPY_MS = 500

export function createCopyHold(copy: (text: string) => void, now: () => number = () => performance.now()) {
  let held = ""
  let releasedAt = Number.NEGATIVE_INFINITY
  return {
    /** A key was pressed: what the engine copies next was asked for. */
    key(): void {
      releasedAt = Number.NEGATIVE_INFINITY
    },
    /** A new drag starts: the last held text is no longer what is selected. */
    press(): void {
      held = ""
    },
    release(): void {
      releasedAt = now()
    },
    osc52(text: string): void {
      if (now() - releasedAt < RELEASE_COPY_MS) held = text
      else copy(text)
    },
    text: (): string => held,
  }
}
