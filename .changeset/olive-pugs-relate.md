---
"@sma1lboy/rove": patch
---

Added IBM Bob as a built-in engine with conversation history, per-session token and context counts, worktree session discovery, and signed-in status from its local store. Rove checks for an opaque token without decoding credentials.

Rove launches `bob chat --trust`, pre-writes workspace trust, and pastes the first message because Bob does not accept a positional prompt. Bob can be selected for parallel rounds with `rove api add --agents bob:3 --prompt "…"`.

The screen manifest recognizes command approval, folder trust, and browser sign-in as blocked, streaming as working, and the resting composer as idle. Bob 2.0.5 does not fire the tested hooks, so Rove discovers sessions through history. Bob conversations do not resume across tab restarts.
