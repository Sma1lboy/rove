# Button

The one action control: a filled terracotta button for the primary action, an accent text link for everything else.

Static rendition hand-written from `packages/rove-web/src/ui/button.tsx`.

## Variants

- `filled` (`buttonClass()`): `accent` fill, `paper` label, `radius-sm`, meta size, 600 weight, 6×14px padding. Use at most one per view, for the thing the view is for ("Create task", "Start").
- `danger`: the same button in `error`, for a confirmed destructive step ("Delete").
- `box`: the Engines page's smaller one (5×12px, 500 weight).
- `link` (default): `accent` text that underlines on hover. Use for secondary actions ("Create PR", toggle scope) and trailing actions in a row.
- `action`: a quiet bordered action beside a setting ("Disconnect", "Check again"). `ink` meta text on `inset` with a `line` hairline, 29px tall: the ground and height of a Select and a segmented control, so the controls in a settings page are one family. Hover deepens to `menu`. In a settings page, an action is this, not a `link`.
- `floating`: an action raised over content (a preview's "ask in chat" beside a selection). Mono, `surface` ground, `line-active` hairline, `shadow-popover`. The caller places it.
- `row` / `card`: a whole list row or a pickable tile. The caller paints them.

## Rules

- A press scales to 0.97 (off under reduced motion). Disabled is 50% opacity and should say why in a title.
- `hit`: on touch, `link` grows an invisible target (`roomy` 12px above and below and 6px each side, or `tight` in a wrapped row of links).
- Don't override what the variant sets (position, colour, padding). There is no class merging, so stylesheet order would decide.
- Label: verb first, sentence case.
