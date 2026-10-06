# iOS client

Rove Mobile is an iPhone app that drives the Rove on your Mac: see every task and what it is waiting on, watch an engine's terminal, type into it, read the diff, start, land and delete tasks. The Mac stays the only place state lives; the phone holds no copy of your tasks, files or sessions.

The phone cannot reach the daemon's unix socket, so a small Mac-side process, `rove-bridge`, carries a fixed list of operations over one WebSocket. It is off unless you start it.

## Start the bridge

From a checkout of the Rove repo:

```bash
bun install
bun run --filter rove-bridge start                      # your real Rove home
bun run --filter rove-bridge dev                        # the dev:sandbox home instead
bun run --filter rove-bridge dev -- --name ios          # a named sandbox home
```

It prints a pairing URL (and a QR code), then keeps running. It connects to the same daemon and PTY Host your TUI uses, starting them if they are down.

With no flags it listens on `127.0.0.1` only, which reaches the Mac itself and the iOS Simulator. A real phone uses one of two presets. [`packages/rove-bridge/README.md`](../packages/rove-bridge/README.md) has the full setup for each, including the Cloudflare Tunnel and Access application.

| Preset | Listens on | Phone dials | Transport security | Extra check |
| --- | --- | --- | --- | --- |
| `--preset tailscale` | the Mac's Tailscale IPv4 only (exits if there is none) | `ws://<MagicDNS name>:7878`, or `wss://` with `tailscale serve` + `--public-host` | WireGuard (plus TLS with `tailscale serve`) | — |
| `--preset cf` | `127.0.0.1`, for `cloudflared` | `wss://<tunnel hostname>` | TLS to Cloudflare, then the tunnel | Cloudflare Access JWT (signature, issuer, AUD, expiry) |

Plain `ws://` on a LAN (`--host <LAN address>`) still works, but it is not a supported way to reach the bridge remotely: the token and terminal output travel in cleartext.

| Flag | Effect |
| --- | --- |
| `--preset tailscale` / `--preset cf` | See above. |
| `--public-host <name>` | Hostname the phone dials over `wss://` (tunnel hostname, or a `tailscale serve` name). |
| `--cf-team`, `--cf-aud` | Cloudflare Access team and application AUD tag; also readable from `<ROVE_HOME>/.rove/bridge/config.json`. |
| `--host <addr>` | Without a preset: an explicit listen address. Repeatable. |
| `--port <n>` | TCP port, default `7878`. |
| `--rotate-token` | Mint a new token. Every paired phone must pair again. |
| `--no-qr` | Print the URL without the QR code. |

## Pair the phone

1. Build and run the app (below), open **Settings**.
2. Scan the QR code, or paste the URL, for example `wss://rove.example.com/?token=…&preset=cf`. A `rove://pair?url=<percent-encoded URL>` link opens the app straight into pairing. The preset in the URL selects the matching preset in the app.
3. For **Cloudflare**, also fill in `CF-Access-Client-Id` and `CF-Access-Client-Secret` from your Access service token. Any preset can carry additional request headers.
4. The app stores the endpoint, token, preset and headers in the iOS Keychain and connects. It sends the token as `Authorization: Bearer …`, never in the URL. It reconnects by itself when the Mac or the bridge comes back.

The token lives in `<ROVE_HOME>/.rove/bridge/token` (mode 0600) and survives bridge restarts, so a paired phone stays paired. `--rotate-token` is the revoke button.

## What the app does

