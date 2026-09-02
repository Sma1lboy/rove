---
"@sma1lboy/rove": patch
---

Deliver follow-up prompts over Codex's empty composer placeholder without submitting an identical user draft, and stop a second deferred prompt from replacing the first.

Codex draws `Ask Codex to do anything` in a dim style after the prompt glyph when its composer is empty. Rove now requires both the exact text and the placeholder style. A user who types the same words keeps their draft, and changed upstream copy fails closed.

The deferred-prompt store keeps the first accepted message for a tab until a human releases or dismisses it. A later send fails with `DEFERRED_PROMPT_PENDING` instead of dropping the older text while reporting success. New clients also fail safely against an older replace-on-file daemon, and a retry rebuilds an Inbox pointer if the daemon stopped between the two durable writes.
