/**
 * Kimi Code screen-state manifest — the poll-side fallback for kimi
 * sessions whose hooks aren't installed yet (hooks are the first
 * authority; the hook-wins merge supersedes this whenever they report).
 * Patterns observed in kimi 0.37.2's TUI (cross-checked against
 * refs/herdr src/detect/manifests/kimi.toml), with the selection-dialog
 * footer re-checked against kimi 0.40.1 on 2026-09-04. The approval dialog
 * (rule 1) has NOT been re-captured on 0.40.1 — leave its strings alone
 * until someone drives a real tool call through it.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const KIMI_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // Approval panel: "↵ confirm" beside approve/reject choices.
    { state: "blocked", all: ["↵ confirm"], any: ["approve", "reject", "revise"] },
    // Question panel. 0.40.1 draws `↑↓ navigate · Enter select · Esc exit`;
    // 0.37.2 drew `↑↓ select` + `esc cancel`. Two rules rather than one
    // widened rule, so neither version's vocabulary can half-match the
    // other's and claim a dialog that isn't there.
    { state: "blocked", all: ["↑↓ navigate", "esc exit"] },
    { state: "blocked", all: ["↑↓ select", "esc cancel"] },
    // Running turn: the moon-phase spinner frames, or a braille spinner
    // beside a progress verb.
    {
      state: "working",
      lineRegex: ["^\\s*(🌕|🌖|🌗|🌘|🌑|🌒|🌓|🌔)", "^\\s*[\\u2800-\\u28FF]+\\s*(thinking|working|using )"],
    },
  ],
}
