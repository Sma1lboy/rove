# Web client: working memo

Decisions and traps for whoever runs the next round. Coverage lives in
[PARITY.md](PARITY.md); user docs in [../WEB.md](../WEB.md).

## Why it looks like this

- **Not the old dashboard.** PR #855 removed `rove web` (a second UI with its
  own daemon HTTP/SSE). The lessons kept: no daemon HTTP, no web-only path to
  an op, and every socket needs the token, including ones with no `Origin`
  (the hole the old PTY sidecar had). Nothing from before #855 was reused.
- **Third bridge client.** `rove --web` = `runBridge()` from `rove-bridge`
  with a `web` root. Any capability the page needs is a bridge op, so iOS and
  Android can use it too. The phone `Authorization` path is unchanged.
- **Token transport.** Link `/#token=…` (fragment never sent). `auth.ts` is
  the first import in `main.tsx`; it stores the token in `localStorage` and
  strips the hash. The socket offers `["rove.v1", "rove.bearer.<token>"]`; the
  server echoes `rove.v1` only (a browser drops a socket without an echo).
- **Origin check.** Present `Origin` must equal `Host`, otherwise 403. Absent
  `Origin` (phones) still needs the token.
- **Static files sit before the token check** (the page can't hold a token
  before it loads); CF Access still runs first. Strict CSP, traversal refused,
  SPA fallback except under `/assets/`.
- **Port.** Default 7878, the same as the phone bridge, with the same token
  file. If a phone bridge already holds the port, `rove --web` exits with an
  "already in use" line; pass `--port`.
- **Packaging.** `rove-bridge` is a private workspace package bundled into the
  rove CLI the way `rove-weixin` is (devDependency + lazy import). `rove-web`
  is built by `packages/rove/scripts/build.ts` into `dist/web`; `web-cmd.ts`
  looks there, then at `packages/rove-web/dist` for source runs. The compiled
  standalone binary has neither and says so.
- **Look.** quill tokens, mono for structure, system face for titles. Layout
  mirrors the TUI: Tasks rail | workspace, footer across. Colours come from
  the TUI's own prefs: `prefs.get` resolves each TUI theme to `#rrggbb` per
  slot, `prefs-theme.ts` maps the chosen theme's dark or light half onto the
  `:root` tokens (`auto` follows the browser's colour scheme, as the TUI
  follows the terminal's), and `prefs-apply.ts` paints them and re-reads on
  connect and window focus, so a change made in the TUI shows up here.
- **i18n.** `src/i18n/{en,zh}.ts`, English is the source of truth like the
  TUI catalog; `test/web.test.ts` checks key and placeholder parity. The
  locale is the TUI's `locale` setting from bridge prefs (`prefs.ts` keeps
  `i18n/index.ts` in step); the browser language is only the first-load
  guess before any prefs reply was cached.
- **Shared PTY size.** The page resizes the session to its own grid, as the
  phones do. The TUI redraws at that size while the page is open. Open.
- **xterm colours** come from the same palette (`xtermTheme`, published as
  `terminalTheme`); `term-mount.ts`'s built-in dark `XTERM_THEME` only shows
  until the first prefs reply.

## How to verify a round

1. Sandbox home, never `~/.rove`: `bun .scratch/web/sbx.ts <cmd>` runs a
   command with the `named/web` dev-sandbox home.
2. Demo repo `/tmp/rove-web-demo`; tasks via
   `sbx … rove api add --repo /tmp/rove-web-demo --command bash --prompt …`
   (the generic engine exits and leaves a live `sh`, a real hosted PTY that
   costs no tokens).
3. `sbx … bun src/cli/rove.ts --web --port 7979` (source) and
   `sbx … node dist/cli/rove.js --web --port 7980` after `bun run build`
   (packaged).
4. `HEADED=1 bun .scratch/web/e2e.ts <link> <prefix> [task title]`, then look
   at `.scratch/web/shots/<prefix>-*.png`. Cross-check terminal input with
   `rove api read-output --source terminal`.

Round 2 scripts: `e2e-r2.ts <link> [create,menu,inbox,chat,close,delete]`,
`e2e-r2b.ts` (copies, rename branch, engine, Esc paths, Inbox Enter),
`e2e-perm.ts` (keys into an engine prompt), `op.ts <port> <token> <op> <json>`
(one bridge op, timed, over the real socket: separates page bugs from
bridge/daemon latency). Each write is checked through `rove api`, never
through the page. Wait for a dialog to close, not a fixed delay:
`task.setCommand` takes ~3 s, `tab.close` 1–20 s.

