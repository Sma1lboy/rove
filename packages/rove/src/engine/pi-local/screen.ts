/**
 * pi-family screen-state manifests: the poll-side fallback when the Rove hook
 * isn't installed (a hook report always wins the merge).
 *
 * Strings captured from real sessions replayed through `@xterm/headless`;
 * escape-stripping alone cannot reconstruct a repainting full-screen TUI:
 *
 *   omp 18.1.17 — an approval prompt draws
 *     `╭─ Allow tool: bash ─…`, `Approve` / `Deny`, while the status line
 *     reads `⠋ 28s · <model> · <cwd>`; at rest that same line is
 *     `· <model> · <cwd>` with no spinner or elapsed seconds.
 *   pi 0.80.6 — a running turn prints `⠴ Working...`; the trust dialog
 *     prints `Trust project folder?` over `↑↓ navigate  enter select
 *     escape/ctrl+c cancel`; at rest the footer is the cwd line followed by
 *     the token line (`↑8.8k ↓40 …`).
 *
 * Narrow on purpose: a wrong "blocked" badge sends the user to a working
 * pane, so only dialog chrome that can't appear in ordinary output matches.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const OMP_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["allow tool"], any: ["approve", "deny"] },
    // Anchored so a braille glyph inside transcript output cannot trigger it.
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]{1,2}\\s+\\d+s\\s+·"] },
    // Last, so the working rule wins while a turn runs.
    { state: "idle", lineRegex: ["^\\s*·\\s+\\S+.*·"] },
  ],
}

export const PI_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // Trust gate; `piTrustWorktree` pre-answers it for Rove worktrees.
    { state: "blocked", all: ["trust project folder?"] },
    // Any other modal: pi's dialog footer, never in ordinary turn output.
    { state: "blocked", all: ["↑↓ navigate", "escape/ctrl+c cancel"] },
    { state: "working", any: ["working..."] },
    // Resting footer's token line, drawn only when nothing is running.
    { state: "idle", lineRegex: ["^\\s*[↑↓]\\s*\\d"] },
  ],
}
