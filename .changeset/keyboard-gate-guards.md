---
"@sma1lboy/rove": patch
---

Fix four keyboard gates that let a key look live while doing nothing.

Typing into the sidebar search box no longer triggers the `s`, `x`, `u` and `q` chords — a query containing any of those letters used to dispatch Settings, Worktrees or the Update page instead of reaching the box, because the search reader only sees keystrokes the keymap left unclaimed.

The four `diff.review.*` rows in the keybindings table are now rejected as non-rebindable. They are raw bindings that no keymap handler reads, so an override used to apply cleanly, update the help panel, and change nothing.

The Inbox footer dims its `d clear` hint on RECENT rows, which have nothing to drop.

`h` and `l` now fold untracked directories on the Files Changes tab. Both were dead there — `l` was rejected before it reached the row and `h` was gated off the tab entirely — leaving those rows expandable only by mouse or `enter`.