**Headless Chromium paints the WebGL terminal blank in screenshots.** The
page is fine (the DOM renderer and headed Chromium both show the session).
Always screenshot headed. Cost one round of three wrong fixes.

## Round log

- **Round 1** (branch `fix/hermes-web-goal-loop-tui`): `rove --web`, bridge
  browser auth + static serving, rail, tab strip, terminal attach/type/resize,
  status footer, connect screen. TUI comparison against
  `docs/assets/workspace.png`: same three-region grammar (rail with project
  rule headers and per-tab rows, bordered workspace, footer); the web has no
  Files column and no footer usage/commands yet. Next: a harness capture of
  the same sandbox for side-by-side shots. At this round light mode, theme
  choice and the locale were not wired: the page used the dark `claude`
  tokens, followed the browser's language, and its xterm theme was a copy of
  `rove-harness`'s.
- **Round 2** (branch `web/round-2`, stacked on round 1): right-click menus
  on project/task/tab rows in `tree-menu.ts` order, new-task dialog
  (`task.spawn`), new-conversation picker (`tab.new`), close tab, rename,
  rename branch, pin, set status, change engine, copy id/branch/path, land
  and delete with confirms (force escalation on `DIRTY`), the Inbox dialog
  (ATTENTION + RECENT, Enter / `d`), toasts. #199 answered for real: Claude's
  folder-trust prompt, from the web xterm.
  - Menus leave out what the bridge cannot carry instead of showing dead
    entries (TUI rule: "no entry beats a dead entry").
  - The Inbox is a dialog, as in the TUI. RECENT is this browser's own visit
    list (localStorage), as the TUI keeps its own.
  - Keyboard chords are absent on purpose: every web chord is a PROPOSED
    binding needing owner sign-off, and Ctrl+W/T/N/Q are the browser's.
    Rows with a working click path and no chord stay 🟡.
  - Bridge gaps found: no way to open a hosted shell tab (`pane-open` needs an
    attached TUI), and `tab.new` requires a first message where the TUI
    picker starts an engine empty. Both need a bridge op that the phones
    would also use.
- **Round 3** (branch `web/round-3`, stacked on round 2): the Files pane
  (All tree / Changes with working ↔ branch scope, `[` `]` `j` `k` `h` `l`
  `b` `r` `d` `Shift+D` `a`), the read-only diff opened as a tab in the strip
  (old/new gutters), line review notes (`j/k`, `v` range, `c`, `x`, `s`, `r`,
  `q`/Esc) stored in the TUI's own `diffComments.<taskId>`, Zen and the
  create-PR chip. Scripts: `e2e-r3.ts`, `e2e-r3b.ts` (shots `r3-*`, `r3b-*`).
  - Notes anchor to the gutter's display line (new-file number for
    added/context rows, old-file number for removed), the TUI's
    `DiffComment.line` contract; `diff.ts` is unit-tested on that.
  - The terminal stays mounted (hidden) under a preview so the PTY session
    and scrollback survive; `fit()` skips a 0×0 box, otherwise hiding it
    would shrink the shared PTY for every client.
  - Bug found by the e2e flake: on a cold bridge every `task.tabs` call ran
    its own `engine-list` + per-engine status probe, so a page load could
    wait seconds for any tab, and a task clicked early showed no terminal.
    Fixed in the bridge (single-flight engine load, phones benefit too) and
    in the page (`refreshTabs` applies each reply as it lands).
  - `s` and the PR chip were only seen refusing (sandbox engines exit into a
    shell); round 4 saw them delivered.
- **Round 4** (branch `web/round-4`, stacked on round 3): footer usage, live
  delivery, faster tabs. Scripts: `e2e-r4.ts`, `e2e-r4c.ts` (shots `r4-*`,
  `r4c-*`).
  - `usage.get` takes optional `taskId`+`tabId` and adds `context` (the
    orchestrator's `contextUsageSignal` for that session, `null` = no
    reading). Additive: the phones' calls are unchanged.
  - The web imports the TUI's pure `usage-core.ts` (devDependency
    `@sma1lboy/rove`), so chip text and tones cannot drift from the TUI.
  - Bug: `s` and the PR chip sent no tab, so the bridge picked tab-1 (an
    exited shell) while a live engine sat in tab-2. Now they target the
    selected engine tab, else the first, as the TUI's `resolveEnginePty`.
  - `task.tabs` named engines through the full engine list, which probes
    every binary: 6.9 s on a cold bridge and again after each 60 s cache
    expiry. It now uses `engineDisplayName` (state.json overrides +
    registry); cold `task.tabs` is ~75 ms.
  - Live engine for delivery checks: a Codex tab opened from the web works in
    the sandbox (Codex is logged in there). The sandbox Claude is NOT logged
    in, and Codex sessions have no pinned id, so no ctx/Σ reading exists;
    don't copy real credentials in to get one.
  - Decided: TUI chords that are not browser-reserved (j/k, r, b, n, /, …)
    are mirrored on the web in the same pane scope. They are not new or
    moved chords, so they don't need sign-off; only replacements for
    Ctrl+W/T/N/Q do.
