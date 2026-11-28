/**
 * Kimi Code screen-state manifest — poll-side fallback when hooks aren't
 * installed (hooks win whenever they report). Observed in kimi 0.37.2; the
 * selection footer re-checked on 0.40.1. The approval dialog (rule 1) has NOT
 * been re-captured on 0.40.1 — leave its strings alone until someone drives a
 * real tool call through it.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const KIMI_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // Approval panel: "↵ confirm" beside approve/reject choices.
    { state: "blocked", all: ["↵ confirm"], any: ["approve", "reject", "revise"] },
    // Question panel: 0.40.1 `↑↓ navigate · Esc exit`, 0.37.2 `↑↓ select` +
    // `esc cancel`. Two rules so neither vocabulary half-matches the other's.
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
