---
"@sma1lboy/rove": patch
---

Agent skill v44: name a task by its title and branch, not its worktree directory.

The sidebar renders a task's title and, under it, its branch — `worktreePath`
appears nowhere in the UI. Agents reached for the directory name anyway
(`marlin`, `zorilla`), leaving the user with a word they cannot find on screen.
The skill now says which fields the user actually sees, `rove api schema` says
it on `add` and `get-task`, and each `--count` / `--agents` sibling's result row
carries its `title` and `branch` instead of only an id.
