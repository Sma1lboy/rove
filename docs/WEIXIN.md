# WeChat (微信)

Check on Rove and hand it work from the WeChat app on your phone.

You bind a WeChat bot to Rove once by scanning a QR code. After that, a message
to the bot comes back with the state of your tasks, can be forwarded to a
task's agent, or can start a new task. Rove also messages you when a task needs
you, is ready for review, or has a PR ready to merge.

The bot uses Tencent's iLink Bot API, the same one the official
`@tencent-weixin/openclaw-weixin` plugin uses. Rove talks to it directly; no
other gateway process is involved.

## What this needs

- A personal WeChat account on your phone.
- A running Rove daemon. Messages are fetched by the daemon, so nothing arrives
  while it is stopped. The TUI starts it; on a machine without the TUI open,
  run `rove daemon start` (it runs in the foreground — use a terminal
  multiplexer or a service manager to keep it up).

While a binding exists, the daemon does not stop itself when the last TUI
closes, so it keeps answering. `rove weixin logout` removes that hold.

## Bind

```console
$ rove weixin login
Scan with WeChat (微信 → 扫一扫), then confirm on the phone:
█▀▀▀▀▀█ ▄▀ █▀▀▀▀▀█
…
Or open: https://…
Scanned — confirm on your phone…
Bound. Send the bot `help` from WeChat to try it.
```

1. Run `rove weixin login` in a terminal.
2. In WeChat, open **扫一扫** and scan the code. If the terminal cannot draw
   it, open the printed URL and scan that.
3. Confirm on the phone.

The code expires after a few minutes; Rove fetches a new one up to three times,
then gives up. Run `login` again to re-bind, for example after WeChat ends the
session. A daemon that is already running picks up a new binding within a few
seconds; no restart is needed.

The WeChat account that scanned is the **owner** and is the only sender Rove
answers by default.

## What you can send

| Message | What happens | Same as |
|---|---|---|
| `status` (or `s`, `状态`) | Counts first, then the tasks that need you, are ready to merge, are ready for review, and are running | `rove api context` |
| `status <repo>` | The same, for one repo | `rove api context --repo` |
| `send <id> <text>` | Types `<text>` into the task's engine tab | `rove api send --task-id <id> --plain` |
| `send <id> tab-2 <text>` | Into that tab | `… --tab tab-2` |
| `add <repo> <prompt>` | Starts a new task in that repo with the repo's default engine | `rove api add --repo <repo> --prompt` |
| `help` (or `帮助`) | The command list | |

`<id>` is the six-character code `status` prints in front of each task (the end
of its task id). Four or more trailing characters work as long as they match
one task; if they match several, the reply lists them.

`<repo>` is the repository's directory name, such as `rove` for
`~/code/rove`. It must be a saved project or a repo that already has tasks.
When two repos share a name, the reply asks for the full path.

`send` and `add` go through the same code as the `rove api` verbs, so a refusal
there is the reply here, for example
`Failed (ENGINE_NOT_RUNNING): … has no live engine process`.

Replies are kept short for a phone. A long reply is split into at most three
messages; anything beyond that is cut and the last message says how many lines
were dropped.

## Notifications

Every 20 seconds the daemon checks every repo's tasks and messages you when a
task **moves into** one of these:

- **Needs you**: a permission prompt, a usage limit that will not resume by
  itself, an error, or an engine that died without reporting.
- **Ready for review**: a report or finished turn nobody has looked at.
- **Ready to merge**: its PR is open and approved.

A task has to stay in the new state for two checks in a row before you hear
about it. Tasks already in one of these states when the daemon starts are not
announced.

### The 24-hour limit

iLink only accepts a bot-initiated message once the person has written to the
bot, and the session behind it goes stale. Rove applies its own rule on top:
it sends a notification only if that person messaged the bot in the last 24
hours. Otherwise the notification is written to
`~/.rove/weixin/undelivered.jsonl` and the daemon log instead, and
`rove weixin status` shows the count and the latest reason. Any message to the
bot (even `s`) opens the window again.

The same log gets messages iLink refused, such as an expired session after
Rove has already retried once without the stale session token.

## Letting other people in

Messages from anyone other than the owner and the people you allow are dropped
without a reply. `rove weixin status` lists the most recent refused senders by
WeChat user id:

```console
$ rove weixin status
Bound to bot 1a2b3c4d5e6f@im.bot since 2026-10-04T12:00:00.000Z
Daemon: running
Owner: o9xQ2mfE7rT@im.wechat
Allowed: owner only
Reply windows:
  o9xQ2mfE7rT@im.wechat  last message 3m ago — open
Refused senders (`rove weixin allow <id>` to let one in):
  wx7Lp3KdZ0a@im.wechat  1h ago
```

```bash
rove weixin allow <user-id>   # this person can now send commands
rove weixin deny <user-id>    # and no longer can
```

Allowed people get notifications too, under the same 24-hour rule.

## Unbind

```bash
rove weixin logout
```

This deletes the credentials and the long-poll position. The undelivered log
stays.

## Limits

- Text only. Images, files and voice messages without a WeChat transcript get
  a "text messages only" reply.
- Direct messages only. A QR-bound bot is usually not delivered group chat
  events, so Rove ignores them.
- One bot per Rove home. `login` with a different WeChat account replaces the
  binding.
- Notifications are checked every 20 seconds, so a state can be up to about a
  minute old when it reaches you.
- Replies are in English.

## Where things live

Under `~/.rove/weixin/` (or `$ROVE_HOME_DIR/.rove/weixin/`), directory mode
`0700`, files `0600`:

| File | Written by | Holds |
|---|---|---|
| `account.json` | `rove weixin login`/`allow`/`deny` | bot id, bot token, owner, allowed users |
| `state.json` | the daemon | long-poll position, the latest session token and last-message time per sender, refused senders |
| `undelivered.jsonl` | the daemon | notifications that could not be sent, one JSON object per line |

The bot token is never written to the daemon log. Daemon log lines that mention
a WeChat id show only its first eight characters.

## Testing against a fake server

`ROVE_WEIXIN_BASE_URL` points `rove weixin login` at another iLink endpoint;
the binding then keeps whatever base URL that server confirms. The repo ships a
fake one for development:

```bash
cd packages/rove
PORT=18733 bun test/weixin/fake-ilink.ts &          # confirms any login
ROVE_WEIXIN_BASE_URL=http://127.0.0.1:18733 bun dev:sandbox --name wx run weixin login
bun dev:sandbox --name wx run daemon start &
curl -s localhost:18733/_inject -d '{"text":"status"}'   # a message from the owner
curl -s localhost:18733/_sends                            # what Rove replied
```

### Checking a real phone

1. `rove weixin login`, scan, confirm. `rove weixin status` shows `Bound` and
   the owner id.
2. With the daemon running, send `s` to the bot. The reply starts with a count
   line such as `Nothing needs you. 2 running`.
3. Send `send <id> say hi` for a task from that list. The text appears in that
   task's engine tab and the bot answers `Sent to <id> …`.
4. Let a task hit a permission prompt. Within about a minute the bot sends
   `Needs you:` with that task.
5. From another WeChat account, message the bot. Nothing comes back, and the id
   appears under `Refused senders` in `rove weixin status`.
6. `rove weixin logout`. Within one poll (up to 35 seconds) the daemon log
   shows `weixin: unbound — stopped polling`.
