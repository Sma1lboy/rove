/** Bob Shell's screen-state manifest — the poll-side reading of its TUI. */

import type { EngineScreenManifest } from "../screen-state.ts"

// Captured from Bob Shell 2.0.4 under a PTY, re-verified unchanged on 2.0.5.
// Three screens wait on a human: the sign-in wall, the folder gate, and the
// COMMAND approval dialog — a file-write approval was not captured, so it is
// covered only if it shares the "Approve Once" option list. The composer's
// mode footer ("Agent Mode · 74.8k / 270.0k (28%) · 0.149") is drawn while
// streaming too, so it can only mean idle once the working rule above it has
// missed.
export const BOB_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // An expired token parks Bob on a browser sign-in spinner. Without this it
    // classifies null, so a task that CANNOT run keeps whatever badge it had.
    { state: "blocked", any: ["complete sign-in in your browser"] },
    { state: "blocked", all: ["do you trust this folder?"], any: ["trust folder", "don't trust"] },
    { state: "blocked", all: ["approve once"], any: ["reject", "always allow"] },
    { state: "working", any: ["enter to steer", "tab to queue"] },
    { state: "idle", lineRegex: ["^\\s*\\w[\\w ]* mode( \u00b7|\\s*$)"] },
  ],
}
