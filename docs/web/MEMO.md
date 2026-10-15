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
- **Look.** quill tokens (dark half = the TUI's default `claude` theme), mono
  for structure, system face for titles, terracotta as the only accent.
  Layout mirrors the TUI: Tasks rail | workspace, footer across. Light mode
  and theme choice are PARITY rows, not done.
- **i18n.** `src/i18n/{en,zh}.ts`, English is the source of truth like the
  TUI catalog; `test/web.test.ts` checks key and placeholder parity. Locale
  follows the browser until web Settings exists.
- **Shared PTY size.** The page resizes the session to its own grid, as the
  phones do. The TUI redraws at that size while the page is open. Open.
- **xterm theme duplicated** from `rove-harness` (frozen). Derive both from
  `claude.json` when theme switching lands.

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
  the same sandbox for side-by-side shots.
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
- **Next pick:** Files + diff view (`files.list`, `diff.files`, `diff.file`,
  `review.*`): a whole TUI pane, ~18 rows. Then a bridge op for a hosted
  shell tab and an empty engine tab (#42, #43, #74, #85). Then footer usage
  (`usage.get`).
- **Pending owner stack (#1247→#1246→#1248→#1249, long-run controls):** once
  merged, the Inbox must stop clearing on open for `report_missing` rows
  (clear only via `d` → `attention.dismiss {deliveryId}` or a late report) and
  open a decision dialog calling `gate.answer` for `decision_needed` rows
  (`gateId`; dismiss returns `GATE_NOT_DISMISSABLE`). Reference: TUI
  `inbox-open-action.ts`, phones' `InboxLogic.clearsOnVisit`. Today
  `inbox-view.tsx` `open()` dismisses unconditionally; that is the line to
  change. Two `—` rows in PARITY track it.
