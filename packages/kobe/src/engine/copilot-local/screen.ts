/**
 * Copilot CLI screen-state manifest — hint strings observed in the Copilot
 * CLI's bottom bar (cross-checked against refs/herdr
 * src/detect/manifests/github-copilot.toml). Copilot persists no
 * completion marker and has no wired hooks, so this is its ONLY
 * working/blocked signal; without it every copilot tab reads "unknown".
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const COPILOT_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // A selection dialog (permission prompt, picker) shows a confirm hint
    // NEXT TO the cancel hint — blocked on the user. Declared first so a
    // dialog under a running turn reads blocked, not working.
    {
      state: "blocked",
      any: ["enter to select", "enter to confirm", "enter to submit", "enter accept"],
      all: ["esc"],
    },
    // A running turn shows only the interrupt hint.
    { state: "working", any: ["esc to cancel", "esc cancel", "esc again to cancel", "esc interrupt"] },
  ],
}
