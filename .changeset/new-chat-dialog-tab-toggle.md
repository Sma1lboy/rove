---
"@sma1lboy/rove": patch
---

Fix new-conversation dialog tab toggle closing the dialog

`tab` and `ctrl+f` inside the New conversation dialog (ctrl+e) now toggle
destination and context without dismissing the card. OpenTUI keypress events are
not React events, so state updates scheduled from the keymap listener were
batched and committed after the renderer had already painted, dropping the
updated dialog subtree. The dispatcher now wraps matched commands with
`flushSync` so React commits the new state before OpenTUI paints.
