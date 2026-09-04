---
"@sma1lboy/rove": patch
---

Five reads that reported a failure as a fact.

- **Kanban** kept a project on the board when its story read failed. A rejected
  `issue.list` used to drop the whole project from the tab strip, so a user
  with two repos saw one, with no error, no glyph, and no reason to think the
  other existed. The project now keeps its slot, states the read failure where
  its columns would be, and raises a toast naming the repo.
- **`issue-list`** reports `skipped`, the number of entries on disk it could
  not read (an issue whose `id` is not a number is dropped). A short list is no
  longer indistinguishable from the whole board, and the drop is logged with
  the repo key. A corrupt `nextId` now resumes at `max(id) + 1` instead of `1`,
  which used to hand `create` an id that already existed in the same file.
- **`pty-list`** answers `sessions: null` when there is no PTY host to ask.
  `[]` used to mean both that and "a live host with nothing running", so an
  agent could read a running fleet as idle. `[]` now means only the latter,
  matching what `inspect` has always returned.
- **`add --prompt`** reports `promptPersisted: false` when the brief was
  delivered but the store refused to record it. The task still succeeds, but an
  unpersisted brief silently removes **Run again** from that task's menu.
- **`discover-adoptable`** reports `unreadable`: worktrees whose admin dir
  `git worktree list` omitted without an error or a non-zero exit. An empty
  `worktrees` array no longer hides a worktree that exists on disk, holds
  uncommitted work, and has no path to adoption.
