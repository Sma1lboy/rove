# Android parity with the web phone layout

The web client at 390 wide (`packages/rove-web`, narrow layout below 560 px) is the reference for what `packages/rove-android` should offer. A routine updates this page each run; open `[routine] parity-android:` PRs carry the work in progress.

Last run: run 4, 2026-11-12, `main` at `79b458b67`, web 0.9.291. Run 3 was 2026-11-09 at `2363c73e9`. Since run 3 the web gained engine marks on task rows with a status-mark setting and a one-time notice, a swipe back to the task list, a voice-first New task, a machine chip in New task that can place a task itself, attachments of any type up to 500 MB sent in parts, Restart Rove after Update now, and a new task from a task's branch. Archived tasks left the web's sidebar (#1901); the command palette brings one back.

## How the pages were listed

The web has no page-listing tool. The list comes from `PageId` in `packages/rove-web/src/ui.ts`, the rail, `SECTION_GROUPS` in `settings-sections.ts` and the panel switch on the task page. Pages marked **opened** were opened at 390x844 with Playwright touch emulation against `rove --web` in a throwaway `HOME`. **Read only** means the row comes from source because the fixture could not reach the page. The column keeps the last run that opened a page; run 4 opened the task list, the Inbox with a reply sent, Settings › Appearance and Settings › Engines.

Android frames come from the allen emulator `rove_test` sized with `wm size 1024x2216` (390x844 dp), paired through `10.0.2.2` to a `rove --web` bound to allen's loopback in a throwaway `HOME`. The web frames in this run's PRs load that same bridge through an SSH tunnel, so both clients show the same data. Fake `claude` and `codex` scripts stand in for the engines.

States seeded in run 3: a failing `--script` routine run twice under one name for the Inbox, `engine-report --kind awaiting-input` for a tab at a menu, a second repo for move to project, and a commit on a task branch for land. Run 4 added a live claude task with one finished turn (`engine-report --kind turn-complete`) and a codex task, and rebuilt `rove-web/dist` in the fixture checkout: a stale build had hidden the engine marks.

## Pages and states

| Web phone page or state | How it opens | Checked | Android | Status |
| --- | --- | --- | --- | --- |
| Pair / log in | first load | read only | Pairing screen | has |
| Welcome (first run) | first load, no projects | read only | none | missing |
| Task list: projects, tasks, marks, `↩ Recent` | home | opened | Task list | has, no Recent row |
| Engine mark before a task title | task list | opened | Task row | #1998 adds the static brand mark; the status-coloured mark, its Appearance setting and the returning-user notice are missing |
| Row menu, `More` fold | long-press a row | opened | Row menu | #1818 adds land, copy, move, change engine, remove and the fold; retry, compare, continue in another engine, scheduled start still missing |
| Project menu | long-press a project | opened on web, Android read only | Project menu | has: field notes, move, remove |
| Archived fold | end of the list on Android; the web palette since #1901 | read only | Archived fold | Android keeps its fold |
| New session | `New task` | opened | Create sheet | partial: no branch, folder, machine chip or automatic placement, `Later`, start from a task's branch; a task needs its first prompt |
| Terminal, key row | tap a task | opened | Task detail | has |
| Message bar: hold to talk, type instead | engine tab | opened | Composer | typing has; voice missing |
| Attachments | message bar | read only | Composer | images and PDFs up to 5 MB; the web sends any file up to 500 MB in parts (`attachment.part`) |
| Swipe back to the task list | swipe right on a task | read only | system back gesture | has, Android's own |
| Queued messages | | gone from the web (#1781) | none | gone since #1817; the engine queues input itself |
| Context panel | panel switch | opened, no reading in the fixture | none | missing |
| Files panel, create PR, file preview | panel switch | opened | none | missing |
| Diff panel | panel switch | opened | Diff screen | has, no review notes or base picker |
| Browser panel | panel switch | opened | none | undecided: it opens addresses on the Mac, which a phone may not reach |
| Land dialog | row menu or `land` | Android opened | Two-step dialog with preflight | has |
| Inbox, `[ reply ]` peek | `inbox` | opened with rows, peek opened and sent | Inbox | #1997 adds reply in place; a tab at a menu opens the tab instead of offering keys in the Inbox |
| Routines | rail | opened | Routines | has, no run filters |
| Kanban, Issues | rail after install | read only | Board, GitHub issues | has; review queue missing |
| Mods | rail when present | read only, none in fixture | Mods as a gate only | missing |
| Machines | rail when registered | read only, none in fixture | none | missing |
| Usage page | usage chips, which a phone does not show | read only | Settings › Usage | has its own usage screen |
| Update | Settings › About | control opened | Settings › About | channel and notify since #1819; `Update now` and `Restart Rove` missing (`update.run`, `update.restart`) |
| Worktrees | no phone rail entry | read only | Worktrees | Android has more than the phone rail |
| Search | none since #1673 (command palette) | not on a phone | Search | Android keeps its page |
| Dispatch | removed from the web (#1673) | gone | none | no longer a gap |
| Settings › General, Appearance | Settings | opened | none | missing |
| Settings › Notifications | Settings | opened | Notifications | has, Android's own permission flow |
| Settings › Snippets | Settings | opened | none | missing |
| Settings › Engines | Settings | opened | Engines | #1996 adds engine integrations (install missing, remove all) and the Rove agent skill install |
| Settings › Auto routing | Settings | opened | none | missing |
| Settings › Voice | Settings | opened | none | missing |
| Settings › Connectors | Settings | opened | none | missing |
| Settings › Plugins | Settings | opened | Plugins | has |
| Settings › Keybindings, Dev | Settings | opened | none | not applicable: chords and desktop reset |
| Settings › About | Settings | opened | About | has |
| Settings › Feedback | Settings | opened | Feedback | has, no agent report entry |

## Still missing, by value on a phone

An op exists in `packages/rove-bridge/src/ops` for each unless the row says otherwise. Size is a rough guess.

| Feature | Op | Size |
| --- | --- | --- |
| A task's other PRs on its row | row field `sessionPrs` | S |
| Files browser, file preview, create PR | `files.list`, `file.read`, `tab.requestPR` | M |
| Update now, then Restart Rove | `update.run`, `update.status`, `update.restart` | S |
| Status-coloured engine mark and the task status setting | `prefs.get`, `prefs.set` (`statusMark`) | M |
| Attach any file up to 500 MB | `attachment.part` | M |
| Machines page | `machines.list`, `machines.repos` | M |
| Context panel | `context.usage` | S |
| Snippets, `@name` in the composer | `snippets.get`, `snippets.save`, `snippets.remove` | S |
| Change engine: model, effort, hide engines the Mac cannot start | `task.setEngine`, `engines.list` | S |
| Retry an engine that died inside a live shell | `term.revive` with `restartExited` | S |
| Retry with an edited prompt | `task.prompt`, `task.spawn` | M |
| Continue in another engine | `tab.handoff`, `tab.forkTask` | M |
| Review notes and base picker on a diff | `review.add`, `review.list`, `review.send`, `diff.refs` | M |
| Connectors | `github.*` | M |
| Auto routing | `autoRouting.get`, `autoRouting.setTier`, `autoRouting.setClassifier` | M |
| Mods page | `mod.press`, `mod.submit` | M |
| Voice dictation | `voice.*` | L |
| New session: branch, folder, machine and automatic placement, `Later`, from a task's branch | `repo.branches`, `fs.subdirs`, `machines.list`, `task.spawn` | L |
| Settings › General and Appearance | `prefs.get`, `prefs.set`, `theme.*` | L |

From reading the code, not run: the `+` sheet in task detail drops the `taskId` in the `tab.new` reply, so a prompt that starts a child task does not open that child.

Found in run 4: Android read the `output.read` terminal tail as one string, but the bridge sends a list of rows, so the engine history's terminal fallback failed to decode; #1997 fixes it. iOS `OutputEnvelope` decodes the same field as a string and likely has the same bug. On the web phone, the engine-mark notice showed twice, stacked, on first load.

Backend gaps found: none. Every missing feature above has an op.
