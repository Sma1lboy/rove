# ChipPicker

A wrapped row of pickable chips, for choosing one short value from a few (an engine, a scope).

Static rendition hand-written from `CHIPS_ROW` and `chipClass(active, dim)` in `packages/rove-web/src/ui/form.ts`.

- Each chip has a `line` hairline, `radius-sm`, 4×10px padding and mono `fs-meta` text in `muted`, with a `hover` wash.
- `active` (the picked one): `accent` border, `accent-soft` wash, `ink` text.
- `dim`: a suggestion the user hasn't confirmed, in `subtle`.
- More than about six options, or long labels, belong in a menu instead.
