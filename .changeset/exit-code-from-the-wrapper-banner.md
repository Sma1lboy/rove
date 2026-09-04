---
"@sma1lboy/rove": patch
---

A killed session's exit record no longer reports `code: null` next to a tail that spells the code out.

```json
"exit": { "code": null, "signal": "SIGKILL",
          "tail": ["…", "⚠ Engine exited (code 143). Check Settings → Engines…"] }
```

A signalled session has no wait-status code, so the only exit code that exists
at that point is the one the shell wrapper printed — and the store already had
the parser for it, wired to the engine layer only. `recordPtyExit` now falls
back to it, and the `exit` object in `get-task`/`collect` gains `layer`, so a
caller can tell "the PTY was killed" from "the engine died inside it" instead of
guessing which process `code` and `signal` describe.
