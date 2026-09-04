---
"@sma1lboy/rove": patch
---

Fan out a round of attempts without leaving the TUI. The fork composer
(`ctrl+a` `f`) grows an ATTEMPTS row: pick 2-5 and the same prompt starts that
many siblings of one round, sharing one round id, so `rove api collect --group
<id>` reports them together — something no TUI-created task could do before,
because `groupId` had no reach in the TUI at all. Rove's headline gesture,
"many attempts at one prompt", existed only as a shell command until now.

A round does not move you: the siblings appear in the sidebar and start working
while focus stays on the task you fired from, the way `rove api add` is
focus-preserving unless you pass `--activate`. A single attempt is unchanged —
it still carries you into the child, because that one is "carry on from here".
The chip stops at 5 where the CLI allows 10; Orchestration calls 3-4 the sweet
spot, and past five the shell command is the better tool. Siblings that fail to
start are named in one toast and are never deleted — their engines are already
running.
