# Web parity with the TUI

Every user action the TUI offers (199 numbered rows, plus two web-only entries marked `—`), and whether `packages/rove-web` does it yet.
Legend: ✅ same as TUI · 🟡 partial or different · ❌ missing (unbuilt) · 🚫 cannot exist in a browser. `Bridge` names the op that would carry the action: `missing` = no op exists, `local` = pure UI.
A row is verified with Playwright (headed Chromium) against `rove --web` on a real sandbox daemon. Screenshots stay local in `.scratch/web/shots` (not in git); the comparison text lives in the row.
Browser-reserved chords (Ctrl+W, Ctrl+T, Ctrl+Q, Ctrl+N) cannot be used on the web: each such row needs a different PROPOSED chord, which needs owner sign-off (docs/KEYBINDINGS.md).

Score: 15 / 201 rows at ✅ (22 🟡, 2 🚫, 162 ❌)

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
| 9 | Focus previous/next pane | prefix h/l, F4 | ❌ | local | Playwright: trigger 'prefix h/l'; expect 'focus previous/next pane' as in TUI. Currently absent (browser-local, no bridge call). |
| 10 | Return to Tasks, then quit | Ctrl+Q (browser-reserved: web needs a PROPOSED chord, owner sign-off per docs/KEYBINDINGS.md) | ❌ | local | Playwright: trigger 'Ctrl+Q (browser-reserved: web needs a PROPOSED chord'; expect 'return to Tasks, then quit' as in TUI. Currently absent (browser-local, no bridge call). |
| 11 | Quit with confirmation | sidebar `q` | ❌ | local | Playwright: trigger 'sidebar q'; expect 'quit with confirmation' as in TUI. Currently absent (browser-local, no bridge call). |
| 12 | Zen: toggle Files visibility | prefix z, Files chip | ❌ | local | Playwright: trigger 'prefix z'; expect 'zen: toggle Files visibility' as in TUI. Currently absent (browser-local, no bridge call). |
| 13 | Redraw corrupted screen | prefix r | 🚫 | local | Cannot exist: a browser canvas has no corrupted terminal screen to erase; xterm repaints itself. |
| 14 | Refresh daemon/TUI build (restart daemon + relaunch) | prefix r when DAEMON OUT OF DATE, confirm | ❌ | missing | Playwright: trigger 'prefix r when DAEMON OUT OF DATE'; expect 'refresh daemon/TUI build (restart daemon + relaunch)' as in TUI. Currently absent (no bridge op yet). |
| 15 | Open Settings | prefix `,`, sidebar `s`, footer click | ❌ | local | Playwright: trigger 'prefix'; expect 'open Settings' as in TUI. Currently absent (browser-local, no bridge call). |
| 16 | Open Worktrees | sidebar `x` | ❌ | `worktrees.list` | Playwright: trigger 'sidebar x'; expect 'open Worktrees' as in TUI. Currently absent (via worktrees.list). |
| 17 | Open Update | sidebar `u`, update chip | ❌ | missing | Playwright: trigger 'sidebar u'; expect 'open Update' as in TUI. Currently absent (no bridge op yet). |
| 18 | Open Kanban / Routines / GitHub Issues | prefix 1/2/3, rail click | ❌ | `issue.repos`, `issue.list`, `routine.list`, `workitem.list` | Playwright: trigger 'prefix 1/2/3'; expect 'open Kanban / Routines / GitHub Issues' as in TUI. Currently absent (via issue.repos, issue.list, routine.list, workitem.list). |
| 19 | Close current page | `q`/Esc/Ctrl+C | ❌ | local | Playwright: trigger 'q/Esc/Ctrl+C'; expect 'close current page' as in TUI. Currently absent (browser-local, no bridge call). |
| 20 | Drag Tasks rail width / reset auto width | edge drag / double click | ❌ | local | Playwright: trigger 'edge drag / double click'; expect 'drag Tasks rail width / reset auto width' as in TUI. Currently absent (browser-local, no bridge call). |
| 21 | Toggle collapsed Tasks rail | fold control click | ❌ | local | Playwright: trigger 'fold control click'; expect 'toggle collapsed Tasks rail' as in TUI. Currently absent (browser-local, no bridge call). |
| 22 | Narrow layout: return to Tasks | click ‹ Tasks, Ctrl+Q | ❌ | local | Playwright: trigger 'click ‹ Tasks'; expect 'narrow layout: return to Tasks' as in TUI. Currently absent (browser-local, no bridge call). |
| 23 | Footer shortcut hints | click commands/sidebar/help/Settings hint | ❌ | local | Playwright: trigger 'click commands/sidebar/help/Settings hint'; expect 'footer shortcut hints' as in TUI. Currently absent (browser-local, no bridge call). |
| 24 | Observe quotas / context / token usage in footer | footer (read only) | ❌ | `usage.get` | Playwright: trigger 'footer (read only)'; expect 'observe quotas / context / token usage in footer' as in TUI. Currently absent (via usage.get). |
| — | Open the web client from the printed link (token in fragment, stripped from the address bar) | `rove --web` printed link | ✅ | `hello` | Run `rove --web`, open the printed link (`/#token=…`): the task list loads and `location.hash` is empty after load. |

