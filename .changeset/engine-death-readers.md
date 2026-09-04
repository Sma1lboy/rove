---
"@sma1lboy/rove": patch
---

Four readers of an engine death now say what the daemon already recorded.

`get-task` and `collect` report `exit.layer: "engine"` — the AI process gone
from a tab whose session is still alive. That row could never carry one: the
join only looked up an exit for a DEAD session, and it looked under the bare
session key while engine records live under `<key>#engine`. An agent polling a
fleet got "no engine, no reason" while `inspect` printed the code and the tail
of the very same death.

`rove daemon restart` no longer forgets a dead engine. The activity registry is
in-memory by contract and the exit watcher baselines everything already on
disk, so a restart brought a killed engine's tab back as `idle` — identical to
a tab that never ran one, and typing into it runs your prompt as shell
commands. The observer's first walk now re-publishes the badge from the durable
record.

An engine that died while the daemon was DOWN is recorded once the daemon
returns. Engine-layer records are written by the daemon's own walk, so that
death used to leave nothing at all — no badge, no Attention Inbox item, no
record. The same first walk writes one when the session's ring still holds the
wrapper's `⚠ Engine exited (code N)` banner, flagged `atApproximate` because
the banner proves the death but carries no clock.

The `dead` badge and Inbox row caption the death with that banner instead of
the shell prompt underneath it. The wrapper `exec`s a login shell after
printing, so "your agent died" was captioned with a fragment of a zsh theme,
broken Nerd Font surrogate pairs and all.
