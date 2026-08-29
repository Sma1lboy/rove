---
"@sma1lboy/rove": patch
---

test(render): eliminate timing flake in new-chat-flow fork+continue cases

Replace the fixed `settle()` window after submitting the new-chat dialog
with a `waitFor` poll that waits for the async handoff/refusal plan to
resolve and the next dialog to render. The flake was test-side timing,
not a product race in reading the transcript file.