## Sidebar, task list, project context menu

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| — | See the task list: projects → tasks → tabs, with the TUI's status marks (`?` `!` `●` `○` spinner) and `+N` / `−N` / `↑N` / PR / pinned marks | always visible | ✅ | `tasks.subscribe`, `task.tabs` | Open the page: rows match `rove api list` for the sandbox; glyphs follow `tui/panes/sidebar/row-view.ts` (`!` for the two exited engines, `○` for the quiet main row). |
| 25 | Navigate rows with keyboard | j/k, ↑/↓ (click is #26) | ❌ | local | Playwright: trigger 'j/k'; expect 'navigate rows with keyboard' as in TUI. Currently absent (browser-local, no bridge call). |
| 26 | Open task / tab / recent task | Enter, l/Space, click | ✅ | `tasks.list`, `task.tabs`, `term.attach` | Open the page, click a task row, then a tab row under it: the terminal pane attaches and shows the tab's replayed output. Keyboard j/k/Enter is not built (#25). |
| 27 | Jump to top / bottom | gg / Shift+G | ❌ | local | Playwright: trigger 'gg / Shift+G'; expect 'jump to top / bottom' as in TUI. Currently absent (browser-local, no bridge call). |
| 28 | Focus engine from sidebar | → | ❌ | local | Playwright: trigger '→'; expect 'focus engine from sidebar' as in TUI. Currently absent (browser-local, no bridge call). |
| 29 | Start new task (browser-reserved Ctrl+N is not usable; PROPOSED chord needs owner sign-off) | n, prefix n, New task click, project menu | 🟡 | `task.spawn` | r2: rail `+ New task` and project-header menu open the dialog; created "Web created task", `rove api list` lists it and the page selected it. `n` / prefix n not on the web. |
| 30 | Rename task | r, row menu | 🟡 | `task.rename` | r2: row menu Rename → "Renamed from web"; `rove api list` shows the new title. `r` key not on the web. |
| 31 | Rename branch | b, row menu (managed branch) | 🟡 | `task.setBranch` | r2: row menu Rename branch → `audit-token-refresh-web`; `rove api list` shows it. `b` key not on the web. |
| 32 | Cycle task engine | v | ❌ | `task.setCommand` | Playwright: trigger 'v'; expect 'cycle task engine' as in TUI. Currently absent (via task.setCommand). |
| 33 | Pick task engine / model / effort | row menu Change engine | 🟡 | `engines.list`, `task.setCommand`, `task.setModel`, `task.setEffort` | r2: row menu Change engine → Claude; `get-task` vendor `claude`. Engine only; no model/effort step yet. |
| 34 | Open task directory in GUI editor | o, prefix o, row menu | 🚫 | missing | Cannot exist: a page cannot launch a local GUI editor and the bridge has no op for it. |
| 35 | Pin / unpin managed task | Shift+P, menu | 🟡 | `task.pin` | r2: row menu Pin → `pinned: true` in `rove api list`, `▴` drawn. Shift+P not on the web. |
| 36 | Reorder sibling tab/task/project | Shift+M, prefix m, menu | ❌ | `task.move` | Playwright: trigger 'Shift+M'; expect 'reorder sibling tab/task/project' as in TUI. Currently absent (via task.move). |
| 37 | Move project to top | project header menu | ❌ | `task.move` | Playwright: trigger 'project header menu'; expect 'move project to top' as in TUI. Currently absent (via task.move). |
| 38 | Change task sort (default/recent/attention/name) | t | ❌ | local | Playwright: trigger 't'; expect 'change task sort (default/recent/attention/name)' as in TUI. Currently absent (browser-local, no bridge call). |
| 39 | Fuzzy search titles/repo/branch/tab | `/` | ❌ | local | Playwright: trigger '/'; expect 'fuzzy search titles/repo/branch/tab' as in TUI. Currently absent (browser-local, no bridge call). |
| 40 | Search result navigate / accept / cancel | ↑/↓, Enter, Esc | ❌ | local | Playwright: trigger '↑/↓'; expect 'search result navigate / accept / cancel' as in TUI. Currently absent (browser-local, no bridge call). |
| 41 | Open / dismiss right-click task menu | right click, Esc | ✅ | local | r2: right click on task, tab and tab-strip rows opens the menu at the pointer with the TUI's entries in its order; Esc and an outside click dismiss it (`.menu` gone). |
| 42 | New conversation on a row | row menu | 🟡 | `tab.new` | r2: menu → picker → Claude + first message → tab `2 Claude` appears and attaches. Differs: the bridge opens a tab by delivering a message, so the web needs a first message; the TUI picker does not. |
| 43 | New shell on a row | row menu | ❌ | missing | `tab.new` only starts engines; `pane-open` needs an attached TUI to perform it. Needs a bridge/daemon op that opens a hosted shell tab. |
| 44 | Close selected tab | tab row menu | ✅ | `tab.close` | r2: tab menu Close tab → confirm → tab count drops by one; `get-task` no longer lists it. Close latency 1–20 s (daemon-side), button shows busy meanwhile. |
| 45 | Run stored brief again as a new task | row menu + confirm | ❌ | `task.create`, `task.spawn` | Playwright: trigger 'row menu + confirm'; expect 'run stored brief again as a new task' as in TUI. Currently absent (via task.create, task.spawn). |
| 46 | Set task board status | row menu | ✅ | `task.setStatus` | r2: menu Set status → In review; `rove api list` status `in_review`. Menu-only in the TUI too. |
| 47 | Copy task id | row menu | ✅ | local | r2: clipboard equals the task id from `rove api list`; toast `copied …`. |
| 48 | Copy branch name | row menu | ✅ | local | r2: clipboard equals `branch` from `rove api list`. |
| 49 | Copy worktree path | row menu | ✅ | `task.get` | r2: clipboard equals `worktreePath` from `rove api list`. |
| 50 | Forget project checkout | project menu, `d` on main + confirm | ❌ | `project.forget` | Playwright: trigger 'project menu'; expect 'forget project checkout' as in TUI. Currently absent (via project.forget). |
| 51 | Delete directory task record | `d`/menu + confirm | 🟡 | `task.delete` | Menu + confirm built (same flow as #52, dir wording); no dir task in the sandbox yet. `d` key not on the web. |
| 52 | Delete managed task / worktree (force confirm when dirty) | `d`/menu + confirm | 🟡 | `task.delete` | r2: menu Delete → confirm → task gone from `rove api list`. Dirty → force escalation built, not exercised. `d` key not on the web. |
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
| 73 | Open new conversation picker | Ctrl+E | 🟡 | `engines.list` | r2: `+`, row menu, and the empty pane's button open it. Ctrl+E not on the web. |
| 74 | Choose engine / shell / plugin pane | picker ←/→, Enter, click | 🟡 | `tab.new` | r2: engine chips by click; no shell (#43) or plugin pane, no ←/→. |
| 75 | Pick destination tab / fork / scratch | picker Tab/chips | ❌ | `tab.forkTask` | Playwright: trigger 'picker Tab/chips'; expect 'pick destination tab / fork / scratch' as in TUI. Currently absent (via tab.forkTask). |
| 76 | Pick fresh / continue chat | picker Ctrl+F | ❌ | `tab.handoff` | Playwright: trigger 'picker Ctrl+F'; expect 'pick fresh / continue chat' as in TUI. Currently absent (via tab.handoff). |
| 77 | Continue chat in same worktree new tab | prefix c | ❌ | `tab.handoff` | Playwright: trigger 'prefix c'; expect 'continue chat in same worktree new tab' as in TUI. Currently absent (via tab.handoff). |
| 78 | Fork child task from current branch | prefix f | ❌ | `tab.forkTask` | Playwright: trigger 'prefix f'; expect 'fork child task from current branch' as in TUI. Currently absent (via tab.forkTask). |
| 79 | Edit fork prompt / branch / engine / attempts 1–5 | composer Tab, Ctrl+E, ←/→, Enter | ❌ | local | Playwright: trigger 'composer Tab'; expect 'edit fork prompt / branch / engine / attempts 1–5' as in TUI. Currently absent (browser-local, no bridge call). |
| 80 | Fan out fork attempts | composer attempts >1, submit | ❌ | `task.spawn` | Playwright: trigger 'composer attempts >1'; expect 'fan out fork attempts' as in TUI. Currently absent (via task.spawn). |
| 81 | Attach / drop / paste image or PDF in composer | drop, Ctrl+V, Ctrl+X | ❌ | `attachment.put` | Playwright: trigger 'drop'; expect 'attach / drop / paste image or PDF in composer' as in TUI. Currently absent (via attachment.put). |
| 82 | New Scratch task / shell | picker Scratch | ❌ | `task.create`, `tab.new` | Playwright: trigger 'picker Scratch'; expect 'new Scratch task / shell' as in TUI. Currently absent (via task.create, tab.new). |
| 83 | Click tab / previous / next / jump N | tab strip click, Ctrl+[ / Ctrl+], Ctrl+1..9 | 🟡 | local | Click each tab in the strip: active terminal switches. Ctrl+1..9 / Ctrl+[ / Ctrl+] not wired: press Ctrl+2 and nothing changes. |
| 84 | Close active tab (browser-reserved Ctrl+W; PROPOSED chord needs owner sign-off) | Ctrl+W, prefix w, row menu | 🟡 | `tab.close` | r2: via the tab's right-click menu (#44). No chord. |
| 85 | Reopen empty task session | Enter/Ctrl+E in empty pane | 🟡 | `tab.new` | r2: empty pane shows `New conversation`; needs a first message (#42). No Enter/Ctrl+E. |
| 86 | Rename tab | F2 | ❌ | `tab.rename` | Playwright: trigger 'F2'; expect 'rename tab' as in TUI. Currently absent (via tab.rename). |
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
| 100 | All / Changes tab | `[` / `]`, header click | ❌ | `diff.files`, `files.list` | Playwright: trigger '[ / ]'; expect 'all / Changes tab' as in TUI. Currently absent (via diff.files, files.list). |
| 101 | Navigate files | j/k, ↑/↓, click | ❌ | local | Playwright: trigger 'j/k'; expect 'navigate files' as in TUI. Currently absent (browser-local, no bridge call). |
| 102 | Collapse / expand tree | h/l, ←/→, click dir | ❌ | local | Playwright: trigger 'h/l'; expect 'collapse / expand tree' as in TUI. Currently absent (browser-local, no bridge call). |
| 103 | Toggle Changes working / branch scope | b | ❌ | `diff.files` | Playwright: trigger 'b'; expect 'toggle Changes working / branch scope' as in TUI. Currently absent (via diff.files). |
| 104 | Refresh file list | r | ❌ | `diff.files`, `files.list` | Playwright: trigger 'r'; expect 'refresh file list' as in TUI. Currently absent (via diff.files, files.list). |
| 105 | Open file in configured editor / diff editor | Enter, click | ❌ | missing | Playwright: trigger 'Enter'; expect 'open file in configured editor / diff editor' as in TUI. Currently absent (no bridge op yet). |
| 106 | Open file/directory read-only diff tab | d | ❌ | `diff.file` | Playwright: trigger 'd'; expect 'open file/directory read-only diff tab' as in TUI. Currently absent (via diff.file). |
| 107 | Open whole-worktree combined diff | Shift+D, [D] click | ❌ | `diff.file` | Playwright: trigger 'Shift+D'; expect 'open whole-worktree combined diff' as in TUI. Currently absent (via diff.file). |
| 108 | Reload preview / diff | r | ❌ | `diff.file` | Playwright: trigger 'r'; expect 'reload preview / diff' as in TUI. Currently absent (via diff.file). |
| 109 | Close preview | q/Esc/Ctrl+C, Ctrl+W | ❌ | local | Playwright: trigger 'q/Esc/Ctrl+C'; expect 'close preview' as in TUI. Currently absent (browser-local, no bridge call). |
| 110 | Open binary/image/audio/video/PDF in system app | o | ❌ | missing | Playwright: trigger 'o'; expect 'open binary/image/audio/video/PDF in system app' as in TUI. Currently absent (no bridge op yet). |
| 111 | Insert @path in engine input | Files `a` | ❌ | `term.input` | Playwright: trigger 'Files a'; expect 'insert @path in engine input' as in TUI. Currently absent (via term.input). |
| 112 | Ask agent to create PR | prefix p/P, Files chip | ❌ | `tab.requestPR` | Playwright: trigger 'prefix p/P'; expect 'ask agent to create PR' as in TUI. Currently absent (via tab.requestPR). |
| 113 | Move diff review line cursor | j/k, arrows | ❌ | local | Playwright: trigger 'j/k'; expect 'move diff review line cursor' as in TUI. Currently absent (browser-local, no bridge call). |
| 114 | Anchor / cancel review range | v | ❌ | local | Playwright: trigger 'v'; expect 'anchor / cancel review range' as in TUI. Currently absent (browser-local, no bridge call). |
| 115 | Add per-file review note | c | ❌ | `review.add` | Playwright: trigger 'c'; expect 'add per-file review note' as in TUI. Currently absent (via review.add). |
| 116 | Drop note under cursor | x | ❌ | `review.remove` | Playwright: trigger 'x'; expect 'drop note under cursor' as in TUI. Currently absent (via review.remove). |
| 117 | Send all unsent review notes | s | ❌ | `review.send` | Playwright: trigger 's'; expect 'send all unsent review notes' as in TUI. Currently absent (via review.send). |

## Inbox, alerts and attention

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 118 | Open Inbox | prefix i, sidebar status click | 🟡 | `tasks.subscribe` | r2: click on the rail's inbox chip; prefix i not on the web. Dialog: ATTENTION from the daemon, RECENT from this browser's visits, TUI glyph/state words (`† engine exited`). |
| 119 | Navigate ATTENTION / RECENT rows | j/k, click | 🟡 | local | Built (↑/↓/j/k, hover); keys not exercised this round. |
| 120 | Open selected tab/task and clear episode | Enter, click | ✅ | `attention.dismiss`, `task.tabs` | r2: Enter on the first card opened that task (tab-strip title matched) and the ATTENTION count dropped by one. |
| 121 | Dismiss pending ATTENTION without opening | d | ✅ | `attention.dismiss` | r2: `d` dropped one pending card; rail count followed. |
| 122 | Open RECENT target | Enter, click | 🟡 | `task.get` | Built; RECENT rendered ("Renamed from web 1s"), opening one not exercised. |
| 123 | Jump / cycle pending across projects | F7 | ❌ | `attention.dismiss` | Playwright: trigger 'F7'; expect 'jump / cycle pending across projects' as in TUI. Currently absent (via attention.dismiss). |
| 124 | Open failed-routine attention target | Enter, click | ❌ | `attention.dismiss`, `routine.runs` | Playwright: trigger 'Enter'; expect 'open failed-routine attention target' as in TUI. Currently absent (via attention.dismiss, routine.runs). |
| 125 | Dismiss toast | toast click / timeout | 🟡 | local | r2: toasts (`copied …`) appear bottom-right and time out after 4 s; no click-to-dismiss. |

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
| 148 | Navigate worktree audit | j/k, ↑/↓ | ❌ | `worktrees.list` | Playwright: trigger 'j/k'; expect 'navigate worktree audit' as in TUI. Currently absent (via worktrees.list). |
| 149 | Land selected worktree | `l` + confirm | ❌ | `task.land` | Playwright: trigger 'l + confirm'; expect 'land selected worktree' as in TUI. Currently absent (via task.land). |
| 150 | Remove worktree (force confirm if dirty) | `d` + confirm | ❌ | `worktrees.remove` | Playwright: trigger 'd + confirm'; expect 'remove worktree (force confirm if dirty)' as in TUI. Currently absent (via worktrees.remove). |
| 151 | Check updates / release notes | Update page load | ❌ | missing | Playwright: trigger 'Update page load'; expect 'check updates / release notes' as in TUI. Currently absent (no bridge op yet). |
| 152 | Select / execute Update action | j/k/Enter, `u`, `r` | ❌ | missing | Playwright: trigger 'j/k/Enter'; expect 'select / execute Update action' as in TUI. Currently absent (no bridge op yet). |
| 153 | Scroll / dismiss What's New | ↑/↓, PgUp/PgDn, q/Esc | ❌ | local | Playwright: trigger '↑/↓'; expect 'scroll / dismiss What's New' as in TUI. Currently absent (browser-local, no bridge call). |
| 154 | Browse versions and install selected release | j/k, u/Enter | ❌ | missing | Playwright: trigger 'j/k'; expect 'browse versions and install selected release' as in TUI. Currently absent (no bridge op yet). |
| 155 | Welcome quick start | click start | ❌ | `task.create` | Playwright: trigger 'click start'; expect 'welcome quick start' as in TUI. Currently absent (via task.create). |

## Settings, appearance, engines, plugins, keybinding preferences

| # | Action | TUI trigger | Web | Bridge | Verify |
|---|---|---|---|---|---|
| 156 | Select UI language | General: language | ❌ | local | Playwright: trigger 'General: language'; expect 'select UI language' as in TUI. Currently absent (browser-local, no bridge call). |
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
| 177 | Enable / disable engine | Engines: Space, checkbox | ❌ | `engine.setEnabled` | Playwright: trigger 'Engines: Space'; expect 'enable / disable engine' as in TUI. Currently absent (via engine.setEnabled). |
| 178 | Edit engine command | Engines: Enter | ❌ | missing | Playwright: trigger 'Engines: Enter'; expect 'edit engine command' as in TUI. Currently absent (no bridge op yet). |
| 179 | Rename engine display name | Engines: r | ❌ | `engine.rename` | Playwright: trigger 'Engines: r'; expect 'rename engine display name' as in TUI. Currently absent (via engine.rename). |
| 180 | Reset built-in engine / remove custom engine | Engines: x | ❌ | `engine.reset` | Playwright: trigger 'Engines: x'; expect 'reset built-in engine / remove custom engine' as in TUI. Currently absent (via engine.reset). |
| 181 | Set default engine | Engines: d, radio | ❌ | `engine.setDefault` | Playwright: trigger 'Engines: d'; expect 'set default engine' as in TUI. Currently absent (via engine.setDefault). |
| 182 | Add custom engine and protocol adapter | Add engine row | ❌ | missing | Playwright: trigger 'Add engine row'; expect 'add custom engine and protocol adapter' as in TUI. Currently absent (no bridge op yet). |
| 183 | Install / uninstall activity hooks | Engines trailing rows | ❌ | missing | Playwright: trigger 'Engines trailing rows'; expect 'install / uninstall activity hooks' as in TUI. Currently absent (no bridge op yet). |
| 184 | Edit auto-routing tier engine/model/effort | Auto routing tier row | ❌ | `engines.settings` | Playwright: trigger 'Auto routing tier row'; expect 'edit auto-routing tier engine/model/effort' as in TUI. Currently absent (via engines.settings). |
| 185 | Cycle classifier off/jev/custom | classifier row | ❌ | missing | Playwright: trigger 'classifier row'; expect 'cycle classifier off/jev/custom' as in TUI. Currently absent (no bridge op yet). |
| 186 | Edit classifier endpoint / threshold / API secret | Auto routing rows | ❌ | missing | Playwright: trigger 'Auto routing rows'; expect 'edit classifier endpoint / threshold / API secret' as in TUI. Currently absent (no bridge op yet). |
| 187 | Enable / disable registered plugin | Plugins toggle | ❌ | `plugin.setEnabled` | Playwright: trigger 'Plugins toggle'; expect 'enable / disable registered plugin' as in TUI. Currently absent (via plugin.setEnabled). |
| 188 | Edit manifest-defined plugin setting | plugin child row | ❌ | missing | Playwright: trigger 'plugin child row'; expect 'edit manifest-defined plugin setting' as in TUI. Currently absent (no bridge op yet). |
| 189 | Browse / install marketplace plugin | Marketplace row | ❌ | missing | Playwright: trigger 'Marketplace row'; expect 'browse / install marketplace plugin' as in TUI. Currently absent (no bridge op yet). |
| 190 | Create starter keybindings YAML | Keybindings: Create file | ❌ | missing | Playwright: trigger 'Keybindings: Create file'; expect 'create starter keybindings YAML' as in TUI. Currently absent (no bridge op yet). |
| 191 | Choose prefix-tap guide mode | Keybindings radio | ❌ | local | Playwright: trigger 'Keybindings radio'; expect 'choose prefix-tap guide mode' as in TUI. Currently absent (browser-local, no bridge call). |
| 192 | Edit direct/prefix/plugin shortcuts | external `~/.rove/settings/keybindings.yaml` | ❌ | missing | Playwright: trigger 'external ~/.rove/settings/keybindings.yaml'; expect 'edit direct/prefix/plugin shortcuts' as in TUI. Currently absent (no bridge op yet). |
| 193 | Invoke plugin pane/action via custom chord | user YAML plugin chord | ❌ | missing | Playwright: trigger 'user YAML plugin chord'; expect 'invoke plugin pane/action via custom chord' as in TUI. Currently absent (no bridge op yet). |
| 194 | Send feedback discussion | Feedback title/body, Send | ❌ | `feedback.send` | Playwright: trigger 'Feedback title/body'; expect 'send feedback discussion' as in TUI. Currently absent (via feedback.send). |
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

Screenshots are local only. Headless Chromium paints the WebGL terminal blank, so shots are taken headed (see MEMO).
