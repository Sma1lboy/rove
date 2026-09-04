---
"@sma1lboy/rove": patch
---

Review notes stop overstating themselves, and a diff that cannot take a keypress stops advertising keys. A file's footer counted every note in the task while the glow only painted the notes on that file, so opening a file with no notes read `1 notes · 1 unsent` for a note that lived somewhere else — it now says `0 here · 1 in task` when they differ, and never renders `1 notes`. Sending a batch marks any note whose path the branch no longer has, instead of naming a file the agent cannot open. And while the diff pane is unfocused — opening a diff deliberately does not steal focus — the footer offers `ctrl+q to focus` rather than listing chords that are inert until it has it.

`shift+<letter>` chords were also reported dead. **No binding is added, moved, or removed here** — the keymap is untouched. The visual harness was dropping the Shift modifier on its way through xterm, so every existing such chord measured as its unshifted twin and looked broken; `visual:shot` now presses the uppercase letter, which is the byte a real terminal sends. That is a change to the measuring tool, not to any shortcut.
