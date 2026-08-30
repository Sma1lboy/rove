---
"@sma1lboy/rove": patch
---

Show when the daemon has disconnected instead of rendering the last snapshot as live.

The client already knew: `connectionStateSignal` flips to `disconnected` the moment the socket closes, and it had no production readers — only tests. Every page swallowed its own failed read and kept painting the last good state, so a dead daemon rendered as a healthy routine list counting down to a run that would never fire, and the Routines page asserted "keeping the daemon awake" in green about a process that was gone. A red banner now sits above every workspace surface while the socket is down, and the Routines header reads "daemon unreachable" instead of the stale hold state.

The update page had the same shape from a different cause: a failed registry fetch fell back to the current version and painted it green, so "could not reach npm" and "you are up to date" were the same pixels. It now says the check failed.
