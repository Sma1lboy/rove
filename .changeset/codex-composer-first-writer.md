---
"@sma1lboy/rove": patch
---

Deliver follow-up prompts over Codex's empty composer placeholder, and stop a second deferred prompt from replacing the first.

Codex now draws `Ask Codex to do anything` after the prompt glyph when its composer is empty. Rove treated that placeholder as user text, so every follow-up after the first turn was held in the Inbox. The Codex screen manifest now accepts that exact empty state while still blocking real text.

The deferred-prompt store now keeps the first accepted message for a tab until a human releases or dismisses it. A later send fails with `DEFERRED_PROMPT_PENDING` instead of dropping the older text while reporting success.
