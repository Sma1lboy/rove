---
"@sma1lboy/rove": patch
---

Generic engines now upgrade their protocol from the live session (issue #31,
tier b).

A task whose `--command` Rove could not name records the generic protocol: it
launches fine, but history stays unread, no trust dialog is pre-answered, and
delivery falls back to settle-then-paste. The tier-(b) sniffer landed with
issue #30 but nothing consumed it — now the daemon's activity observer relays
each walked live session's evidence (foreground-walk vendor + OSC title) to a
new upgrade hook: when a generic task's `tab-1` — the engine tab launched
from the task's own command — identifies exactly one built-in engine, the
record's protocol is corrected via `setCommand`, metadata only, so the
history reader, trust store, and delivery mode start applying while what
launches never changes. Conservative by design: a record that already names a
protocol is never flipped, a command tier (a) can resolve wins over runtime
evidence, an engine hand-started in a secondary tab is not evidence, and
ambiguous or absent fingerprints leave the task generic — a wrong upgrade
would point Rove at another vendor's files, which is worse than staying
degraded. The sniff never blocks session startup (it rides the observer's
existing poll) and writes nothing into the user's session.
