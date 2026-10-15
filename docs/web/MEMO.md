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
- **Next pick:** new task + new tab + close tab (`task.spawn`, `tab.new`,
  `tab.close` exist), then Inbox page (`attention`, `attention.dismiss`),
  then Files/diff (`files.list`, `diff.*`).
