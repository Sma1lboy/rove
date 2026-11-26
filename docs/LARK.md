# Lark (飞书)

Talk to your own Rove agent from Lark: DM the bot, or @ it in a group. The
agent answers in the message's thread, does quick things itself, and starts
Rove tasks for real work, then tells you in the thread when they finish.

Rove reaches Lark through [lark-cli](https://www.npmjs.com/package/@larksuite/cli).
lark-cli holds the Lark app and its credentials; Rove stores none of them.

## What this needs

- lark-cli: `npm i -g @larksuite/cli`.
- A running Rove daemon. The daemon listens for messages, so nothing arrives
  while it is stopped. While Lark is connected, the daemon does not stop itself
  when the last TUI closes.

## Connect

```console
$ rove lark connect
Lark connected: bot "Sma1lAgent".
Allowed: you (ou_…), 1 in all.
DM the bot or @ it in a group; your agent shows up as Lark at the bottom of the sidebar.
```

`connect` does the setup lark-cli still needs:

1. If lark-cli has no app, it runs `lark-cli config init --new`, which creates
   one in your browser. Pass `--brand lark` for Lark outside China (the
   default is Feishu).
2. It checks that the app's bot answers.
3. If lark-cli has no signed-in user, it runs `lark-cli auth login` so Rove
   learns your own open_id. You are added to the allowed senders.

A daemon that is already running starts listening within a few seconds.
Settings → Connectors → Chat shows Lark as connected.

## Who gets through

A message reaches the agent only when a person sent it, it is a DM to the bot
or @-mentions it in a group, and the sender is allowed. Everything else is
ignored. Lark sometimes delivers a message twice; the agent sees it once.

```bash
rove lark allow <open_id>   # let another person talk to the agent
rove lark deny <open_id>
```

A refused sender's open_id is in the daemon log (`not allowed (rove lark allow ou_…)`).

## The agent

The first allowed message creates the agent: a directory task in
`~/.rove/lark/agent`, titled **Lark**, pinned, and kept at the bottom of the
sidebar below every project. Its first message tells it how to reply (with
`lark-cli im +messages-reply` in the message's thread), when to answer itself
and when to start a task, and the tone to use. It keeps `root_id → task id`
lines in `tickets.md` in its directory, so a follow-up in the same thread goes
to the task already working on it.

Each admitted message gets an **OnIt** reaction at once and **DONE** when the
agent's turn ends. A message Rove could not hand to the agent gets **ERROR**.

```bash
rove lark tone "简短直接，结论先说"   # how the agent sounds; the next message tells it
rove lark tone                          # back to the default
rove lark status                        # bot, allowed senders, tone, the agent's task
rove lark disconnect                    # stop listening; the agent's task and the lark-cli app stay
```
