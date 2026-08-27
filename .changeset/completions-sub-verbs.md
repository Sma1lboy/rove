---
"@sma1lboy/rove": patch
---

Shell completions now complete sub-verbs, not just the top-level command

`rove daemon <TAB>` used to offer nothing; now it offers `start stop status
restart`, and the same second level exists for `api` (all ~46 verbs), `plugin`,
`repo`, `skill` and `theme` — in bash, zsh and fish alike. fish also stops
re-offering the top-level command list once a command is already typed.

The verb lists are derived rather than transcribed: `api` reads the registry
`rove api schema` enumerates, and the other five read a table their own command
modules validate incoming argv against. A verb the CLI accepts but the
completion omits is therefore not a reachable state — stale completions tell a
user a verb does not exist, which is worse than having no completions at all.
