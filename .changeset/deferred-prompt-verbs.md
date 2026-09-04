---
"@sma1lboy/rove": patch
---

A deferred prompt is no longer a dead end for a caller with no screen.

`rove api send` into a busy composer exits 0 with `deferred` in its JSON: the
daemon takes ownership of the text and queues a `prompt_deferred` Inbox episode
for a human to release. With nobody attached there was no verb that could
release it — 47 verbs, none touching deferred prompts — so the message sat until
the 24h sweep dropped it undelivered, while every `send` to that tab refused
with `DEFERRED_PROMPT_PENDING` in the meantime. The skill told agents the
opposite: that a deferred send "already landed — do NOT retry".

Three verbs finish the handoff, over the store the Inbox already reads:

```bash
rove api deferred-list                # what the daemon holds, and until when
rove api deferred-release --id <id>   # deliver it now → { delivered: true }
rove api deferred-dismiss --id <id>   # drop it and free the tab's slot
```

`deferred-release` re-runs the delivery gate instead of bypassing it, so a
composer that is still busy leaves the record held and answers
`delivered: false` with the blocking `reason` — the caller retries the release
rather than re-sending text the daemon already owns. Every deferral now reports
`expiresAt`, on the `send` payload as well as in the list, so the deadline is
visible before it passes. `DEFERRED_PROMPT_PENDING`'s `nextCommandArgs` used to
be a verbatim replay of the send that had just failed — a recovery that could
not recover; it now points at the release.

`docs/API.md` and the agent skill carry the verbs and the corrected paragraph.
