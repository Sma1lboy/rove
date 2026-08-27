---
"@sma1lboy/rove": patch
---

The workspace shows a welcome panel when no tasks exist yet.

A first launch used to land on an empty sidebar and a bare "Select a task
with a worktree" line — nothing said what to press or whether the machine was
even ready. With zero tasks the center column now teaches the three
QUICKSTART keys (new task, help, command menu), resolved from the live keymap
so rebinds show their real chords, and is honest about the environment: which
engine CLIs were detected (the same probe the new-task dialog uses), whether
git is on PATH, and `rove doctor` as the escalation when something is
missing. It is a passive empty state, not a wizard — creating the first task
makes it disappear, and users with tasks never see it.
