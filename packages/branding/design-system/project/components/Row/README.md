# Row

The list row used by rail tasks, tab rows, files, dialog choices and inbox cards. It is a full-width button: one line, title truncating, chips at the right edge.

Static rendition hand-written from `rowClass()` in `packages/rove-web/src/ui/row.ts` and the rail recipes in `ui/rail.ts`.

- Size: 26px minimum height (40px on touch), 3×8px padding, 8px gap, `radius-sm`. Sizes `file` (24px, mono meta) and `pane` (22px) exist for denser lists.
- States: rest has no ground, hover gets the `hover` wash, selected sits on `menu` (one step past `inset`, so it never matches a hover), and moving (move mode or mid-drag) gets `accent-soft`. A press scales to 0.97.
- Title (`ROW_TITLE`): `min-width: 0`, flex 1, ellipsis. A rail task title is `fs-title` (14px). A cut-off title shows in full as a row tip beside it.
- Status glyphs appear only on tab rows (a `1ch` mono glyph column, indented 6px). Task rows start flush with their project head.
- Project heads are mono 12px, 600 weight, in `subtle`, with no divider rule. A `+` appears on hover.
- A drag shows the rows already in the order the drop would leave them, never an insertion line.