- **Round 5** (branch `web/round-5`, stacked on round 4): the rail's
  keyboard layer, from `keybindings-sidebar.ts`. Script: `e2e-r5.ts`
  (shots `r5-*`).
  - Row keys look up the right-click entry by `MenuItem.key` and run it, so
    a key and its menu entry share one code path; the menu shows the key.
  - Sort + search state lives in `useRailFilters` (the rail builds rows
    from it); `useRailKeys` only moves the cursor and dispatches. Project
    headers are not cursor stops (`treeFlatIds`).
  - Sort is per browser (`localStorage rove.activeSortMode`); the TUI keeps
    its own in KV and does not sync across clients either.
  - The web can't import `groups.ts`/`task-group.ts` (`@/` aliases), so the
    recent/name comparators are re-stated in `rail.ts`; attention uses the
    bridge's `rank`. `fuzzy.ts` is imported directly.
  - Script lessons: row text starts with the status glyph, read
    `.row-title`; wait for the UI result (the `▴` chip, the toast), not a
    fixed delay (`task.setCommand` ~2–3 s); bound every cursor loop.
- **Round 6** (branch `web/round-6`, stacked on round 5): New shell, empty
  engine tabs, Settings. Scripts: `e2e-r6t.ts`, `e2e-r6s.ts`.
  - `rove api tab-new` (`cli/api/tab-new.ts`): one locked allocation in
    `tab-snapshot.ts` `allocateTab` (`mintCliTab` wraps it), spawn, and a
    daemon `terminalTab.add` → `tab.add` broadcast that attached TUIs absorb
    (`absorbTab`: right kind, `nextOrdinal` raised, `activeId` untouched).
    Attaching to an already-live key is `TAB_COLLISION`, not a new tab.
  - Bridge `tab.new`: `prompt` optional, `kind: engine|shell`; with a prompt
    the old `send` path is unchanged for old clients.
  - Bug found: tab label tested `kind === "shell"` but the bridge sends
    `command`; anything not `engine` is now a shell, as the TUI.
  - Settings is per bridge op on the TUI's state.json keys; language is per
    browser (`rove.locale`) and does not touch the TUI's. Feedback is never
    sent by a check: it publishes a public Discussion.
- **Round 7** (branch `web/round-7`, stacked on round 6): prefix layer
  (`prefix.tsx`). Script: `e2e-r7.ts`.
  - The TUI default prefix is `ctrl+a` (`DEFAULT_PREFIX_CONFIGURATION`), not
    ctrl+f. Listener is window capture-phase so it beats xterm.
  - Strokes mirrored: n , i h l z p/P w. Not yet: / (palette), m (move), o
    (can't), r (refresh/redraw), 1/2/3 (pages), c/f (fork), k/u (fix checks,
    sync base: no bridge op).
  - User prefix overrides in `keybindings.yaml`: see Round w3.
  - Dialogs focus themselves on open; before, Esc died inside xterm.
- **Owner, 2026-10-15:** no more round-by-round stops or reports. Keep
  slicing PRs for review, work straight through PARITY, message only when all
  done (stack order, final PARITY, what can't be done and why) or blocked.
  An item that genuinely can't exist on the web stays ❌ with the reason.
- **Round 8** (`web/round-8`): Worktrees page (`worktrees-view.tsx`) over the
  bridge's existing `worktrees.list`/`worktrees.remove` (grep op names with a
  loose pattern: some area files register with `spec({`). Direct tab chords
  in `workspace-keys.tsx`; prefix listener now `stopImmediatePropagation`.
- **Slices and waves** (after round 8): five parallel slices in their own
  worktrees (`jaguar-<slice>`), sandboxes (`SBX=<name>`, `.scratch/web/sbx.ts`)
  and ports, integrated by rebasing each onto the one below; then wave 2,
  a cross-slice browser regression, and wave 3. Stack order is the PR chain
  #1257 → … → #1278 → web/w3 → web/parity-final.
  - Area ops live one file per area (`ops/taskops.ts`, `launch.ts`,
    `welcome.ts`, `prefs.ts`, `update.ts`, `machines.ts`, …) so slices don't
    collide in one table; i18n gets one namespace per slice, appended.
  - Pure TUI cores factored out for the web (no TUI behaviour change):
    `cron-core.ts`, `automation-*-core.ts`, `keybindings-resolve.ts`,
    `prefix-hud-timing.ts` (keeps `node:fs` out of the browser bundle).
  - Every `rove api` flag change regenerates the skill flag table
    (`scripts/gen-skill-api-flags.ts`) and bumps the skill version (now 61).
  - Remote machines are read-only on the web, exactly as in the TUI.
