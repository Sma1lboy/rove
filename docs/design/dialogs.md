# Dialog grammar

One card, one look. `ui/dialog.tsx` owns the card (size, placement, dimmer,
the `esc` barrier); [`ui/dialog-parts.tsx`](../../packages/kobe/src/tui-react/ui/dialog-parts.tsx)
owns what goes inside it. Compose the parts — do not re-draw them.

Until this page existed there were two looks sharing that card: a **form
sheet** (New task, New routine, the pickers — lowercase labels, bare inputs,
`[ create ]` bottom-right) and a **story editor** (the kanban drawer — caps
labels, rounded field wells, chip buttons, a key legend). Which look a dialog
got depended on which one its author had open at the time.

The story editor won, on one argument: it is the only one that marks where
focus is without colour. A bare `<input>` under a lowercase label is
indistinguishable from the label above it — the well's border is what says
"this is a field", and its colour is what says "this is the field you are
typing into".

## The parts

| Piece | Rule |
| --- | --- |
| `DialogHeader` | Title bold on the left, muted `esc` on the right, clickable. `children` replaces the title for a header that carries more (the story drawer's `#id · status · created`). |
| `DialogLabel` | BOLD, muted → primary + underlined when its field holds focus. English labels are CAPS; other languages keep their natural case (Chinese has none). An optional muted `hint` trails it — the arrows a selector answers to (`←/→`), or what the field accepts. |
| `DialogField` | The well an input sits in: rounded border (`FRAME`), `borderSubtle` → `primary` on focus, `backgroundElement` fill (transparent when the theme is). |
| `DialogSection` | `DialogLabel` + its content at `gap={0}`, so label and field read as one thing. |
| `ChipButton` | The one button shape for choose-one: rounded, no fill, `primary` + bold when selected. No fill on purpose — border cells share the parent's background, so a fill halos *around* the border line. |
| `DialogFooter` | One muted line naming the keys this dialog answers to. Every dialog carries one. |
| `DialogActions` | Bottom-right `[ Action ]`, `▸ `-caret + primary when focused. |

Colours come from `theme.*` only. No literals, and no new token unless the
palette is genuinely missing one — this change added none.

## Two rules worth stating

**A `[ action ]` button only where a confirm field exists.** New task and New
routine have a `confirm` stop that Tab reaches, so they get a button. The
story drawer commits with Enter from any selector field — it has no such stop,
and a button nothing can focus would be a fourth thing to explain. It states
the verb in its legend instead.

**Tabs are not fields.** The new-task dialog's Existing / New Repo / Adopt
strip navigates between three bodies. It stays a `▸ `-marked tab strip rather
than becoming a chip row, because chips are how this grammar says "pick one
value for this field".

## The frames give way before the button does

A well and a chip each cost two rows their content does not need, and the card
is capped at the viewport with nothing to scroll it. The new-task dialog's
Clone tab carries four fields plus a picker; on a 24-row terminal the borders
pushed `[ Create ]` and `submitError` off the bottom, which is the exact
silent failure `test/render/new-task-short-terminal.test.tsx` exists to catch.

So below `FRAMED_DIALOG_MIN_ROWS` (34) every well and chip drops its border and
renders the same fields unframed, chips falling back to a `▸ ` marker. Same
fields, same order, same keys — two fewer rows apiece. The border is what a
short terminal loses; the button is not.

## What is converted

Converted: the story drawer, New task (all three tabs), New routine, the
set-status picker and the shared rename prompt — which is a single field, so
its label reaches it from ~10 call sites; those literals moved to CAPS with it
(`use-section-data.ts` is the exception: its label is a settings KEY, an
identifier rather than a name).

Left for a follow-up: `engine-picker-dialog`, `branch-picker-dialog`,
`new-chat-dialog`, `run-again-dialog`, `field-notes-dialog` and
`settings-dialog/`. Each is one list or one row of choices behind the same
header + footer shape, so nothing about them reads foreign yet; convert one
when it grows a second field.
