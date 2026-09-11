---
"@sma1lboy/rove": patch
---

Typing in a Rove terminal no longer lags a frame behind the same shell outside Rove. Output from a PTY is coalesced so a streaming pane builds at most one snapshot per rendered frame — but the throttle was trailing-only, so it also charged that full frame to output arriving at an idle terminal, which is every keystroke you type at a prompt. The child echoed in a fraction of a millisecond and the pane then had nothing to draw for another 33ms. The window now fires on its leading edge: output arriving after a quiet frame is drawn at once, and only a second chunk inside the same window waits for the boundary. Measured end to end on macOS — `write()` to published snapshot, 60 samples at 120x40 — p50 drops from 35.8ms to 1.5ms against a raw PTY echo of 0.03ms. Bursts are unchanged: still one snapshot per frame, none of it discarded work.
