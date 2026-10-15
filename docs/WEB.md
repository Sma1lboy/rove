# Web client

`rove --web` serves Rove in a browser. It runs the same bridge the iOS and
Android apps pair with ([IOS.md](IOS.md)), and the page is one more client of
it: same daemon, same tasks, same terminal sessions as the TUI.

```bash
rove --web                 # 127.0.0.1:7878 only
rove --web --port 7900     # another port
```

It prints two links and keeps running until you stop it:

```text
open: http://127.0.0.1:7878/#token=…
pair: ws://127.0.0.1:7878/?token=…
```

Open the first in a browser. The second is the phone pairing URL. A phone
already paired with `rove-bridge` keeps working: the two share one token.

## What it does today

- The Tasks rail: projects, tasks and their tabs, with the TUI's status marks
  (`?` waiting on you, `!` needs you, `●` unseen turn, `○` quiet, a spinner
  while working) and the `+N` / `−N` / `↑N` / PR marks.
- Click a task or tab to open its terminal session, and type into it. That
  includes answering an engine's prompts.
- Right-click a project, task or tab for the same menu the TUI has: new
  conversation, close tab, rename, rename branch, pin, set status, change
  engine, copy the task ID, branch or path, land, delete.
- `+ New task` at the bottom of the rail, and `+` in the tab strip for a new
  conversation. A new tab needs a first message; the TUI's picker does not.
- The Inbox: click `INBOX n` at the top of the rail. `↑↓` moves, Enter opens
  the session and clears it, `d` clears it without opening.

There are no keyboard shortcuts outside dialogs and menus yet.

[web/PARITY.md](web/PARITY.md) lists every TUI action and whether the web
has it yet.

## Security

- It listens on `127.0.0.1` only unless you pick a bridge preset
  (`--preset tailscale` or `--preset cf`, see [IOS.md](IOS.md)). There is no
  flag that opens it to the whole network by default.
- The token rides in the link's `#fragment`, which browsers never send to a
  server, so it reaches no access log. The page stores it in the browser's
  local storage and removes it from the address bar.
- The page sends the token as a `Sec-WebSocket-Protocol` value, because a
  browser cannot set the `Authorization` header phones use. A socket opened
  from another site is refused even with the token.
- `--rotate-token` revokes every browser and phone at once.

The page's files are served without the token (they carry none); every
operation needs it. With `--preset cf`, Cloudflare Access gates the page too.

## Limits

- The standalone `rove` binary does not include the page; `rove --web`
  says so. The npm package does.
- A browser tab resizes the shared session to its own width, as the phone
  apps do, so the TUI may redraw at the browser's size while it is open.
