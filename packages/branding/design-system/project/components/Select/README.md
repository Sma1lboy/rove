# Select

A one-of-N choice in a drop-down: a field-like button showing the current pick, which opens a Menu under it.

Static rendition hand-written from `packages/rove-web/src/ui/select.tsx`.

- Button: the field's frame (`radius-sm`, `line` hairline, `paper`), sans meta in `ink`, 5px vertical padding, 10px left and 28px right for the chevron in `subtle`. It is as wide as its label, not as its longest option. Hover, focus and open all take `line-active`; there is no accent ring.
- List: the Menu, drawn by the app. Never the browser's native list, which ignores the theme. It sits 4px under the button, at least as wide as it, right edges together, so a long option grows leftward from a right-aligned control.
- The current pick carries the `accent` check and opens highlighted with the `hover` wash. No other row is ever accent-filled.
- Keys: Enter, Space, ↓ or ↑ opens; ↑ ↓ (or k j) move; Enter picks; Esc closes the list only, not the dialog under it. Focus returns to the button.
- Use it when the options are more than four or too long to sit joined. Up to four short options are a segmented control instead, which shows every option without a click.
