# StatusGlyph

The shared status vocabulary: one glyph and one tone per daemon row status, drawn the same way by the TUI sidebar, its tab strip and the web rail.

Static rendition hand-written from `packages/rove/src/tui/lib/glyphs.ts` and `packages/rove/src/lib/row-status-glyph.ts`. The web orb is `ui/status-dots.tsx`. Its frames here are illustrative, because the real ones come from `dot-levels.ts` on an 80ms clock.

- The consumer supplies the daemon's `RowStatus`. Never derive a status, count or label in a client.
- Tones: `accent` means running, busy or unseen. `warning` means needs input or rate limited. `error` means an error, a dead engine or a failed delete. Idle is `subtle` (the orb uses `muted`).
- Glyph sets: `braille` (default, one cell wide), `starburst` (`✻ ✧ ✦ ❢`, opt-in) and `ascii` (7-bit). Spinner frames never reuse a settled glyph.
- Other marks: `✓`/`✗` checks, `◷` rate limited, `†` dead, `↻` routine failed, `◇N` running subagents, `≠` conflict, `☁` another machine.
- Glyphs sit in a `1ch` mono column, so every row's glyph shares one centre.
