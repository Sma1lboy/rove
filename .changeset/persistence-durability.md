---
"@sma1lboy/rove": patch
---

Fix four ways persisted state was silently lost or left exposed.

A `tasks.json` stamped with a version this build doesn't recognize — what you
get after running a newer Rove and going back to an older one — emptied the
task index and let the next save replace the file, with no backup. It now
copies the original bytes aside first, exactly like the corrupt-JSON path
already did. Both recovery warnings also go to `client.log`, since a pane's
stdout is painted over by the alternate screen and nobody ever saw them.

Frozen PTY session files carry a session's whole scrollback, and the
owner-only permissions added for them only ever applied to newly created
paths — an install that had been freezing sessions before that change kept a
world-traversable directory and world-readable records indefinitely. The
pty host now tightens the directory and every existing record at boot.

`pty-sessions/` also had no bound: a task deleted while the pty host was down
left its snapshot behind forever (the sweep only reaches a running host), and
every boot re-read and re-thawed the lot. Records are now pruned at load —
dropped after 14 days, and capped at the 64 most recent.

Finally, `pty.log` is rotated at pty-host boot. It was the one append log that
issue #26 left uncapped, on the longest-lived process in the system.
