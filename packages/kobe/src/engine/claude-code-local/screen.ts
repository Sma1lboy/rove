/**
 * Claude Code screen-state manifest.
 *
 * Claude reports turn state through hooks and its OSC title, so this manifest
 * only covers the delivery gate's composer-empty detection (issue #78).
 *
 * The composer is NOT the last thing on screen. Claude draws it inside a box
 * and hangs its own status furniture below:
 *
 *   ─────────────────────────────────   <- rule
 *   ❯                                   <- the composer
 *   ─────────────────────────────────   <- rule
 *     𖠰 musk | ⎇ branch | Ctx…          <- status row
 *     ⏵⏵ bypass permissions on …        <- hint row
 *
 * so the prompt sits FOUR non-empty lines from the bottom. `bottomLines` has
 * to clear that furniture; a window that stops short reports every composer
 * as non-empty, because "no rule matched" is deliberately fail-closed.
 *
 * The older one-line form (`❯ · ← 8 agents`) still matches — the regex allows
 * the trailing decoration, and the wider window is a superset of the narrow
 * one.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const CLAUDE_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [],
  composerEmpty: [
    {
      bottomLines: 6,
      all: ["❯"],
      lineRegex: ["^\\s*❯\\s*(?:[·•]\\s*(?:←[^\\n]*)?)?$"],
    },
  ],
}
