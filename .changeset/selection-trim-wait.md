---
"@sma1lboy/rove": patch
---

Stop the selection-trim test waiting on a value the pipeline is free to skip.

Test-only. The case waited for the published window's `startLine` to equal exactly its starting value plus ten, after writing ten lines. But the backend refreshes at output cadence, so how many lines one refresh folds in depends on how much output piled up first — under a loaded runner that is more than one write, the counter steps straight past the awaited number, and the wait can then only time out.

Unloaded it passes in 50ms, because there every refresh folds exactly one line. That gap is the whole flake: it blocked four unrelated pull requests and one release in a single day while looking perfectly healthy on the machine of anyone who ran it alone.

It now waits for the shift to have landed rather than to be a particular size, which is not a weaker check — the code under test is handed both windows and derives the distance itself, so the assertions hold for any landed shift.