- **PARITY score: 186 / 203 ✅ (1 🟡, 3 🚫, 13 ❌).** The Score line sat at
  round 1's "15 / 203" through every later round while the rows moved, so
  the file disagreed with itself. Regenerate it from the table with the
  command on PARITY's Score line at each round's end, and quote that output.
- **Stacked PRs get no CI.** `ci.yml` / `pr-gates.yml` only run for
  base=main, so everything above #1257 has only the two non-main checks. Each
  round ends with a local `bun run build && bun run test` at the top of the
  stack, results written into the PR body.
- **Never send feedback from a script.** A copied sandbox without the fake
  `gh` posted four public Discussions (#1265–#1268); the step is removed from
  every script. Reported to the owner, not deleted.
- **Script lessons:** Dev reset wipes the sandbox's tasks — run it last;
  copied sandbox homes carry a `daemon.owner` pointing at the source daemon;
  regression FAILs need sorting into product vs fixture drift.
- **Left in sandboxes (not cleaned, no deletion approved):** worktrees
  `/private/tmp/wt-*` were removed by the page itself; the `Land me` task was
  landed into `/private/tmp/rove-web-demo` main; fake machine `ghostbox` and
  `fakeremote` registered in sandboxes; `w3demo` plugin and
  `/tmp/w3-editor.sh` fixtures; the slice worktrees `jaguar-*`.
- **Open for the owner:** #24 `ctx %` needs a Codex tab whose session reaches
  the daemon, i.e. Rove's hooks trusted in the global `~/.codex/hooks.json`;
  #152/#154 installing a release from a browser; whether to cross the
  security boundary for any ❌ row.
- **Usage readings in a sandbox:** the Mac's plain `claude` is not signed in
  from an agent shell; `.scratch/web/with-cpa-env.sh` runs a command with the
  owner's `claudecpa` proxy env, read at run time, never written. A reading
  also needs the session id to reach the daemon: without Rove's global hooks,
  launch the tab as `claude --settings .scratch/web/claude-hooks.json`
  (written by `.scratch/web/mk-hooks.ts`, hooks pointing at the source CLI).
  Claude readings carry no context window, so they give `Σ` but never `ctx %`,
  in the TUI too.
- **Pending owner stack (#1247→#1246→#1248→#1249, long-run controls):** once
  merged, the Inbox must stop clearing on open for `report_missing` rows
  (clear only via `d` → `attention.dismiss {deliveryId}` or a late report) and
  open a decision dialog calling `gate.answer` for `decision_needed` rows
  (`gateId`; dismiss returns `GATE_NOT_DISMISSABLE`). Reference: TUI
  `inbox-open-action.ts`, phones' `InboxLogic.clearsOnVisit`. Today
  `inbox-view.tsx` `open()` dismisses unconditionally; that is the line to
  change. Two `—` rows in PARITY track it.
- **Round w3** (`web/w3`): Open in editor and the user's `keybindings.yaml`.
  - `task.openEditor` reuses the TUI's `detectWorktreeOpener`/`openWorktree`; the
    only editor config is the Mac's (`ROVE_OPEN_EDITOR`). Verify with it pointed at
    a script that records argv; without it detection falls back to a real GUI app.
  - `keybindings.get` runs the TUI parser on a copy of the default keymap (the pure
    `tui/lib/keybindings-resolve.ts`, factored out of `keybindings-user.ts`; no TUI
    behaviour change). The web applies the changed rows onto its own `RoveKeymap`
    (`user-keys.ts`), so F1, the palette, the guide and hints read the user's chords.
  - Chords are matched by `chord.ts` (`chordCandidates`, the TUI's `matchKey` order),
    not by hard-coded keys; ACTIONS and the rail take their defaults from the keymap.
    A user override replaces only the kind (direct or prefix) it changed, so
    browser-reserved defaults are never adopted wholesale.
  - Live reload is a re-read on window focus; the TUI's is a daemon push.
  - Plugin `action:` chords go through `plugin.chordAction`, which resolves the target
    from the Mac's own file; `pane:` chords use `plugin.paneOpen`.
