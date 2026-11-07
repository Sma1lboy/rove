# Chip

A short status or count beside a row's title: mono, meta size, in one tone. It has no fill and no border.

Static rendition hand-written from `packages/rove-web/src/ui/chip.tsx` and `ui/tone.ts`.

- The consumer supplies the text and an optional `tone`: `accent`, `muted` (painted `subtle`), `attention` (`error`), `warning`, `info`, `success`, `added` or `removed`.
- A chip leads with its glyph whenever the tone carries a state (`✓`, `✗`, `◷`), because colour is never the only signal.
- A row's chips sit at its right edge with a 6px gap: pin and PR first, then the job spinner, then the cloud mark.
- No change counts on rail rows (the owner's call). `+N -N` belongs in diffs and the Files panel.
