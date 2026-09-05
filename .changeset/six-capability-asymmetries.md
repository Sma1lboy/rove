---
"@sma1lboy/rove": patch
---

Close six places where an object's action existed on one side and not the other

Each of these is the same shape: something you could do to a card, a note, a
tab, a worktree or a round from one surface, and not from the other.

- **Kanban cards can be moved between columns from the TUI.** The story detail
  drawer's field cycle (`enter` on a card, then `tab`) now includes a STATUS
  chip row — `←/→` steps `open · doing · hold · done`. The board's own keys
  steer the cursor and `d` deletes, so before this "I finished this" and "this
  never existed" were the same keypress unless an agent ran
  `issue-set-status`. A done story can be sent back the same way.
- **`rove api issue-delete --repo PATH --id N`** deletes a story, the store op
  the board's `d` already ran. An agent clearing stale issues previously had to
  mark them `done` and leave them, or ask a human to press `d`.
- **`rove api delete --group GROUPID`** closes a whole fan-out round in one
  call, selecting by the `groupId` `add --count` returns. Creating and reading
  were batched (`add --count`, `collect --group`); only deleting was one call
  per loser. A sibling's refusal (a dirty worktree) is reported in `results`
  rather than aborting the rest.
- **Field notes can be retired.** `rove api note-delete --repo PATH --id N`,
  and `d` in the Field notes dialog. The store's newest entries are injected
  into every new session on the repo, so a note whose fact stopped being true
  was still being handed to agents as fact, with hand-editing the daemon's
  JSON as the only correction. Notes now carry a stable id; stores written
  before the field get one backfilled on read.
- **`rove api remove-worktree --task-id ID [--force]`** removes a worktree
  directory and keeps the task and its branch — the inverse of
  `ensure-worktree`, and what the Worktrees page's delete has always done. A
  script reclaiming idle checkouts had only `delete`, which takes the task
  record too. It runs the page's own path (session teardown, dirty refusal,
  salvage snapshot on force) and refuses the project's own checkout and the
  worktree the caller is running from.
- **`rove api rename --task-id ID --tab TAB --title T`** names a Terminal Tab,
  the API twin of `f2`. Tabs could already be opened, closed, read and written
  from the CLI; naming was the gap. An attached TUI repaints its tab strip.

`d` in the Field notes dialog is a proposed binding pending sign-off; the CLI
verb does the same thing if it goes away.
