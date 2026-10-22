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
- Drag a project header up or down among projects, or a task among its
  project's tasks (pinned and unpinned tasks stay in their own groups). The
  other rows slide aside to show where it lands. The order is the daemon's, so
  the TUI and phones follow. Only in the default sort, outside a search.
- `+ New task` at the bottom of the rail, and `+` in the tab strip for a new
  conversation. The first message is optional, as in the TUI's picker: without
  one you get a plain engine (or shell) tab. A fork to new tasks needs one.
- Mods: while a plugin's `[mod]` has a pane open, the rail lists **Mods**.
  The page draws the same panes as the TUI's Mods page, and a button pressed
  here updates both ([PLUGIN-AUTHORING.md](PLUGIN-AUTHORING.md#mods)).
- A plugin's input dialog (`rove api prompt`) opens here too; the first
  answer from the web or a TUI wins.
- The Inbox: click `INBOX n` at the top of the rail. `↑↓` moves, Enter opens
  the session and clears it, `d` clears it without opening.

The keyboard works as in the TUI: the rail's own keys (`j`/`k`, Enter, `n`,
`/`, `r`, `d` and the rest of the sidebar chords), the `ctrl+a` prefix layer
with its guide, F1 help and the command palette, and the direct chords such as
Ctrl+E, Ctrl+1..9, F2–F5 and F7. Your `~/.rove/settings/keybindings.yaml`
applies here too. Chords the browser keeps for itself never reach the page:
close a tab with `ctrl+a w` or the menu instead of Ctrl+W, open one with `+` or
Ctrl+E instead of Ctrl+T, and there is no Ctrl+Q (a page cannot quit itself).

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
- `--device <name>` gives one phone or browser its own token and prints its
  link; `--revoke-device <name>` revokes just that one, and
  `--list-devices` shows them. Only a SHA-256 of each device token is kept
  (`<home>/.rove/bridge/devices.json`, owner-only).
- `--setup` checks for Tailscale and cloudflared on this machine and prints
  the commands to reach the bridge from another device. It changes nothing.

The page's files are served without the token (they carry none); every
operation needs it. With `--preset cf`, Cloudflare Access gates the page too.

### Password login

So you can open the page on a phone or another computer without carrying the
token link, you can set a password:

```bash
rove --web --set-password     # asks twice, nothing echoed
rove --web --clear-password   # remove it
rove --web --unlock           # lift a lockout
```

The password is only ever typed at that prompt, never passed as an argument
or an environment variable, so it reaches no shell history or process list.
Only a scrypt hash with a random salt is kept, in
`<home>/.rove/bridge/web-password.json` (owner-only).

With a password set, a browser that has no token shows a password field
instead of asking for the link. A right password mints a new device token
named `web-login-<date>-<time>` (UTC) and the page keeps it as it would a
`#token=` link. Each login shows in `--list-devices`, and
`--revoke-device <name>` signs that browser out. **Sign out** in Settings →
General forgets the token in this browser and revokes it on the host.

Wrong guesses are slowed and counted, and the counts survive a restart:

- 5 wrong passwords from one address lock that address for 15 minutes.
- 20 wrong passwords in 24 hours, from anywhere, lock password login for
  everyone until you run `rove --web --unlock` (or `--set-password` again).
- Each failure and each lock is logged with its time and address; the
  password never is.

To reach it from elsewhere through a plain tunnel to `127.0.0.1` (cloudflared
without Access):

```bash
cloudflared tunnel --url http://127.0.0.1:7878      # or a named tunnel to your hostname
rove --web --public-host rove.example.com
```

`--public-host` keeps the bridge on `127.0.0.1`; it only tells the bridge the
page's https address, so a page served from it is accepted and every other
site is still refused. Behind such a tunnel the address counted is the one
Cloudflare reports (`CF-Connecting-IP`); otherwise it is the connecting socket.

What the password changes: it is one more door in front of the token, not a
replacement for it. Anyone who can reach the page can try passwords, slowly,
until the lockout stops them; a long, unique password matters. Token links,
phone pairing and device tokens keep working as before. Cloudflare Access
(`--preset cf`) is still the stronger choice when you have it, because nobody
reaches the page at all without passing Access first. With no password set,
none of this exists: there is no login route and the page asks for the link.

## Limits

- The standalone `rove` binary does not include the page; `rove --web`
  says so. The npm package does.
- A browser tab resizes the shared session to its own width, as the phone
  apps do, so the TUI may redraw at the browser's size while it is open.
