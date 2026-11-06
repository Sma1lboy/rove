# Toast

A one-line notice, stacked bottom right, that clears when clicked.

Static rendition hand-written from `TOASTS` and `toastClass(error)` in `packages/rove-web/src/ui/overlay.ts`.

- `inset` ground, `line` hairline, `radius-sm`, 6×12px padding, sans meta. `ink` text, or `error` text for a failure. Maximum width 420px, wrapping anywhere.
- The stack sits 14px from the right and 34px from the bottom with a 6px gap, at `z-toast`.
- Say what happened in the past tense, using the action's own word ("Deleted"). For an error, say what failed and what happens next.
- It rises in over 180ms and sinks out over 140ms.
