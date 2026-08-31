---
"@sma1lboy/rove": patch
---

Say so when the daemon and this binary are different builds

Rove ships several times a day and the daemon is a long-lived process that
outlives an `npm i -g`, so "new binary, old daemon" is the ordinary result of
updating — and until now the only state with no way to find out. Three places
knew and none of them said:

`daemonStaleSignal()` has been accurate since it was written and its only
reader was the mock workbench, so the amber "DAEMON OUT OF DATE" banner never
mounted in the product. The workspace now shows it, and hides it behind the
red disconnect banner when the socket is down — with no daemon answering there
is nothing to be out of date with.

A verb whose daemon RPC does not exist came back as a bare `RPC_ERROR`, the
same code an ordinary handler failure uses. `rove api schema --verb archive`
would print a full spec and exit 0, then the verb itself failed 200ms later
with nothing naming the cause. That rejection is now `DAEMON_VERSION_SKEW`,
carrying `rove daemon restart` as its recovery — in both directions, whether
the daemon predates the verb or dropped it.

`deferredPrompt.file`'s documented degrade — an older daemon rejects the verb,
so the send surfaces `COMPOSER_BUSY` and the caller retries — had no test.
Deleting that catch compiled clean and turned a blocked prompt into a reported
success held by no queue; it is now covered.
