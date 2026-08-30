---
"@sma1lboy/rove": patch
---

Accept-and-defer busy-composer prompts into the inbox (issue #78 B), completing the delivery gates.

When the A (recent keystroke) or C (composer non-empty) gate blocks a paste, the prompt is no longer dropped or hard-rejected — ownership transfers to the daemon. The text is stored in a new daemon-owned `DeferredPromptsStore` (one record per task+tab, 24h TTL; displacement, expiry, and task-deletion are all written to the daemon log — never silently dropped) and a `prompt_deferred` attention-inbox episode is recorded pointing at the record by id.

- `send` / `add --prompt` return an accepted-but-deferred outcome (`deferred: {id, layer}`) which is a SUCCESS — callers must not retry, or the same message stacks in the queue.
- Exit path: opening the `prompt_deferred` inbox item jumps to the tab and inserts the queued message with a fresh A/C gate (reusing the existing open action, no new chord), then resolves the record + episode; a still-busy composer keeps it queued.
- Toast on deferral plus inbox entry copy, in both locales. The `deferredPrompt.*` verbs are socket-only, off the pinned browser-reachable allowlist.
