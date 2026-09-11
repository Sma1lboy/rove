/**
 * pi-family screen-state manifests — the poll-side fallback for sessions
 * whose Rove hook isn't installed (hooks are the first authority; the
 * hook-wins merge supersedes these whenever they report).
 *
 * Every string below was captured from the installed binaries on 2026-09-11
 * by driving a real session through a PTY and replaying the byte stream
 * through xterm (`@xterm/headless`) — escape-stripping alone cannot
 * reconstruct a repainting full-screen TUI, and the first draft of these
 * rules was wrong for exactly that reason. What the captures showed:
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
 * The rules stay narrow on purpose: a wrong "blocked" badge sends the user
 * to a pane that is happily working, so only dialog chrome that cannot
 * appear in ordinary output is matched.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const OMP_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // The native approval prompt. `allow tool` is the box title omp draws for
    // every gated tool call; approve/deny are its two options.
    { state: "blocked", all: ["allow tool"], any: ["approve", "deny"] },
    // A running turn: the status line leads with a spinner frame and the
    // elapsed seconds (`⠦ 10s · …`). Anchored so a braille glyph inside
    // transcript output cannot trigger it.
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]{1,2}\\s+\\d+s\\s+·"] },
    // At rest the status line loses the spinner and the elapsed clock
    // (`· <model> · <cwd>`). Last, so the working rule above wins while a
    // turn runs.
    { state: "idle", lineRegex: ["^\\s*·\\s+\\S+.*·"] },
  ],
}

export const PI_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // The trust gate, which blocks a hosted session outright until answered
    // (see `piTrustWorktree`, which pre-answers it for Rove worktrees).
    { state: "blocked", all: ["trust project folder?"] },
    // Any other modal selector: pi's dialog footer is this exact pair, and no
    // ordinary turn output prints it.
    { state: "blocked", all: ["↑↓ navigate", "escape/ctrl+c cancel"] },
    { state: "working", any: ["working..."] },
    // The resting footer's token line (`↑8.8k ↓40 R8.6k …`), which pi draws
    // only when nothing is running.
    { state: "idle", lineRegex: ["^\\s*[↑↓]\\s*\\d"] },
  ],
}
