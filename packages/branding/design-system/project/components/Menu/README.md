# Menu

The right-click and dropdown menu: a `surface` panel with items that pair a label with its key.

Static rendition hand-written from `menuClass`, `menuItemClass`, `menuKeyClass` and `MENU_SEP` in `packages/rove-web/src/ui/overlay.ts`.

- Panel: `radius`, `line` hairline, 4px padding, `shadow-popover`, minimum width 200px (160px for a submenu). It opens at the pointer, or at the target for Shift+F10, and scales in from 0.96 over 120ms.
- Item: `fs-body`, 5×10px padding (10px vertical on touch), `radius-xs`. Label and key share a baseline. The highlight is the neutral `hover` wash.
- Key: mono meta in `subtle` (`muted` when highlighted), hidden on touch.
- Danger items are `error` text. Highlighted, they fill `error` with a `paper` label.
- A choice list marks the current pick with an `accent` check in the key's place. A Select opens this same menu under its button.
- Separators run full-bleed to the menu's border. Group by separator, not by heading.
