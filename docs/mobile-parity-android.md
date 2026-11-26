# Android parity with the web phone layout

The web client at 390 wide (`packages/rove-web`, narrow layout below 560 px) is the reference for what `packages/rove-android` should offer. A routine updates this page each run; open `[routine] parity-android:` PRs carry the work in progress.

Last run: run 8, 2026-11-26, `main` at `717e6b7b5`, web 0.9.305. Run 5 was 2026-11-16 at `a29383a48`; runs 6 and 7 left no PR. Since run 5 a project has no main session: opening a project starts a new session in its checkout (#2100). The web also gained a Shell row in New session's engine menu (#2111), a question about children when archiving a session that has them (#2166), Compare attempts that reads each attempt's diff side by side (#2199), usage shown as what is left (#2104), Update as its own sidebar page (#2119, #2121), Connectors as a card grid, a file from Files opening as a Browser tab, and a new session on another machine that skips the worktree.

## How the pages were listed

The web has no page-listing tool. The list comes from `PageId` in `packages/rove-web/src/ui.ts`, the rail, `SECTION_GROUPS` in `settings-sections.ts` and the panel switch on the task page. Pages marked **opened** were opened at 390x844 with Playwright touch emulation against `rove --web` in a throwaway `HOME`. **Read only** means the row comes from source because the fixture could not reach the page. The column keeps the last run that opened a page; run 8 opened the task list, a project header's menu, Archive on a task with children and New session with the Shell row.

Android frames come from the allen emulator `rove_test` sized with `wm size 1024x2216` (390x844 dp), paired through `10.0.2.2` to a `rove --web` bound to allen's loopback in a throwaway `HOME`. The web frames in this run's PRs load that same bridge through an SSH tunnel, so both clients show the same data. Fake `claude` and `codex` scripts stand in for the engines.

States seeded in run 3: a failing `--script` routine run twice under one name for the Inbox, `engine-report --kind awaiting-input` for a tab at a menu, a second repo for move to project, and a commit on a task branch for land. Run 4 added a live claude task with one finished turn (`engine-report --kind turn-complete`) and a codex task, and rebuilt `rove-web/dist` in the fixture checkout: a stale build had hidden the engine marks. Run 5 set `ROVE_FAKE_UPDATE=99.0.0` and put a fake `sh` first on the fixture's PATH that answers the `curl … | sh` installer, so Update now and Restart Rove ran end to end without installing anything. Run 8 reused that home: #2100 turned its old main row into a dir session, and a task with three children covered archive.

## Pages and states

| Web phone page or state | How it opens | Checked | Android | Status |
| --- | --- | --- | --- | --- |
| Pair / log in | first load | read only | Pairing screen | has |
| Welcome (first run) | first load, no projects | read only | none | missing |
| Task list: projects, tasks, marks, `↩ Recent` | home | opened | Task list | has, no Recent row |
| Row labels | task list, `rove api row-token` | read only | Task row | missing: the row field `rowTokens`; it lands in `TaskRowView.kt`, which #1998 changes, so it waits for #1998 |
| Engine mark before a task title | task list | opened | Task row | #1998 adds the static brand mark; the status-coloured mark, its Appearance setting and the returning-user notice are missing |
| Row menu, `More` fold | long-press a row | opened | Row menu | has land, copy, move, change engine, remove, archive and the fold; #2213 asks about children on archive and lists Move to project targets from `repos.list` (empty since #2100); retry, compare, continue in another engine, scheduled start still missing |
| Project menu | `···` on a project header | opened | Project menu | field notes and remove; the order items vanished with main rows (#2100) and come back through `project.move` in #2213; New task in this project and View all sessions missing |
| Archived fold | end of the list on Android | read only | Archived fold | Android keeps its fold |
| Sessions page | rail, project header menu | read only | Archived fold | not planned: the web added it because its rail lists no archived sessions; Android's fold already lists them with Unarchive and Remove |
| New session | `New task` | opened | Create sheet | partial: no branch, folder, machine chip or automatic placement, `Later`, start from a task's branch, GitHub project picker and clone; an engine task needs its first prompt. #2214 adds the Shell row, worktree only |
| Compare attempts | row menu `Compare` on a round | read only | none | missing; since #2199 it shows the prompt and each attempt's diff |
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
| Update | sidebar page since #2119 | read only | Settings › About | has channel, notify, `Update now` and `Restart Rove` |
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
| Row labels on task rows, after #1998 | row field `rowTokens` | S |
| New task in this project, from the project menu | `task.spawn` with `repo` | S |
| Usage as what is left | `prefs.get`, `prefs.set` (`usage.show`) | S |
| Compare attempts with their diffs | `diff.files`, `diff.file`, `output.read` | M |
| New task: shell in the project checkout or no folder | `task.openCheckout`, `task.openScratch`, `tab.new` with `own` | S |
| GitHub project picker and clone in New session | `github.repos`, `repo.clone` | M |
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

Run 4's code-reading find, the `+` sheet dropping the `taskId` of the `tab.new` reply, was real: on the emulator a second `+` on a main started a child task that never opened. #2097 fixed it.

Found in run 4: Android read the `output.read` terminal tail as one string, but the bridge sends a list of rows, so the engine history's terminal fallback failed to decode; #1997 fixes it. iOS `OutputEnvelope` decodes the same field as a string and likely has the same bug. On the web phone, the engine-mark notice showed twice, stacked, on first load.

Found in run 5, web: at 390 wide, Settings › About › Open Update page rendered the Update page under Settings. #2119 and #2121 made Update its own page; run 8 did not reopen it.

Found in run 8: #2100 removed main rows, and Android had read a project's order and its Move to project targets from them, so both went empty; #2213 fixes both. On the web phone, after the project order changed, the rail still drew `repo` above `repo2` while `repo2`'s menu offered only Move down, as if it were first.

Backend gaps found: none. Every missing feature above has an op.
