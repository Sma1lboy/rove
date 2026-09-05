---
"@sma1lboy/rove": patch
---

The delivery guard is now switchable, legible, and forgiving of a mis-hit `d`.

- **Settings → Dev** replaces the composer-gate checkbox with a three-position
  `delivery.guard`: `on` (both checks), `screen off` (drop the engine-layout
  read only), `off` (drop both). The keystroke window was previously not
  switchable at all — it lived in the pty host's spawn-time environment, so
  changing it meant restarting the host. Both checks now resolve per delivery,
  and `ROVE_DELIVERY_GUARD` overrides the setting for one session. An existing
  `delivery.composerGate=false` reads as `screen off`.
- **Inbox cards for a queued message** name the sender, which check held it,
  and how long the text survives — `from kobe · composer had text · expires in
  23h` — instead of `message queued` and a countdown. `d` on one asks first.
- **Dismissing keeps the text.** A dismissed message leaves the queue (its tab
  accepts new sends immediately) but stays on disk until its ordinary 24h
  expiry: `rove api deferred-list --include-dismissed` finds it and
  `deferred-release` still delivers it. Dismiss used to destroy a message the
  sender had already been told was accepted.
- Every deferral, release and dismiss is now a line in `daemon.log`; only drops
  were recorded before.
