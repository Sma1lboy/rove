/**
 * Codex CLI screen-state manifest.
 *
 * Codex reports turn state through hooks and its OSC title, so this manifest
 * only covers the delivery gate's composer-empty detection.
 * Codex 0.152 renders an empty composer as either a bare `›` or the prompt
 * followed by a dim `Ask Codex to do anything` placeholder. Requiring the dim
 * attribute keeps an identical user draft from being submitted by Rove.
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
    {
      bottomLines: 2,
      all: ["›"],
      lineRegex: ["^\\s*›\\s+Ask Codex to do anything\\s*$"],
      dimmed: ["Ask Codex to do anything"],
    },
  ],
}
