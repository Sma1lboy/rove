---
"@sma1lboy/rove": patch
---

Ship a full `rove api` flag reference with the agent skill

The skill's "Discover before calling" section told agents not to guess flags
but listed none, so every session paid a `rove api schema` round-trip for the
same handful of verbs. It now inlines the flags for `add`/`send`/`get-task`/
`list`/`collect` and names four flags that get guessed wrong (`add --vendor`,
`read-output --task`, `dispatch --text`, `issue-list --state`).

The new `references/api-flags.md` covers every verb and flag, including the
groups SKILL.md leaves out on purpose — `routine-*`, `workitem-*`, `note`/
`note-list`, `read-output`/`digest`/`agent-turns`/`pty-list` — plus an error
code recovery table and the retired-verb map (`fan-out`, `task-list`,
`send-tab`, `$KOBE_TASK_ID`). The `NO_ENGINE_TAB` docs now mention `pty-list`,
which its own error hint already pointed at.