- **Tasks.** Every task across repos with its title, branch, engine and group — `waiting-on-you`, `landing`, `ready-for-review`, `working`, `idle`, `unknown` — sorted so what needs you is on top. The groups are computed by the same code as `rove api context`. A badge counts unread attention-inbox items. Pull to refresh; changes also arrive live.
- **Terminal.** Each Terminal Tab of a task attaches to the hosted session in the PTY Host — the same session the TUI shows, so both see the output and both can type. A key row under the terminal (always visible, no keyboard needed) sends Esc, Tab, Shift-Tab, a sticky Ctrl, arrows, Enter and Ctrl-C; typing into the terminal goes through keystroke by keystroke; the composer sends a line, then Enter. **Fit** (default) resizes the shared session to the phone's screen, so the TUI pane re-wraps to the phone's width until it next resizes; **Watch** leaves the size alone and scales the font instead.
- **New engine tab.** Pick an engine and a first message; this is `rove api send --tab new`.
- **Diff.** Files changed on the branch versus its base (same base rule as the TUI's changes pane) and uncommitted files, each with its unified diff.
- **New task, land, delete.** New task takes a repo, an engine and an optional first prompt. Land and delete ask twice; delete keeps the branch, as `rove api delete` does.
- **Notifications.** While the app is running, a task that moves into `waiting-on-you`, or from `working` to `ready-for-review`/`idle`, posts a local notification.

Engine names in the app come from Rove's engine registry through the bridge.

## Architecture

```mermaid
flowchart LR
  phone["Rove Mobile (SwiftUI + SwiftTerm)"] -- "WireGuard, Bearer token" --> tailnet["Tailscale tailnet"]
  phone -- "wss, CF-Access-Client-Id/Secret, Bearer token" --> cf["Cloudflare Access + Tunnel"]
  tailnet -- "tailnet IP only" --> bridge["rove-bridge (Bun)"]
  cf -- "cloudflared → 127.0.0.1, Cf-Access-Jwt-Assertion" --> bridge
  bridge -- "unix socket, JSON lines (gui role)" --> daemon["Rove daemon"]
  bridge -- "unix socket, one per phone" --> pty["PTY Host"]
  tui["Rove TUI"] -- "unix socket" --> daemon
  tui -- "unix socket" --> pty
  daemon --- state[("tasks, inbox, PR status")]
  pty --- sessions[("hosted engine sessions")]
```

- The bridge subscribes to the daemon as a `gui` client, the way an open TUI does, so the daemon does not idle-stop while a phone is the only UI.
- Task rows come from `task.list`, the activity registry, the attention inbox and PTY Host liveness, folded by `buildContext` from `rove api context`. Mutations go through the `rove api` verbs themselves (`add`, `delete`, `land`, `send --tab new`, `tab-close`), so they keep every guard those verbs have.
- Each phone connection opens its own PTY Host socket. Closing the WebSocket detaches every session that phone watched; it never ends a session.
- The daemon is unchanged. No HTTP or SSE was added to it.

## Security model

- **Off by default.** Nothing listens until you run the bridge.
- **Loopback by default.** Remote access is `--preset tailscale` (tailnet address only) or `--preset cf` (loopback behind cloudflared); anything else is an explicit `--host`.
- **One bearer token.** 32 random bytes, sent only as `Authorization: Bearer`; a token in the URL query is refused, so it never lands in proxy or tunnel logs. It is checked with a constant-time compare at the WebSocket upgrade; a missing or wrong token gets HTTP 401 and no socket. Every later frame rides that authenticated socket.
- **Cloudflare Access (`--preset cf`).** Before the token, the bridge verifies `Cf-Access-Jwt-Assertion` against the team's published keys (`/cdn-cgi/access/certs`) and checks issuer, AUD and expiry. Both layers must pass; each refusal is logged with the reason, never with the token or JWT.
- **Closed op list.** The phone can call the 18 operations below and nothing else. There is no generic daemon passthrough; anything else is refused with `UNKNOWN_OP`.
- **Terminal input is scoped.** `term.input` only reaches a session this connection attached, and attach refuses a tab with no hosted session instead of spawning one.
- **Diff paths stay in the worktree.** Absolute paths and `..` are refused.
- **What the token grants.** Whoever holds it can do what the app can: read task output, type into engine sessions (which run with your user's permissions), create, land and delete tasks. Treat the pairing URL like a password; rotate it if it leaks.
- **Transport encryption comes from the path.** WireGuard for Tailscale, TLS for Cloudflare and `tailscale serve`. The bridge itself speaks plain `ws://`, so a LAN `--host` exposes the token and terminal contents to that network.

## Protocol

JSON text frames over one WebSocket. Request `{"id": 1, "op": "tasks.list", "args": {}}`; reply `{"id": 1, "ok": true, "result": {…}}` or `{"id": 1, "ok": false, "error": {"code", "message"}}`; push `{"event": "tasks" | "term.data" | "term.exit", "data": {…}}`. The types live in `packages/rove-bridge/src/protocol.ts`.

| Op | Args | Result |
| --- | --- | --- |
| `hello` | — | `{protocol, roveVersion, host}` |
| `tasks.subscribe` | — | `{tasks, attention}`, then `tasks` pushes on change |
| `tasks.list` | — | `{tasks, attention}` (fresh read) |
| `engines.list` | — | `{engines: [{id, name, command, protocol, builtin}]}` |
| `repos.list` | — | `{repos}` (saved projects plus repos with tasks) |
| `task.create` | `repo`, `engine?`, `prompt?`, `title?` | `{taskId}` |
| `task.delete` | `taskId`, `force?` | `{status}` |
| `task.land` | `taskId`, `strategy?` (`merge`/`squash`) | `{landedOn, commit}` |
| `task.tabs` | `taskId` | `{tabs: [{id, kind, title, engineName, alive, engineAlive}]}` |
| `tab.new` | `taskId`, `prompt`, `engine?` | `{tabId}` |
| `tab.close` | `taskId`, `tabId` | `{}` |
| `term.attach` | `taskId`, `tabId`, `cols?`+`rows?` | `{stream, alive, replay}` (base64 bytes) |
| `term.input` | `stream`, `data` | `{}` |
| `term.resize` | `stream`, `cols`, `rows` | `{}` |
| `term.detach` | `stream` | `{}` |
| `diff.files` | `taskId` | `{base, files: [{path, status, added, deleted, scope}]}` |
| `diff.file` | `taskId`, `path`, `scope` | `{kind, text?, message?}` |
| `files.list` | `taskId` | `{files, truncated}` (tracked + untracked, not ignored) |
| `review.list` | `taskId` | `{notes, unsent}` (notes live in `state.json` `diffComments.<taskId>`, shared with the TUI) |
| `review.add` | `taskId`, `filePath`, `line`, `startLine?`, `body` | `{note}` |
| `review.remove` | `taskId`, `id` | `{removed}` (destructive) |
| `review.send` | `taskId`, `tabId?` | `{sent, delivered, reason?}`; notes are marked sent only when delivery is confirmed |
| `worktrees.list` | `network?` | `{projects: [{repo, worktrees: [{path, branch, dirty, branchOnRemote, verdict, verdictReason, taskId?, taskKind?, …}]}]}` |
| `worktrees.remove` | `path`, `force` | `{removed, residue?}`; a dirty worktree is refused with code `DIRTY_WORKTREE` unless `force` (destructive) |
| `attention.dismiss` | `taskId`, `tabId?` | `{}` |

## Build the app

The app is in `packages/rove-ios` (SwiftUI, iOS 17+, SwiftTerm). The Xcode project is generated, not committed:

```bash
cd packages/rove-ios
xcodegen generate
xcodebuild -scheme RoveMobile -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build test
```

Running on a physical iPhone needs your own signing team in Xcode; the repo ships no signing configuration.

## Not done yet

- Push notifications (APNs). Notifications fire only while the app is running.
- TestFlight / App Store distribution.
- A chat view of the conversation; the app shows the raw terminal.
- End-to-end encryption between the phone and the bridge (Orca pins a desktop key); today the tunnel or tailnet is trusted.
- Per-device tokens with a device list and per-device revoke; today one token is shared and rotation revokes all.
- Restoring the TUI's terminal size when a phone leaves Fit mode.
