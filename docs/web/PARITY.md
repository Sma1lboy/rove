# Web parity with the TUI

Every user action the TUI offers (199 numbered rows, plus four extra rows marked `—`: two web-only, two for the unmerged long-run controls stack), and whether `packages/rove-web` does it yet.
Legend: ✅ same as TUI · 🟡 partial or different · ❌ missing (unbuilt) · 🚫 cannot exist in a browser. `Bridge` names the op that would carry the action: `missing` = no op exists, `local` = pure UI.
A row is verified with Playwright (headed Chromium) against `rove --web` on a real sandbox daemon. Screenshots stay local in `.scratch/web/shots` (not in git); the comparison text lives in the row.
Browser-reserved chords (Ctrl+W, Ctrl+T, Ctrl+Q, Ctrl+N) cannot be used on the web: each such row needs a different PROPOSED chord, which needs owner sign-off (docs/KEYBINDINGS.md).

Score: 15 / 203 rows at ✅ (24 🟡, 2 🚫, 162 ❌)

## Navigation, help, command layer and global chrome

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 1 | Open command palette | `/` prefix or clickable prefix guide | ❌ | local | Playwright: trigger '/ prefix or clickable prefix guide'; expect 'open command palette' as in TUI. Currently absent (browser-local, no bridge call). |
| 2 | Fuzzy filter palette by action/chord | type in palette | ❌ | local | Playwright: trigger 'type in palette'; expect 'fuzzy filter palette by action/chord' as in TUI. Currently absent (browser-local, no bridge call). |
| 3 | Move palette selection / run / cancel | ↑/↓, Enter/click, Esc | ❌ | local | Playwright: trigger '↑/↓'; expect 'move palette selection / run / cancel' as in TUI. Currently absent (browser-local, no bridge call). |
| 4 | Show keybindings help | F1 or palette | ❌ | local | Playwright: trigger 'F1 or palette'; expect 'show keybindings help' as in TUI. Currently absent (browser-local, no bridge call). |
| 5 | Filter help | `/` then type | ❌ | local | Playwright: trigger '/ then type'; expect 'filter help' as in TUI. Currently absent (browser-local, no bridge call). |
| 6 | Scroll / close help | ↑/↓, PgUp/PgDn, Home/End, `?`/Esc/click | ❌ | local | Playwright: trigger '↑/↓'; expect 'scroll / close help' as in TUI. Currently absent (browser-local, no bridge call). |
| 7 | Reveal command layer and clickable badges | tap prefix | ❌ | local | Playwright: trigger 'tap prefix'; expect 'reveal command layer and clickable badges' as in TUI. Currently absent (browser-local, no bridge call). |
| 8 | Reveal direct Ctrl shortcuts | hold Ctrl 400 ms | ❌ | local | Playwright: trigger 'hold Ctrl 400 ms'; expect 'reveal direct Ctrl shortcuts' as in TUI. Currently absent (browser-local, no bridge call). |
| 9 | Focus previous/next pane | prefix h/l, F4 | 🟡 | local | r7: prefix `h`/`l` walk rail → workspace → files and wrap (focus checked via `document.activeElement`). F4 not bound. |
| 10 | Return to Tasks, then quit | Ctrl+Q (browser-reserved: web needs a PROPOSED chord, owner sign-off per docs/KEYBINDINGS.md) | ❌ | local | Playwright: trigger 'Ctrl+Q (browser-reserved: web needs a PROPOSED chord'; expect 'return to Tasks, then quit' as in TUI. Currently absent (browser-local, no bridge call). |
| 11 | Quit with confirmation | sidebar `q` | ❌ | local | Playwright: trigger 'sidebar q'; expect 'quit with confirmation' as in TUI. Currently absent (browser-local, no bridge call). |
| 12 | Zen: toggle Files visibility | prefix z, Files chip | ✅ | local | r3: `Zen` chip hides Files, a `Files` button brings it back. r7: `ctrl+a z` toggles it from the terminal; the HUD reads `ctrl+a + z → Toggle zen mode` (shot r7-02). |
| 13 | Redraw corrupted screen | prefix r | 🚫 | local | Cannot exist: a browser canvas has no corrupted terminal screen to erase; xterm repaints itself. |
| 14 | Refresh daemon/TUI build (restart daemon + relaunch) | prefix r when DAEMON OUT OF DATE, confirm | ❌ | missing | Playwright: trigger 'prefix r when DAEMON OUT OF DATE'; expect 'refresh daemon/TUI build (restart daemon + relaunch)' as in TUI. Currently absent (no bridge op yet). |
| 15 | Open Settings | prefix `,`, sidebar `s`, footer click | ✅ | local | r6: rail `s` and footer `[settings]`, TUI section order (shot r6s-01). r7: `ctrl+a ,` opens it from the terminal. |
| 16 | Open Worktrees | sidebar `x` | ✅ | `worktrees.list` | r8: rail `x` opens the Worktrees page over the workspace (shot r8-01). |
| 17 | Open Update | sidebar `u`, update chip | ✅ | `update.check` | me: rail `u` and the brand-row `↑ 0.9.999` chip (shown only when the registry is newer) open the Update page (shot me-update-fake-02). |
| 18 | Open Kanban / Routines / GitHub Issues | prefix 1/2/3, rail click | ❌ | `issue.repos`, `issue.list`, `routine.list`, `workitem.list` | Playwright: trigger 'prefix 1/2/3'; expect 'open Kanban / Routines / GitHub Issues' as in TUI. Currently absent (via issue.repos, issue.list, routine.list, workitem.list). |
| 19 | Close current page | `q`/Esc/Ctrl+C | 🟡 | local | r8: `q`/Esc close the Worktrees page. Ctrl+C not bound (it is the terminal's copy/interrupt in a browser). |
| 20 | Drag Tasks rail width / reset auto width | edge drag / double click | ❌ | local | Playwright: trigger 'edge drag / double click'; expect 'drag Tasks rail width / reset auto width' as in TUI. Currently absent (browser-local, no bridge call). |
| 21 | Toggle collapsed Tasks rail | fold control click | ❌ | local | Playwright: trigger 'fold control click'; expect 'toggle collapsed Tasks rail' as in TUI. Currently absent (browser-local, no bridge call). |
| 22 | Narrow layout: return to Tasks | click ‹ Tasks, Ctrl+Q | ❌ | local | Playwright: trigger 'click ‹ Tasks'; expect 'narrow layout: return to Tasks' as in TUI. Currently absent (browser-local, no bridge call). |
| 23 | Footer shortcut hints | click commands/sidebar/help/Settings hint | ❌ | local | Playwright: trigger 'click commands/sidebar/help/Settings hint'; expect 'footer shortcut hints' as in TUI. Currently absent (browser-local, no bridge call). |
| 24 | Observe quotas / context / token usage in footer | footer (read only) | 🟡 | `usage.get` | r4: the footer shows `CODEX 7d 0% → 10/21 23:14`, with the TUI's text and tone from the TUI's own `usage-core.ts` (shot r4-01). `ctx %` / `Σ` come from `usage.get {taskId, tabId}` (bridge unit-tested) but were not seen in a browser: the sandbox Claude is not logged in and Codex sessions carry no pinned id, so the daemon has no reading. No key-hint half (no command layer yet). |
| — | Open the web client from the printed link (token in fragment, stripped from the address bar) | `rove --web` printed link | ✅ | `hello` | Run `rove --web`, open the printed link (`/#token=…`): the task list loads and `location.hash` is empty after load. |

## Sidebar, task list, project context menu

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| — | See the task list: projects → tasks → tabs, with the TUI's status marks (`?` `!` `●` `○` spinner) and `+N` / `−N` / `↑N` / PR / pinned marks | always visible | ✅ | `tasks.subscribe`, `task.tabs` | Open the page: rows match `rove api list` for the sandbox; glyphs follow `tui/panes/sidebar/row-view.ts` (`!` for the two exited engines, `○` for the quiet main row). |
| 25 | Navigate rows with keyboard | j/k, ↑/↓ (click is #26) | ✅ | local | r5: with the rail focused, `j`/`k` move the cursor (accent outline, shown only while focused) over task and tab rows; project headers are not stops, as the TUI's `treeFlatIds` (shot r5-01). |
| 26 | Open task / tab / recent task | Enter, l/Space, click | ✅ | `tasks.list`, `task.tabs`, `term.attach` | r1: click a task row, then a tab row: the terminal attaches and replays. r5: Enter on the cursor's task opens it (tab strip title matches). |
| 27 | Jump to top / bottom | gg / Shift+G | ✅ | local | r5: `G` lands on the last row, `gg` on the first. |
| 28 | Focus engine from sidebar | → | ✅ | local | r5: `→` moves focus into the attached terminal. |
| 29 | Start new task (browser-reserved Ctrl+N is not usable; PROPOSED chord needs owner sign-off) | n, prefix n, New task click, project menu | ✅ | `task.spawn` | r2: rail `+ New task` and project menu (created task listed by `rove api list`). r5: rail `n`. r7: `ctrl+a n` from the terminal. Ctrl+N is the browser's; the TUI's own prefix route covers it. |
| 30 | Rename task | r, row menu | ✅ | `task.rename` | r2: row menu Rename. r5: `r` on the cursor's task renamed it; `rove api list` shows the new title (then renamed back). Menu shows `r`. |
| 31 | Rename branch | b, row menu (managed branch) | ✅ | `task.setBranch` | r2: row menu Rename branch → `rove api list` shows it. r5: `b` opens the same dialog filled with the branch. |
| 32 | Cycle task engine | v | ✅ | `task.setCommand` | r5: `v` moved the task to the next ready engine (`get-task` vendor claude → codex) with the TUI's toast `Engine → Codex (applies on reopen)` (shot r5-07). |
| 33 | Pick task engine / model / effort | row menu Change engine | 🟡 | `engines.list`, `task.setCommand`, `task.setModel`, `task.setEffort` | r2: row menu Change engine → Claude; `get-task` vendor `claude`. Engine only; no model/effort step yet. |
| 34 | Open task directory in GUI editor | o, prefix o, row menu | 🚫 | missing | Cannot exist: a page cannot launch a local GUI editor and the bridge has no op for it. |
| 35 | Pin / unpin managed task | Shift+P, menu | ✅ | `task.pin` | r2: row menu Pin. r5: `Shift+P` pinned (`▴`, `pinned: true`) and pressed again unpinned. |
| 36 | Reorder sibling tab/task/project | Shift+M, prefix m, menu | ❌ | `task.move` | Playwright: trigger 'Shift+M'; expect 'reorder sibling tab/task/project' as in TUI. Currently absent (via task.move). |
| 37 | Move project to top | project header menu | ❌ | `task.move` | Playwright: trigger 'project header menu'; expect 'move project to top' as in TUI. Currently absent (via task.move). |
| 38 | Change task sort (default/recent/attention/name) | t | ✅ | local | r5: `t` cycles recent → attention → name → default (persisted per browser, as the TUI's KV `activeSortMode`); name sort puts Audit before Fix under the main row, which stays first (shot r5-03). Silent, as in the TUI. |
| 39 | Fuzzy search titles/repo/branch/tab | `/` | ✅ | local | r5: `/retry` leaves only "Fix retry backoff" and its tab, header reads `/ retry█ 2/7` (shot r5-02). Fields matched one at a time with the TUI's `fuzzy.ts`; a hit keeps its ancestors (unit-tested). |
| 40 | Search result navigate / accept / cancel | ↑/↓, Enter, Esc | ✅ | local | r5: Enter opens the top match and closes the query; Esc cancels and the full list returns. |
| 41 | Open / dismiss right-click task menu | right click, Esc | ✅ | local | r2: right click on task, tab and tab-strip rows opens the menu at the pointer with the TUI's entries in its order; Esc and an outside click dismiss it (`.menu` gone). |
| 42 | New conversation on a row | row menu | ✅ | `tab.new` | r6: menu → picker → Codex with no first message → a live Codex tab (`get-task` vendor codex, engineAlive), as the TUI picker; a message stays optional (r2 path). Bridge `tab.new` without `prompt` calls the new `rove api tab-new`. |
| 43 | New shell on a row | row menu | ✅ | `tab.new {kind:"shell"}` | r6: menu New shell → hosted shell tab (`get-task` kind `command`, alive), labelled `shell`; `echo shell-from-web-$((6*7))` typed in the web xterm printed 42 (shot r6t-01). An attached TUI absorbs the tab via the daemon's `tab.add` (not a misread engine). |
| 44 | Close selected tab | tab row menu | ✅ | `tab.close` | r2: tab menu Close tab → confirm → tab count drops by one; `get-task` no longer lists it. Close latency 1–20 s (daemon-side), button shows busy meanwhile. |
| 45 | Run stored brief again as a new task | row menu + confirm | ❌ | `task.create`, `task.spawn` | Playwright: trigger 'row menu + confirm'; expect 'run stored brief again as a new task' as in TUI. Currently absent (via task.create, task.spawn). |
| 46 | Set task board status | row menu | ✅ | `task.setStatus` | r2: menu Set status → In review; `rove api list` status `in_review`. Menu-only in the TUI too. |
| 47 | Copy task id | row menu | ✅ | local | r2: clipboard equals the task id from `rove api list`; toast `copied …`. |
| 48 | Copy branch name | row menu | ✅ | local | r2: clipboard equals `branch` from `rove api list`. |
| 49 | Copy worktree path | row menu | ✅ | `task.get` | r2: clipboard equals `worktreePath` from `rove api list`. |
| 50 | Forget project checkout | project menu, `d` on main + confirm | ❌ | `project.forget` | Playwright: trigger 'project menu'; expect 'forget project checkout' as in TUI. Currently absent (via project.forget). |
| 51 | Delete directory task record | `d`/menu + confirm | 🟡 | `task.delete` | Menu + confirm built (same flow as #52, dir wording); `d` opens it (r5). No dir task in the sandbox yet. |
| 52 | Delete managed task / worktree (force confirm when dirty) | `d`/menu + confirm | 🟡 | `task.delete` | r2: menu Delete → confirm → task gone from `rove api list`. r5: `d` opens the same confirm; Esc keeps the task. Dirty → force escalation built, not exercised. |
| 53 | Read project's field notes | project menu | ❌ | `notes.list` | Playwright: trigger 'project menu'; expect 'read project's field notes' as in TUI. Currently absent (via notes.list). |
| 54 | Retire selected field note | `d` in notes dialog + confirm | ❌ | `notes.delete` | Playwright: trigger 'd in notes dialog + confirm'; expect 'retire selected field note' as in TUI. Currently absent (via notes.delete). |
| 55 | Expand/collapse project's routine-session group | Enter/click count row | ❌ | local | Playwright: trigger 'Enter/click count row'; expect 'expand/collapse project's routine-session group' as in TUI. Currently absent (browser-local, no bridge call). |
| 56 | Open Inbox from brand attention chip | click chip | ✅ | `tasks.subscribe` | r2: clicking `INBOX n` in the rail head opens the Inbox dialog. |
| 57 | Go to recent task in narrow layout | Enter/click ↩ Recent row | ❌ | `task.get` | Playwright: trigger 'Enter/click ↩ Recent row'; expect 'go to recent task in narrow layout' as in TUI. Currently absent (via task.get). |
| 58 | Land managed task into base | row menu + confirm | 🟡 | `task.land` | Menu entry + confirm built; not exercised (sandbox branches have no commits → EMPTY_BRANCH). |
| 59 | Sync base branch into task | prefix u, row menu | ❌ | missing | Playwright: trigger 'prefix u'; expect 'sync base branch into task' as in TUI. Currently absent (no bridge op yet). |
| 60 | Ask agent to fix failing checks | prefix k, row menu on failing PR | ❌ | missing | Playwright: trigger 'prefix k'; expect 'ask agent to fix failing checks' as in TUI. Currently absent (no bridge op yet). |

## Task creation and picker

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 61 | Switch Existing / New Repo / Adopt mode | Ctrl+[ / Ctrl+], chip | ❌ | local | Playwright: trigger 'Ctrl+[ / Ctrl+]'; expect 'switch Existing / New Repo / Adopt mode' as in TUI. Currently absent (browser-local, no bridge call). |
| 62 | Move focus / complete repo or clone-parent suggestion | Tab, click field | ❌ | `repos.list` | Playwright: trigger 'Tab'; expect 'move focus / complete repo or clone-parent suggestion' as in TUI. Currently absent (via repos.list). |
| 63 | Cycle / pick engine in dialog | Ctrl+E, chip | 🟡 | `engines.list` | r2: engine chips (registry names, `·` marks not-ready) pick the engine; Ctrl+E not on the web. |
| 64 | Choose existing repository / path | type, ↑/↓, Tab, Enter | 🟡 | `repos.list` | r2: a select of saved projects; no typed path or Tab completion. |
| 65 | Choose branch / ref | branch picker | ❌ | `repo.branches` | Playwright: trigger 'branch picker'; expect 'choose branch / ref' as in TUI. Currently absent (via repo.branches). |
| 66 | Open existing project checkout | Existing: Opens project itself, Create | ❌ | `task.openMain` | Playwright: trigger 'Existing: Opens project itself'; expect 'open existing project checkout' as in TUI. Currently absent (via task.openMain). |
| 67 | Create new worktree from existing repo | Existing Create/Enter | ✅ | `task.spawn` | r2: Create (or Enter in the title, ⌘↵ in the message) → new managed task in `rove api list`. |
| 68 | Clone repository and create task | New Repo URL/parent/folder/base, Create | ❌ | `repo.clone`, `task.create` | Playwright: trigger 'New Repo URL/parent/folder/base'; expect 'clone repository and create task' as in TUI. Currently absent (via repo.clone, task.create). |
| 69 | Filter / select adoptable worktrees | Adopt filter, ↑/↓, Enter, Ctrl+A | ❌ | `worktree.adoptable` | Playwright: trigger 'Adopt filter'; expect 'filter / select adoptable worktrees' as in TUI. Currently absent (via worktree.adoptable). |
| 70 | Adopt selected worktrees | Adopt Create | ❌ | `worktree.adopt` | Playwright: trigger 'Adopt Create'; expect 'adopt selected worktrees' as in TUI. Currently absent (via worktree.adopt). |
| 71 | Cancel creation | Esc, close click | ✅ | local | r2: Esc and `cancel` close the dialog with no task created. |

## Workspace tabs, sessions, splits, terminal

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 72 | New engine tab (browser-reserved Ctrl+T; PROPOSED chord needs owner sign-off) | Ctrl+T | 🟡 | `tab.new` | r2: tab-strip `+` opens the new-conversation picker. No chord. |
| 73 | Open new conversation picker | Ctrl+E | ✅ | `engines.list` | r2: `+`, row menu, empty pane button. r8: Ctrl+E from the terminal opens it. |
| 74 | Choose engine / shell / plugin pane | picker ←/→, Enter, click | 🟡 | `tab.new` | r6: engine chips plus a `shell` chip (hides the message field) by click; no plugin pane, no ←/→. |
| 75 | Pick destination tab / fork / scratch | picker Tab/chips | ❌ | `tab.forkTask` | Playwright: trigger 'picker Tab/chips'; expect 'pick destination tab / fork / scratch' as in TUI. Currently absent (via tab.forkTask). |
| 76 | Pick fresh / continue chat | picker Ctrl+F | ❌ | `tab.handoff` | Playwright: trigger 'picker Ctrl+F'; expect 'pick fresh / continue chat' as in TUI. Currently absent (via tab.handoff). |
| 77 | Continue chat in same worktree new tab | prefix c | ❌ | `tab.handoff` | Playwright: trigger 'prefix c'; expect 'continue chat in same worktree new tab' as in TUI. Currently absent (via tab.handoff). |
| 78 | Fork child task from current branch | prefix f | ❌ | `tab.forkTask` | Playwright: trigger 'prefix f'; expect 'fork child task from current branch' as in TUI. Currently absent (via tab.forkTask). |
| 79 | Edit fork prompt / branch / engine / attempts 1–5 | composer Tab, Ctrl+E, ←/→, Enter | ❌ | local | Playwright: trigger 'composer Tab'; expect 'edit fork prompt / branch / engine / attempts 1–5' as in TUI. Currently absent (browser-local, no bridge call). |
| 80 | Fan out fork attempts | composer attempts >1, submit | ❌ | `task.spawn` | Playwright: trigger 'composer attempts >1'; expect 'fan out fork attempts' as in TUI. Currently absent (via task.spawn). |
| 81 | Attach / drop / paste image or PDF in composer | drop, Ctrl+V, Ctrl+X | ❌ | `attachment.put` | Playwright: trigger 'drop'; expect 'attach / drop / paste image or PDF in composer' as in TUI. Currently absent (via attachment.put). |
| 82 | New Scratch task / shell | picker Scratch | ❌ | `task.create`, `tab.new` | Playwright: trigger 'picker Scratch'; expect 'new Scratch task / shell' as in TUI. Currently absent (via task.create, tab.new). |
| 83 | Click tab / previous / next / jump N | tab strip click, Ctrl+[ / Ctrl+], Ctrl+1..9 | ✅ | local | r8: tab strip click, Ctrl+2 jumps, Ctrl+] / Ctrl+[ cycle, from inside the terminal. On Linux/Windows Chrome reserves Ctrl+1..9 for its own tabs and never delivers them; macOS delivers them. |
| 84 | Close active tab (browser-reserved Ctrl+W; PROPOSED chord needs owner sign-off) | Ctrl+W, prefix w, row menu | 🟡 | `tab.close` | r2: tab menu Close tab. r7: `ctrl+a w` closed the active tab with no confirm, as the TUI (`get-task` count −1). Ctrl+W is the browser's and cannot be taken. |
| 85 | Reopen empty task session | Enter/Ctrl+E in empty pane | 🟡 | `tab.new` | r6: empty pane's `New conversation` opens the picker, which now starts an engine with no message. No Enter/Ctrl+E. |
| 86 | Rename tab | F2 | ✅ | `tab.rename` | r8: F2 on the active tab → rename dialog; `get-task` shows title `renamed-by-f2`. |
| 87 | Split terminal right / down | Ctrl+\\ / Ctrl+= | ❌ | local | Playwright: trigger 'Ctrl+\\ / Ctrl+='; expect 'split terminal right / down' as in TUI. Currently absent (browser-local, no bridge call). |
| 88 | Focus next split | F3, click leaf | ❌ | local | Playwright: trigger 'F3'; expect 'focus next split' as in TUI. Currently absent (browser-local, no bridge call). |
| 89 | Close active split (browser-reserved Ctrl+W; PROPOSED chord needs owner sign-off) | Ctrl+W, prefix w in split | ❌ | `tab.close` | Playwright: trigger 'Ctrl+W'; expect 'close active split (browser-reserved Ctrl+W; PROPOSED chord needs owner sign-off)' as in TUI. Currently absent (via tab.close). |
| 90 | Rename active split | F2 in split | ❌ | local | Playwright: trigger 'F2 in split'; expect 'rename active split' as in TUI. Currently absent (browser-local, no bridge call). |
| 91 | Type / paste into terminal or engine | keys, bracketed paste, image path drop | 🟡 | `term.input` | Typing done: attach a shell tab, type `echo web-typed-$((40+2))` + Enter, the PTY prints `web-typed-42` (screenshot + `rove api read-output`). Bracketed paste and image-path drop not verified/built. |
| 92 | Scroll back / forward | Ctrl+PgUp/PgDn, wheel | ❌ | local | Playwright: trigger 'Ctrl+PgUp/PgDn'; expect 'scroll back / forward' as in TUI. Currently absent (browser-local, no bridge call). |
| 93 | Jump to earliest / latest retained output | first/latest chips | ❌ | local | Playwright: trigger 'first/latest chips'; expect 'jump to earliest / latest retained output' as in TUI. Currently absent (browser-local, no bridge call). |
| 94 | Select and auto-copy terminal text | mouse drag / release | ❌ | local | Playwright: trigger 'mouse drag / release'; expect 'select and auto-copy terminal text' as in TUI. Currently absent (browser-local, no bridge call). |
| 95 | Copy selection or interrupt | Ctrl+C | ❌ | `tab.interrupt`, `term.input` | Playwright: trigger 'Ctrl+C'; expect 'copy selection or interrupt' as in TUI. Currently absent (via tab.interrupt, term.input). |
| 96 | Copy selection | Cmd+C / Ctrl+Shift+C | ❌ | local | Playwright: trigger 'Cmd+C / Ctrl+Shift+C'; expect 'copy selection' as in TUI. Currently absent (browser-local, no bridge call). |
| 97 | Reset active terminal | F5 + confirm | ❌ | `term.detach`, `term.attach` | Playwright: trigger 'F5 + confirm'; expect 'reset active terminal' as in TUI. Currently absent (via term.detach, term.attach). |
| 98 | Open scrollback search | prefix `/` in terminal | ❌ | local | Playwright: trigger 'prefix / in terminal'; expect 'open scrollback search' as in TUI. Currently absent (browser-local, no bridge call). |
| 99 | Search and navigate hits / close | type, Enter/↑, ↓, Esc | ❌ | local | Playwright: trigger 'type'; expect 'search and navigate hits / close' as in TUI. Currently absent (browser-local, no bridge call). |

## Files, previews and diff review

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 100 | All / Changes tab | `[` / `]`, header click | ✅ | `diff.files`, `files.list` | r3/r3b: header click and `[`/`]` switch tabs; Changes is the default, as in the TUI. |
| 101 | Navigate files | j/k, ↑/↓, click | ✅ | local | r3b: `j`/`k` move the selected row to README.md, then `d` opens it. |
| 102 | Collapse / expand tree | h/l, ←/→, click dir | ✅ | local | r3: clicking `src` in All expands to `auth` (shot r3-06). |
| 103 | Toggle Changes working / branch scope | b | ✅ | `diff.files` | r3: `b` switches to "vs main" and lists the committed `A src/auth/refresh.ts` (shot r3-02). |
| 104 | Refresh file list | r | ✅ | `diff.files`, `files.list` | r3b: a file written after load appears only after `r` (shot r3b-01). |
| 105 | Open file in configured editor / diff editor | Enter, click | 🟡 | missing | Web Enter/click opens the read-only diff instead; launching the host editor needs a bridge op. |
| 106 | Open file/directory read-only diff tab | d | ✅ | `diff.file` | r3/r3b: click and `d` open the diff as a `d README.md` tab with old/new gutters (shot r3-04). |
| 107 | Open whole-worktree combined diff | Shift+D, [D] click | ✅ | `diff.file` | r3: `Shift+D` opens the combined diff naming README.md (shot r3-05). |
| 108 | Reload preview / diff | r | ✅ | `diff.file` | r3b: a line written to README.md after open appears after `r`. |
| 109 | Close preview | q/Esc/Ctrl+C, Ctrl+W | 🟡 | local | r3/r3b: `q` and Esc close it and the terminal comes back; Ctrl+C/Ctrl+W are not bound (Ctrl+W is browser-reserved). |
| 110 | Open binary/image/audio/video/PDF in system app | o | ❌ | missing | Playwright: trigger 'o'; expect 'open binary/image/audio/video/PDF in system app' as in TUI. Currently absent (no bridge op yet). |
| 111 | Insert @path in engine input | Files `a` | ✅ | `term.input` | r3: `a` on README.md typed `@README.md ` into the attached session (checked via `rove api read-output`); with no session, a toast with the TUI's wording. |
| 112 | Ask agent to create PR | prefix p/P, Files chip | ✅ | `tab.requestPR` | r4c: chip delivers to the selected engine tab (live Codex got the create-PR prompt, shot r4c-02). r7: `ctrl+a p` runs the same request; the toast answers. |
| 113 | Move diff review line cursor | j/k, arrows | ✅ | local | r3: `j` walks the cursor to the first added row. |
| 114 | Anchor / cancel review range | v | ✅ | local | r3b: `v` + `j j` + `c` stores a note with `startLine` two lines above `line` (shot r3b-02). |
| 115 | Add per-file review note | c | ✅ | `review.add` | r3: the note lands in `state.json` `diffComments.<taskId>` (read back via `review.list`); the row gets the note marker (shot r3-04). |
| 116 | Drop note under cursor | x | ✅ | `review.remove` | r3: `x` removes it; `review.list` shrinks by one. |
| 117 | Send all unsent review notes | s | ✅ | `review.send` | r4c: `s` sent the notes to the live Codex tab (it answered `NOTED`), toast "sent 4 notes to the engine", every note got `sentAt` (`review.list`). Exited engine: refused, notes stay unsent (r3b). |

## Inbox, alerts and attention

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 118 | Open Inbox | prefix i, sidebar status click | ✅ | `tasks.subscribe` | r2: rail inbox chip. r7: `ctrl+a i` opens the same dialog from the terminal. |
| 119 | Navigate ATTENTION / RECENT rows | j/k, click | 🟡 | local | Built (↑/↓/j/k, hover); keys not exercised this round. |
| 120 | Open selected tab/task and clear episode | Enter, click | ✅ | `attention.dismiss`, `task.tabs` | r2: Enter on the first card opened that task (tab-strip title matched) and the ATTENTION count dropped by one. |
| 121 | Dismiss pending ATTENTION without opening | d | ✅ | `attention.dismiss` | r2: `d` dropped one pending card; rail count followed. |
| 122 | Open RECENT target | Enter, click | 🟡 | `task.get` | Built; RECENT rendered ("Renamed from web 1s"), opening one not exercised. |
| 123 | Jump / cycle pending across projects | F7 | ❌ | `attention.dismiss` | Playwright: trigger 'F7'; expect 'jump / cycle pending across projects' as in TUI. Currently absent (via attention.dismiss). |
| 124 | Open failed-routine attention target | Enter, click | ❌ | `attention.dismiss`, `routine.runs` | Playwright: trigger 'Enter'; expect 'open failed-routine attention target' as in TUI. Currently absent (via attention.dismiss, routine.runs). |
| 125 | Dismiss toast | toast click / timeout | 🟡 | local | r2: toasts (`copied …`) appear bottom-right and time out after 4 s; no click-to-dismiss. |
| — | Open a `report_missing` row (long-run controls stack #1247→#1249, unmerged) | Enter, click | 🟡 | `attention.dismiss` (`deliveryId`) | Not yet aligned: today Enter opens AND clears every row. After the stack lands, opening a `report_missing` row (keyed by delivery, `detail.deliveryId`) must NOT clear it; only a late report or an explicit `d` (`attention.dismiss {deliveryId}`) clears it, else a broken loop gets unblocked. Follow TUI `inbox-open-action.ts` and the phones' `InboxLogic.clearsOnVisit`. |
| — | Answer a `decision_needed` row (same stack, unmerged) | Enter | 🟡 | `gate.answer` (stack) | Not yet aligned: the row carries a `gateId` and cannot be dismissed (daemon: `GATE_NOT_DISMISSABLE`). Enter must open a decision dialog that calls `gate.answer`, not jump-and-clear; `d` must not be offered. |

## Kanban and local issue store

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 126 | Switch project | Tab, header click | ❌ | `issue.repos`, `issue.list` | Playwright: trigger 'Tab'; expect 'switch project' as in TUI. Currently absent (via issue.repos, issue.list). |
| 127 | Navigate cards / refresh | arrows, h/l, r | ❌ | `issue.list` | Playwright: trigger 'arrows'; expect 'navigate cards / refresh' as in TUI. Currently absent (via issue.list). |
| 128 | Open story drawer | Enter, card click | ❌ | `issue.list`, `task.events` | Playwright: trigger 'Enter'; expect 'open story drawer' as in TUI. Currently absent (via issue.list, task.events). |
| 129 | Create story | n, fill, Ctrl+S | ❌ | `issue.create` | Playwright: trigger 'n'; expect 'create story' as in TUI. Currently absent (via issue.create). |
| 130 | Create and immediately start story | n, Ctrl+Enter | ❌ | `issue.create`, `issue.prompt` | Playwright: trigger 'n'; expect 'create and immediately start story' as in TUI. Currently absent (via issue.create, issue.prompt). |
| 131 | Edit story title / body | drawer type, Esc saves | ❌ | `issue.update` | Playwright: trigger 'drawer type'; expect 'edit story title / body' as in TUI. Currently absent (via issue.update). |
| 132 | Change story status open/doing/hold/done | drawer Status, card menu | ❌ | `issue.setStatus` | Playwright: trigger 'drawer Status'; expect 'change story status open/doing/hold/done' as in TUI. Currently absent (via issue.setStatus). |
| 133 | Choose engine / workspace / follow or stay | drawer Tab, arrows, click | ❌ | local | Playwright: trigger 'drawer Tab'; expect 'choose engine / workspace / follow or stay' as in TUI. Currently absent (browser-local, no bridge call). |
| 134 | Start unlinked story session | drawer Ctrl+Enter | ❌ | `issue.prompt`, `task.create` | Playwright: trigger 'drawer Ctrl+Enter'; expect 'start unlinked story session' as in TUI. Currently absent (via issue.prompt, task.create). |
| 135 | Open linked story task | drawer action/Enter | ❌ | `task.get` | Playwright: trigger 'drawer action/Enter'; expect 'open linked story task' as in TUI. Currently absent (via task.get). |
| 136 | Unlink linked story | drawer unlink | ❌ | `issue.update` | Playwright: trigger 'drawer unlink'; expect 'unlink linked story' as in TUI. Currently absent (via issue.update). |
| 137 | Delete story only | `d` + confirm | ❌ | `issue.delete` | Playwright: trigger 'd + confirm'; expect 'delete story only' as in TUI. Currently absent (via issue.delete). |
| 138 | Paste attachment into story description | Ctrl+V / drop | ❌ | `attachment.put` | Playwright: trigger 'Ctrl+V / drop'; expect 'paste attachment into story description' as in TUI. Currently absent (via attachment.put). |

## Routines and external issues

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 139 | Select / refresh routines | j/k, r | ❌ | `routine.list` | Playwright: trigger 'j/k'; expect 'select / refresh routines' as in TUI. Currently absent (via routine.list). |
| 140 | Create routine | n, dialog | ❌ | `routine.create` | Playwright: trigger 'n'; expect 'create routine' as in TUI. Currently absent (via routine.create). |
| 141 | Pause / resume routine | e | ❌ | `routine.setEnabled` | Playwright: trigger 'e'; expect 'pause / resume routine' as in TUI. Currently absent (via routine.setEnabled). |
| 142 | Run routine now | s, Run now click | ❌ | `routine.runNow` | Playwright: trigger 's'; expect 'run routine now' as in TUI. Currently absent (via routine.runNow). |
| 143 | Delete routine | `d` + confirm | ❌ | `routine.delete` | Playwright: trigger 'd + confirm'; expect 'delete routine' as in TUI. Currently absent (via routine.delete). |
| 144 | Open latest routine run's task | Enter | ❌ | `routine.runs` | Playwright: trigger 'Enter'; expect 'open latest routine run's task' as in TUI. Currently absent (via routine.runs). |
| 145 | Select GitHub issue | j/k, ↑/↓ | ❌ | `workitem.list` | Playwright: trigger 'j/k'; expect 'select GitHub issue' as in TUI. Currently absent (via workitem.list). |
| 146 | Cycle issue repo / filter assigned to me / force refresh | Tab, a, r | ❌ | `workitem.list` | Playwright: trigger 'Tab'; expect 'cycle issue repo / filter assigned to me / force refresh' as in TUI. Currently absent (via workitem.list). |
| 147 | Start task from GitHub issue or open linked task | Enter | ❌ | `workitem.start`, `workitem.links` | Playwright: trigger 'Enter'; expect 'start task from GitHub issue or open linked task' as in TUI. Currently absent (via workitem.start, workitem.links). |

## Worktrees, releases and onboarding

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 148 | Navigate worktree audit | j/k, ↑/↓ | ✅ | `worktrees.list` | r8: `j`/`k` move the cursor over every worktree of every saved project, grouped by repo, with the TUI's badges (rove, dirty, dirty?, remote, verdict) and `created … ago` (TUI copy imported from `worktrees.ts`). |
| 149 | Land selected worktree | `l` + confirm | 🟡 | `task.land` | r8: `l` + confirm landed task `land-me` into main (`git log` shows `Land land-me`). Confirm body lacks the TUI's destination + commit count: no bridge op for `task.landPreflight`. |
| 150 | Remove worktree (force confirm if dirty) | `d` + confirm | ✅ | `worktrees.remove` | r8: `d` + confirm removed a clean worktree (dir gone); on a dirty one the daemon refuses, the page opens the TUI's force confirm with `Refused because: …` (shot r8-02), force removes it. |
| 151 | Check updates / release notes | Update page load | ✅ | `update.check` | me: the page reads current / latest; up to date → "No newer release — nothing to install."; newer (ROVE_FAKE_UPDATE=0.9.999) → latest in warning tone + `changes from v0.9.246 to v0.9.999` + notes or the notes-unavailable line. TUI copy imported from `update.ts`. |
| 152 | Select / execute Update action | j/k/Enter, `u`, `r` | ❌ | `update.check` | me: `j`/`k`/Enter, `r` (opens the GitHub release in a new tab) and `q` work as the TUI. `u` Update now is NOT offered: running the updater would replace the Mac's own Rove install from a remote client — an owner decision, not built. The page names `rove update` instead. |
| 153 | Scroll / dismiss What's New | ↑/↓, PgUp/PgDn, q/Esc | ✅ | `release.notes` | me: once per upgrade per browser (stamp `rove.whatsNewSeenVersion`, as `cli/whats-new.ts`'s `app.whatsNewSeenVersion`): stamp 0.9.240 → dialog `You're now on Rove v0.9.246, up from v0.9.240` with the GitHub notes (shot me-update-current-01); `q`/Esc dismiss; same build → not shown again. Scroll is the dialog's own. |
| 154 | Browse versions and install selected release | j/k, u/Enter | ❌ | missing | me: the Versions page is the standalone `rove versions` screen and its whole point is installing a chosen release — same owner decision as #152 (replacing the Mac's install from a browser). Not built. |
| 155 | Welcome quick start | click start | ❌ | `task.create` | Playwright: trigger 'click start'; expect 'welcome quick start' as in TUI. Currently absent (via task.create). |

## Settings, appearance, engines, plugins, keybinding preferences

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 156 | Select UI language | General: language | 🟡 | local | r6: General → 中文 switches the whole page (dialog title `设置`, rail `新建任务`) and back. Kept per browser (`localStorage rove.locale`); it does not change the TUI's language setting, nor read it. |
| 157 | Choose named theme | Appearance: Theme | ❌ | local | Playwright: trigger 'Appearance: Theme'; expect 'choose named theme' as in TUI. Currently absent (browser-local, no bridge call). |
| 158 | Choose dark / light / system appearance | Appearance: mode | ❌ | local | Playwright: trigger 'Appearance: mode'; expect 'choose dark / light / system appearance' as in TUI. Currently absent (browser-local, no bridge call). |
| 159 | Toggle background transparency | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'toggle background transparency' as in TUI. Currently absent (browser-local, no bridge call). |
| 160 | Choose focus accent color | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose focus accent color' as in TUI. Currently absent (browser-local, no bridge call). |
| 161 | Choose split border style | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose split border style' as in TUI. Currently absent (browser-local, no bridge call). |
| 162 | Choose folded rail style | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose folded rail style' as in TUI. Currently absent (browser-local, no bridge call). |
| 163 | Choose tab row height | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose tab row height' as in TUI. Currently absent (browser-local, no bridge call). |
| 164 | Choose animated / static working border | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose animated / static working border' as in TUI. Currently absent (browser-local, no bridge call). |
| 165 | Toggle task colors | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'toggle task colors' as in TUI. Currently absent (browser-local, no bridge call). |
| 166 | Choose glyph set | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose glyph set' as in TUI. Currently absent (browser-local, no bridge call). |
| 167 | Toggle colorblind mode | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'toggle colorblind mode' as in TUI. Currently absent (browser-local, no bridge call). |
| 168 | Choose shimmer / static running title | Appearance | ❌ | local | Playwright: trigger 'Appearance'; expect 'choose shimmer / static running title' as in TUI. Currently absent (browser-local, no bridge call). |
| 169 | Toggle notification toasts / sounds / cross-task alerts | General rows | ❌ | local | Playwright: trigger 'General rows'; expect 'toggle notification toasts / sounds / cross-task alerts' as in TUI. Currently absent (browser-local, no bridge call). |
| 170 | Cycle notification sound volume | General row | ❌ | local | Playwright: trigger 'General row'; expect 'cycle notification sound volume' as in TUI. Currently absent (browser-local, no bridge call). |
| 171 | Toggle keyboard footer hints | General row | ❌ | local | Playwright: trigger 'General row'; expect 'toggle keyboard footer hints' as in TUI. Currently absent (browser-local, no bridge call). |
| 172 | Choose default startup Zen | General row | ❌ | local | Playwright: trigger 'General row'; expect 'choose default startup Zen' as in TUI. Currently absent (browser-local, no bridge call). |
| 173 | Cycle editor kind / edit custom editor command | General rows | ❌ | local | Playwright: trigger 'General rows'; expect 'cycle editor kind / edit custom editor command' as in TUI. Currently absent (browser-local, no bridge call). |
| 174 | Cycle worktree location / edit custom base path | General rows | ❌ | missing | Playwright: trigger 'General rows'; expect 'cycle worktree location / edit custom base path' as in TUI. Currently absent (no bridge op yet). |
| 175 | Edit terminal scrollback capacity | General row | ❌ | local | Playwright: trigger 'General row'; expect 'edit terminal scrollback capacity' as in TUI. Currently absent (browser-local, no bridge call). |
| 176 | Cycle horizontal tab strip never/multiple/always | General row | ❌ | local | Playwright: trigger 'General row'; expect 'cycle horizontal tab strip never/multiple/always' as in TUI. Currently absent (browser-local, no bridge call). |
| 177 | Enable / disable engine | Engines: Space, checkbox | ✅ | `engine.setEnabled` | r6: the checkbox turned Copilot off then on; `engines.settings` read back `enabled` each time (state.json `disabledEngineIds`, as the TUI). No Space key: rows are form controls (Space toggles a focused checkbox natively). |
| 178 | Edit engine command | Engines: Enter | ❌ | missing | Playwright: trigger 'Engines: Enter'; expect 'edit engine command' as in TUI. Currently absent (no bridge op yet). |
| 179 | Rename engine display name | Engines: r | ✅ | `engine.rename` | r6: rename → "Codex Web"; `engines.settings` name matches (shot r6s-03). |
| 180 | Reset built-in engine / remove custom engine | Engines: x | 🟡 | `engine.reset` | r6: `reset` on the renamed Codex restored "Codex". Removing a custom engine not exercised: the sandbox has none. |
| 181 | Set default engine | Engines: d, radio | ✅ | `engine.setDefault` | r6: radio → Codex, then back to Claude; `defaultId` follows (shot r6s-02). |
| 182 | Add custom engine and protocol adapter | Add engine row | ❌ | missing | Playwright: trigger 'Add engine row'; expect 'add custom engine and protocol adapter' as in TUI. Currently absent (no bridge op yet). |
| 183 | Install / uninstall activity hooks | Engines trailing rows | ❌ | missing | Playwright: trigger 'Engines trailing rows'; expect 'install / uninstall activity hooks' as in TUI. Currently absent (no bridge op yet). |
| 184 | Edit auto-routing tier engine/model/effort | Auto routing tier row | ❌ | `engines.settings` | Playwright: trigger 'Auto routing tier row'; expect 'edit auto-routing tier engine/model/effort' as in TUI. Currently absent (via engines.settings). |
| 185 | Cycle classifier off/jev/custom | classifier row | ❌ | missing | Playwright: trigger 'classifier row'; expect 'cycle classifier off/jev/custom' as in TUI. Currently absent (no bridge op yet). |
| 186 | Edit classifier endpoint / threshold / API secret | Auto routing rows | ❌ | missing | Playwright: trigger 'Auto routing rows'; expect 'edit classifier endpoint / threshold / API secret' as in TUI. Currently absent (no bridge op yet). |
| 187 | Enable / disable registered plugin | Plugins toggle | 🟡 | `plugin.setEnabled` | r6: Plugins section lists the registry ("no plugins registered" in the sandbox); a toggle per plugin is built but no plugin exists to flip. |
| 188 | Edit manifest-defined plugin setting | plugin child row | ❌ | missing | Playwright: trigger 'plugin child row'; expect 'edit manifest-defined plugin setting' as in TUI. Currently absent (no bridge op yet). |
| 189 | Browse / install marketplace plugin | Marketplace row | ❌ | missing | Playwright: trigger 'Marketplace row'; expect 'browse / install marketplace plugin' as in TUI. Currently absent (no bridge op yet). |
| 190 | Create starter keybindings YAML | Keybindings: Create file | ❌ | missing | Playwright: trigger 'Keybindings: Create file'; expect 'create starter keybindings YAML' as in TUI. Currently absent (no bridge op yet). |
| 191 | Choose prefix-tap guide mode | Keybindings radio | ❌ | local | Playwright: trigger 'Keybindings radio'; expect 'choose prefix-tap guide mode' as in TUI. Currently absent (browser-local, no bridge call). |
| 192 | Edit direct/prefix/plugin shortcuts | external `~/.rove/settings/keybindings.yaml` | ❌ | missing | Playwright: trigger 'external ~/.rove/settings/keybindings.yaml'; expect 'edit direct/prefix/plugin shortcuts' as in TUI. Currently absent (no bridge op yet). |
| 193 | Invoke plugin pane/action via custom chord | user YAML plugin chord | ❌ | missing | Playwright: trigger 'user YAML plugin chord'; expect 'invoke plugin pane/action via custom chord' as in TUI. Currently absent (no bridge op yet). |
| 194 | Send feedback discussion | Feedback title/body, Send | 🟡 | `feedback.send` | r6: the form is built; Send stays disabled until title and body are set. Never sent in a check: it publishes a public GitHub Discussion. |
| 195 | Reset UI / task index | Dev: Reset + confirm | ❌ | missing | Playwright: trigger 'Dev: Reset + confirm'; expect 'reset UI / task index' as in TUI. Currently absent (no bridge op yet). |
| 196 | Restart backend / relaunch UI | Dev: Restart + confirm | ❌ | missing | Playwright: trigger 'Dev: Restart + confirm'; expect 'restart backend / relaunch UI' as in TUI. Currently absent (no bridge op yet). |
| 197 | Toggle experimental remote projects / auto status / dispatcher | Dev rows | ❌ | missing | Playwright: trigger 'Dev rows'; expect 'toggle experimental remote projects / auto status / dispatcher' as in TUI. Currently absent (no bridge op yet). |

## Machines and approval boundary

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 198 | View local/remote machine headers and stale state | sidebar machine section (read only) | ❌ | missing | Playwright: trigger 'sidebar machine section (read only)'; expect 'view local/remote machine headers and stale state' as in TUI. Currently absent (no bridge op yet). |
| 199 | Respond to engine permission/decision prompts | type/click in the engine terminal | ✅ | `term.input` | r2: a new Claude tab stopped on its folder-trust prompt; ArrowDown + Enter pressed in the web xterm picked "Yes, I trust this folder" and Claude started (screenshot r2-14). The Bash tool prompt was not reached: the sandbox Claude is not logged in. |

## Verified so far

Real browser (headed Chromium), real sandbox daemon, `rove --web`. Each write was checked through `rove api`, not through the page.

Round 1:

- **Open from printed link (web-only row)**: opened the printed `/#token=…` link (source run on :7979 and packaged `dist/cli/rove.js` on :7980); the task list loaded and `location.hash` was `""` after load.
- **See the task list (web-only row)**: the sandbox's three rows (main row `○`, two exited bash engines `!`) under the `rove-web-demo` project rule, each with its `engine` tab row; inbox count `2` matches the two pending attention rows. Compared with `docs/assets/workspace.png`: same rail grammar (project rule header, task row, indented tab rows, selection bar), quill colors instead of the terminal theme.
- **#26 Open task/tab**: clicked a task row, then a tab row; the terminal attached and showed the replayed output.

Round 2 (`.scratch/web/e2e-r2.ts`, `e2e-r2b.ts`, `e2e-perm.ts`; shots `r2-*`, `r2b-*`): #41, #44, #46–#49, #56, #67, #71, #120, #121, #199 at ✅; the 🟡 rows above say which half works. Compared with the TUI: the row menu carries the TUI's entries in `tree-menu.ts` order minus the ones the bridge cannot carry (New shell, Open in editor, Reorder, Run again, Fix checks, Sync base); the Inbox is a dialog like `AttentionInboxPane`, with its ATTENTION/RECENT sections and state words.

Round 3 (`.scratch/web/e2e-r3.ts`, `e2e-r3b.ts`; shots `r3-*`, `r3b-*`): #100–#104, #106–#108, #111, #113–#116 at ✅; #12, #105, #109, #112, #117 at 🟡. Compared with the TUI Files pane (`panes/filetree/header-view.tsx`, `preview-review.tsx`): same header (Zen, create-PR chip, All/Changes, scope line with `b to toggle`, status legend, `[D] diff everything`), same status letters and +/− chips, the diff as a `d <file>` tab next to the session tabs, same review keys and footer hints. Difference: Enter opens the diff, not the host editor.

Round 4 (`e2e-r4.ts`, `e2e-r4c.ts`; shots `r4-*`, `r4c-*`): #117 at ✅, #24 at 🟡, #112's delivery seen. Compared with the TUI footer (`host-footer.tsx`): same chip order (ctx, Σ, then per-engine quota), same text and tones, computed by the same `usage-core.ts`; the web keeps link state and host on the right where the TUI has key hints.

Round 5 (`e2e-r5.ts`; shots `r5-*`): #25, #27, #28, #30–#32, #35, #38–#40 at ✅; `n` and `d` added to #29, #51, #52. Compared with the TUI sidebar (`keybindings-sidebar.ts`, `use-tree-bindings.ts`, `chrome.tsx` `SidebarSearchInput`): same chords in the same scope, cursor separate from selection, `/ query█ n/m` search row, top match on every keystroke, project headers skipped. The row menu shows each entry's chord (`r` `P` `b` `v` `d`) as the TUI's does. Not mirrored: `s`/`x`/`u`/`q` (pages the web lacks yet), `o` (#34), `Shift+M` move mode (#36).

Round 6 (`e2e-r6t.ts`, `e2e-r6s.ts`; shots `r6t-*`, `r6s-*`): #42, #43, #177, #179, #181 at ✅; #15, #74, #85, #156, #180, #187, #194 moved. New: `rove api tab-new --kind shell|engine` and `tab.new` without a prompt (phones get it too). Compared with the TUI: the picker's chips are the TUI's engines plus `shell`; the shell tab is a `command` row with the login shell, labelled `shell` as the TUI's tab; Settings has the TUI's section names and order and its Engines row grammar (checkbox = offered, radio = default, binary · sign-in line).

Round 7 (`e2e-r7.ts`; shots `r7-*`, 13/13): the TUI prefix layer (`keymap-dispatch.ts`): `ctrl+a` arms from anywhere including the terminal, 5 s window, Esc cancels, a miss is swallowed and shown as `∅`, an open dialog blocks arming; the HUD sits bottom-left over the rail with the TUI's `keys.desc` labels (imported, not copied). Ctrl+A and the cancelled stroke never reached the shell (line `pfx-ok` intact). #12, #15, #29, #112, #118 at ✅; #9, #84 moved. Bug fixed: dialogs opened while xterm had focus could not close on Esc (xterm stops the key); dialogs now take focus on open.

Round 8 (`e2e-r8.ts`; shots `r8-*`): Worktrees page on the phones' existing `worktrees.list`/`worktrees.remove` (no bridge change), plus the direct tab chords (Ctrl+1..9, Ctrl+[ ], Ctrl+E, F2). #16, #73, #83, #86, #148, #150 at ✅; #19, #149 at 🟡. Compared with TUI `worktrees-page.tsx`: same grouping, row grammar (branch + badges, path + age), keys and confirms, same copy.

Update slice (`e2e-me-update.ts`, both `current` and `fake` modes, 8/8 and 5/5): new read-only bridge ops `update.check` / `release.notes` (`ops/update.ts`, documented in docs/IOS.md). #17, #151, #153 at ✅; #152, #154 ❌ (installing from a browser is an owner decision).

Screenshots are local only. Headless Chromium paints the WebGL terminal blank, so shots are taken headed (see MEMO).
