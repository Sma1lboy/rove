---
"@sma1lboy/rove": patch
---

Delete the deferred-prompt mechanism and the delivery gate it fed. `rove api send` now pastes and submits, always.

Rove used to read the target composer before delivering a peer/API prompt: layer A held the message when someone had typed into that pty in the last ~10s, layer B rendered the engine's screen and held it when the composer already showed text. A held prompt went into a daemon-owned queue and an Inbox row for a human to release, and was destroyed 24h later if nobody did. Headless — which is most of how `send` is used — nobody did. Messages that the sender's exit code called a success sat in a queue for hours, and a second send to the same tab was refused with `DEFERRED_PROMPT_PENDING` while it sat there.

What is gone: the daemon's `DeferredPromptsStore`, its expiry sweep and the whole `deferredPrompt.*` RPC family; the `deferred-list` / `deferred-release` / `deferred-dismiss` verbs; the `deferred` field and `composerPreview` on `send` / `dispatch` / `fanout` replies; the `COMPOSER_BUSY`, `DEFERRED_PROMPT_PENDING` and `DEFERRED_PROMPT_NOT_FOUND` error codes; the `prompt_deferred` / `prompt_expired` Inbox rows and their release/ignore actions; the `delivery.guard` setting (with its legacy `delivery.composerGate` spelling), `delivery.humanWriteQuietMs`, the `ROVE_DELIVERY_GUARD` env override and the Settings → Dev row that drove them; and the `deferred` routine-run status.

The new contract: a `send` that reaches a live engine tab is written to it. The only refusals left are physical — no such tab, a dead PTY, no engine process in it — and each keeps the error code it already had. Routines deliver the same way; a busy composer no longer diverts a firing into an Inbox queue.

An existing `<home>/.rove/deferred-prompts.json` is left on disk untouched and never read again. Nothing warns about it; delete it by hand if you want the space back. Anything still queued in it at upgrade time will not be delivered — check `rove api deferred-list` before updating if that matters.
