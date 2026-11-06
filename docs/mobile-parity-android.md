# Android parity with the web phone layout

The web client at 390 wide (`packages/rove-web`, narrow layout below 560 px) is the reference for what `packages/rove-android` should offer. A routine updates this page each run; open `[routine] parity-android:` PRs carry the work in progress.

Last run: run 2, 2026-11-05, `main` at `2a4c8a9c6`, web 0.9.276. Run 1 was 2026-11-03 at `966978834`. Between them the web and bridge changed only through #1637 (prefs writes), #1649 and #1651 (theme colors), so there are no new pages or ops; this run worked through what run 1 left missing. #1648, #1650 and #1653 change web phone pages and are still open: compare again once they merge.

## How the pages were listed

The web has no page-listing tool. The list comes from `PageId` in `packages/rove-web/src/ui.ts`, the rail, the Settings sections and the panel tabs in `panel-tabs.tsx`. Pages marked **opened** were opened at 390x844 with Playwright touch emulation against `rove --web --port 7979` in a throwaway `HOME`. **Read only** means the row comes from source because the fixture could not reach the page.

Android frames come from the allen emulator sized with `wm size 1024x2216` (390x844 dp), paired through `10.0.2.2` to a `rove --web` bound to allen's loopback in a throwaway `HOME`. A fake `claude` script stands in for the engine: a first send makes the tab busy, so a second send queues.

Run 2 seeded states on the same setup: `routine-run-now` with a failing `--script` for a failed routine in the Inbox, `engine-report --kind awaiting-input` for a tab at a menu, and `ROVE_FAKE_UPDATE` for an available update. Run 2 opened the task list, Inbox, row menu, terminal with key row, and Settings › Updates again; other rows keep run 1's result.

## Pages and states

| Web phone page or state | How it opens | Checked | Android | Status |
| --- | --- | --- | --- | --- |
| Pair / log in | first load | read only | Pairing screen | has |
| Task list: projects, tasks, marks, `↩ Recent` | home | opened | Task list | has, no Recent row; routine runs filtered since #1655 |
| Row menu | long-press a row | opened | Rename, pin, status, rename branch, archive (#1642) | partial: #1663 sync, #1664 fix checks, #1665 new conversation and shell |
| Archived fold | end of the list | read only | Archived fold | has |
| New session composer | `New task` | opened | Create sheet | partial: no branch, clone, adopt, folder or machine picker |
| Terminal, key row, message field | tap a task | opened | Task detail | has; #1661 keys at a menu, #1662 arrow mode, #1666 rename and close a tab, #1668 reopen |
| Queued messages | send to a busy tab | opened | Queued chips | has |
| Files panel: All / Changes, ask for PR | panel tab | opened | none | missing |
| Diff panel | panel tab | opened | Diff screen | has, no review notes |
| Browser panel | panel tab | opened, tab did not switch at 390 | none | not confirmed on phone |
| Land dialog | row menu or `land` | opened | Two-step dialog with preflight | has |
| Inbox | `inbox` | opened, failed routine row | Inbox | has; #1667 clears a failed routine |
| Search | rail | opened | Search | has |
| Routines | rail | opened, empty state | Routines | has |
| Dispatch | rail | opened, idle state | none | missing |
| Kanban, Issues | rail after install | install did not show them in this run; read only | Board, GitHub issues | has, gated on the same mods |
| Mods, Machines | rail when present | read only, none in fixture | Mods as a gate only; no Machines | missing |
| Worktrees | no phone rail entry | read only | Worktrees | Android has more than the phone rail |
| Update | Settings › Check for updates | control opened, page not reached | none | #1669 in Settings › About |
| Settings › General | Settings | opened | none | missing: language, theme, terminal |
| Settings › Engines | Settings | opened | Engines | has |
| Settings › Connectors | Settings | opened | none | missing: GitHub account |
| Settings › Auto routing | Settings | opened | none | missing |
| Settings › Plugins | Settings | opened | Plugins | has |
| Settings › Keybindings, Dev | Settings | opened | none | not applicable: chords and desktop reset |
| Settings › Feedback | Settings | opened | Feedback | has |
| Usage line | top of Settings | read only | Usage | has |

## Still missing, by value on a phone

An op exists in `packages/rove-bridge/src/ops` for each unless the row says otherwise. Size is a rough guess.

| Feature | Op | Size |
| --- | --- | --- |
| Row menu: change engine, copy id, branch or path | `task.setEngine`, `task.get` | S |
| Worktree adopt | `worktree.adoptable`, `worktree.adopt` | S |
| Retry an engine that died inside a live shell | `term.revive` with `restartExited` | S |
| A task's other PRs on its row | row field `sessionPrs` | S |
| Files browser and ask for PR | `files.list`, `tab.requestPR` | M |
| Review notes on a diff | `review.add`, `review.list`, `review.send` | M |
| Connectors | `github.*` | M |
| Auto routing | `autoRouting.get`, `autoRouting.setTier`, `autoRouting.setClassifier` | M |
| Mods page | `mod.press`, `mod.submit` | M |
| Install the Rove skill from Engines | `skill.missing`, `skill.install` | S |
| New session: branch, clone, adopt, folder, machine | `repo.branches`, `repo.probe`, `repo.clone`, `fs.subdirs`, `machines.list`, `task.spawn` | L |
| Settings › General | `prefs.get`, `prefs.set`, `theme.*` | L |

From reading the code, not run: the `+` sheet in task detail drops the `taskId` in the `tab.new` reply, so a prompt that starts a child task does not open that child.

Backend gaps found: none. Every missing feature above has an op.
