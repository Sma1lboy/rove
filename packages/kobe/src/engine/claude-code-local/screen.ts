/**
 * Claude Code screen-state manifest.
 *
 * Claude reports turn state through hooks and its OSC title, so this manifest
 * only covers the delivery gate's composer-empty detection (issue #78). The
 * empty-composer line observed in production is:
 *
 *   "❯                    · ← 8 agents"
 *
 * i.e. the prompt glyph `❯` plus status decoration, with no user text after
 * the prompt.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const CLAUDE_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [],
  composerEmpty: [
    {
      bottomLines: 2,
      all: ["❯"],
      lineRegex: ["^\\s*❯\\s*(?:[·•]\\s*(?:←[^\\n]*)?)?$"],
    },
  ],
}
