# Android parity with the web phone layout

The web client at 390 wide (`packages/rove-web`, narrow layout below 560 px) is the reference for what `packages/rove-android` should offer. A routine updates this page each run; open `[routine] parity-android:` PRs carry the work in progress.

Baseline: run 1, 2026-11-03, `main` at `966978834`, web 0.9.276. There is no earlier inventory, so "new" means missing from Android at this baseline.

## How the pages were listed

The web has no page-listing tool. The list comes from `PageId` in `packages/rove-web/src/ui.ts`, the rail, the Settings sections and the panel tabs in `panel-tabs.tsx`. Pages marked **opened** were opened at 390x844 with Playwright touch emulation against `rove --web --port 7979` in a throwaway `HOME`. **Read only** means the row comes from source because the fixture could not reach the page.

Android frames come from the allen emulator sized with `wm size 1024x2216` (390x844 dp), paired through `10.0.2.2` to a `rove --web` bound to allen's loopback in a throwaway `HOME`. A fake `claude` script stands in for the engine: a first send makes the tab busy, so a second send queues.

## Pages and states

| Web phone page or state | How it opens | Checked | Android | Status |
| --- | --- | --- | --- | --- |
| Pair / log in | first load | read only | Pairing screen | has |
| Task list: projects, tasks, marks, `↩ Recent` | home | opened | Task list | has, no Recent row |
| Row menu | long-press a row | opened | none on `main` | #1642 for rename, pin, status, rename branch, archive |
| Archived fold | end of the list | read only | none on `main` | #1642 |
| New session composer | `New task` | opened | Create sheet | partial: no branch, clone, adopt, folder or machine picker |
| Terminal, key row, message field | tap a task | opened | Task detail | has |
| Queued messages | send to a busy tab | opened | none on `main` | #1641 |
| Files panel: All / Changes, ask for PR | panel tab | opened | none | missing |
| Diff panel | panel tab | opened | Diff screen | has, no review notes |
| Browser panel | panel tab | opened, tab did not switch at 390 | none | not confirmed on phone |
| Land dialog | row menu or `land` | opened | Plain two-step dialog on `main` | #1643 |
| Inbox | `inbox` | opened, empty state | Inbox | has |
| Search | rail | opened | none on `main` | #1640 |
| Routines | rail | opened, empty state | Routines | has |
| Dispatch | rail | opened, idle state | none | missing |
| Kanban, Issues | rail after install | install did not show them in this run; read only | Board, GitHub issues | has, gated on the same mods |
| Mods, Machines | rail when present | read only, none in fixture | Mods as a gate only; no Machines | missing |
| Worktrees | no phone rail entry | read only | Worktrees | Android has more than the phone rail |
| Update | Settings › Check for updates | control opened, page not reached | none | missing |
| Settings › General | Settings | opened | none | missing: language, theme, terminal, updates |
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
| Rest of the row menu: new conversation, new shell, change engine, sync with base, fix checks, copy | `tab.new`, `task.setCommand`, `task.syncBase`, `task.fixChecks` | M |
| Files browser and ask for PR | `files.list`, `tab.requestPR` | M |
| Review notes on a diff | `review.add`, `review.list`, `review.send` | M |
| New session: branch, clone, adopt, folder, machine | `repo.branches`, `repo.probe`, `repo.clone`, `fs.subdirs`, `machines.list`, `task.spawn` | L |
| Rename, close a tab | `tab.rename`, `tab.close` | S |
| Update check | `update.check`, `release.notes` | S |
| Settings › General | `prefs.get`, `prefs.set`, `theme.*` | L |
| Connectors | `github.*` | M |
| Auto routing | `autoRouting.get`, `autoRouting.setTier`, `autoRouting.setClassifier` | M |
| Machines page | `machines.list`, `machines.repos` | M |
| Dispatch page | the `dispatch` push | L |
| Mods page | `mod.press`, `mod.submit` | M |
| Worktree adopt | `worktree.adoptable`, `worktree.adopt` | S |

Backend gaps found: none. Every missing feature above has an op.
