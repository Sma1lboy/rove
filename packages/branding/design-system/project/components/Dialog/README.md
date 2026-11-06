# Dialog

A modal on a `scrim`: title row, body, then trailing actions.

Static rendition hand-written from `OVERLAY`, `dialogClass`, `DIALOG_*` and `ACTIONS` in `packages/rove-web/src/ui/overlay.ts` and `ui/text.ts`.

- Panel: `surface`, `line` hairline, `radius`, `shadow-dialog`, 18×20px padding, 12px between blocks. It is 440px wide, or 620px (`wide`) for a two-column form, and sits 12vh from the top.
- Title: sans `fs-title` (14px), 600 weight, `ink`, sentence case. It often quotes the user's own words and is never an uppercase kicker.
- Close: a 24px `×` in `muted`. Esc closes too. Focus is trapped inside and returns to where the dialog was opened from.
- Actions sit right-aligned with a 14px gap: the link actions first, the filled action last. They stay sticky while the body scrolls.
- An aside inside the body (a delete warning, a brief) is an `INSET_BOX` on `paper`, never a nested card.
- It rises 4px in over 180ms and sinks out over 140ms.
