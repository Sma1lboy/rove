# TextField

A labelled single-line field: a kicker over a mono input over a hint, stacked with a 6px gap.

Static rendition hand-written from `INPUT`, `HINT` and `KICKER` in `packages/rove-web/src/ui/text.ts`, and `FIELD` in `ui/form.ts`.

- Input: `paper` ground, `line` hairline, `radius-sm`, mono `fs-meta`, 8×10px padding. Focus moves the border to `line-active`. It draws no outline ring, because a ring would be clipped inside a scrolling dialog body.
- Kicker: sans 12px, 500 weight, in `muted`. Hint: sans 12px in `subtle`.
- Placeholders are lowercase and say what an empty value does.
- A textarea adds `TEXTAREA` (min-height 72px, line-height 1.45, max 50vh). On touch, every field is 16px so iOS doesn't zoom.
