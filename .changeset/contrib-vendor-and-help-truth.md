---
"@sma1lboy/rove": patch
---

`--vendor` now takes the shipped contrib engine ids (gemini, opencode, cursor, grok, droid, amp) that `engine-list` has always advertised. `routine-create`, `workitem-start` and `--agents` used to reject them with an error telling you to go read `engine-list` — where they were listed. `rove api schema` shows them too.

`rove skill --help` documents `--global`/`-g` and `-p`, and `rove update --help` documents `--channel <name>`; all four were already parsed and accepted, just undocumented on the surface `docs/CLI.md` calls authoritative.
