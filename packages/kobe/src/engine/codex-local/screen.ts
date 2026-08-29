/**
 * Codex CLI screen-state manifest.
 *
 * Codex reports turn state through hooks and its OSC title, so this manifest
 * only covers the delivery gate's composer-empty detection (issue #78). The
 * Codex TUI uses a `›` prompt; an empty composer is the prompt glyph with no
 * user text after it.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const CODEX_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [],
  composerEmpty: [
    {
      bottomLines: 2,
      all: ["›"],
      lineRegex: ["^\\s*›\\s*$"],
    },
  ],
}
