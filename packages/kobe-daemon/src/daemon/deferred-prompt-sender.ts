/**
 * Who sent a deferred prompt, read out of the prompt's own provenance header.
 *
 * `rove api send` from inside another task stamps
 * `[ROVE PEER] from "<task title>" (task <id> — …)` on the front of the text
 * (`cli/api/dispatcher.ts`). That header is the only place the sender's
 * identity travels, and the Inbox row a human meets never sees the prompt
 * body — the deferred episode carries a record id, deliberately. So the
 * label is lifted ONCE, when the record is filed, and stored beside it.
 *
 * A prompt with no header yields `undefined`, and the card falls back to
 * naming nothing rather than a guess: "from unknown" reads as a fact.
 */

/** `[ROVE PEER] from "X"` → `X`. `[KOBE PEER]` is the pre-rename spelling. */
const PEER_HEADER = /^\[(?:ROVE|KOBE) PEER\]\s+from\s+"([^"]{1,200})"/

export function deferredPromptSender(prompt: string): string | undefined {
  const label = PEER_HEADER.exec(prompt)?.[1]?.trim()
  return label ? label : undefined
}
