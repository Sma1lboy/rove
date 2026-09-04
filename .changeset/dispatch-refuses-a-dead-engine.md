---
"@sma1lboy/rove": patch
---

A prompt sent to a task whose engine has died is no longer executed as shell
commands. When an engine exits, keepAlive `exec`s a login shell in its place
and the PTY stays alive, so the session keeps matching the launch argv that
resolves a delivery target. `rove api dispatch` into such a tab returned
`delivered: true` — and zsh ran the text: with the engine killed and the
wrapper shell alive, `dispatch --prompt "touch /tmp/PROOF"` created the file.
The guard for this already existed and `send` already applied it; two of the
three delivery adapters did not, and the two without it are the ones the
routine runner and the quota-resume runner use. So a persistent-session
routine whose engine died overnight typed its daily prompt at a shell prompt,
unattended, and recorded the run as `dispatched`. Both now refuse: `dispatch`
returns `delivered: false, reason: "no-engine"` and broadcasts nothing, and a
routine treats it as the revive trigger it always was, recording `revived`.
Delivery into a live engine is unchanged.

`rove api send` also stops killing a fleet to deliver one message. An
unreachable pty host was reaped off a single 3-second probe — taking every
engine hosted on it — and the payload said nothing: measured, four processes
across three sessions became one, and `send` returned a bare `ok: true`. A
host whose PROCESS is alive now gets the same 15s grace the daemon path
already gives one, and a host still holding live sessions after it is refused
out loud instead of reaped. An idle-exited host is still resurrected silently,
which is what that path was for. — [@Sma1lboy](https://github.com/Sma1lboy)
