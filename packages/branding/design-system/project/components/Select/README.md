# Select

A one-of-N choice in a drop-down: a button showing the current pick, which opens a Menu under it.

Static rendition hand-written from `packages/rove-web/src/ui/select.tsx`.

- Button: `radius-sm`, `line` hairline, on `inset`, the same ground and height as a segmented control, so a row of settings reads as one family of controls whichever kind each is. A typed field stays on `paper`; a pick does not. Sans meta in `ink`, 6px vertical padding (29px tall, as a segmented control), 10px left and 28px right for the chevron in `subtle`. It is as wide as its label, not as its longest option. Hover, focus and open all take `line-active`; there is no accent ring.
- List: the Menu, drawn by the app. Never the browser's native list, which ignores the theme. It sits 4px under the button, at least as wide as it, right edges together, so a long option grows leftward from a right-aligned control.
- The current pick carries the `accent` check and opens highlighted with the `hover` wash. No other row is ever accent-filled.
- Keys: Enter, Space, ↓ or ↑ opens; ↑ ↓ (or k j) move; Enter picks; Esc closes the list only, not the dialog under it. Focus returns to the button.
- Use it when the options are more than four or too long to sit joined. Up to four short options are a segmented control instead, which shows every option without a click.
