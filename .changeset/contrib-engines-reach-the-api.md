---
"@sma1lboy/rove": patch
---

`rove api` now reaches the six shipped contrib engines. `engine-list` lists Gemini CLI, OpenCode, Cursor Agent, Grok CLI, Droid and Amp whenever their CLI is on `PATH` — the same set Settings → Engines already offered — and `add --command opencode` / `set-command --command cursor` record that engine's protocol instead of falling through to `generic`, so an agent-dispatched fleet gets the activity badges a hand-picked one already had. Existing tasks already recorded as `generic` keep that value; re-run `set-command` to move one over.
