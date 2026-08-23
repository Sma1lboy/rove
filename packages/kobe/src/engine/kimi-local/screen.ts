/**
 * Kimi Code screen-state manifest — the poll-side fallback for kimi
 * sessions whose hooks aren't installed yet (hooks are the first
 * authority; the hook-wins merge supersedes this whenever they report).
 * Patterns observed in kimi 0.37.2's TUI (cross-checked against
 * refs/herdr src/detect/manifests/kimi.toml).
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const KIMI_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // Approval panel: "↵ confirm" beside approve/reject choices.
    { state: "blocked", all: ["↵ confirm"], any: ["approve", "reject", "revise"] },
    // Question panel.
    { state: "blocked", all: ["↑↓ select", "esc cancel"] },
    // Running turn: the moon-phase spinner frames, or a braille spinner
    // beside a progress verb.
    {
      state: "working",
      lineRegex: ["^\\s*(🌕|🌖|🌗|🌘|🌑|🌒|🌓|🌔)", "^\\s*[\\u2800-\\u28FF]+\\s*(thinking|working|using )"],
    },
  ],
}
