# Plugin SDK reference

`@sma1lboy/rove-plugin-sdk` is optional TypeScript sugar over the same env +
CLI + unix-socket contract that powers every Rove plugin. If your plugin is a
shell script, Python tool, or Rust binary, you do not need this package; read
[Writing Rove plugins](./PLUGIN-AUTHORING.md) for the raw contract.

Use the SDK when you want typed env readers, event-name unions, CLI helpers, a
daemon socket client, and a tiny terminal pane kit.

## Install

```bash
npm install @sma1lboy/rove-plugin-sdk
# or
bun add @sma1lboy/rove-plugin-sdk
```

The package is zero-dependency and runs on Node ≥ 18 or Bun. It publishes the
same files under both `@sma1lboy/rove-plugin-sdk` and the legacy
`@sma1lboy/kobe-plugin-sdk` names.

## Context

Every plugin entrypoint receives environment variables from the host. The SDK
exposes them as typed objects.

| Export | Signature | Purpose |
|---|---|---|
| `pluginContext` | `(env?) => PluginContext` | Read `ROVE_PLUGIN_*` / `KOBE_PLUGIN_*` env. Throws if run off-host. |
| `pluginEvent` | `(env?) => PluginEventEnvelope \| null` | Parse `ROVE_PLUGIN_EVENT_JSON`; `null` outside `[[events]]`. |

`PluginContext` fields: `pluginId`, `pluginRoot`, `configDir`, `stateDir`,
`binPath`, `socketPath`, optional `homeDir`, plus entrypoint-specific fields
(`event`, `taskId`, `taskTitle`, `actionId`, `invokeCwd`, `entrypointId`).

Runnable example:
[`packages/kobe-plugin-sdk/examples/hello-events/`](https://github.com/Sma1lboy/rove/blob/main/packages/kobe-plugin-sdk/examples/hello-events/).

```ts
import { pluginContext, pluginEvent } from "@sma1lboy/rove-plugin-sdk"

const ctx = pluginContext()
const ev = pluginEvent()
if (ev) {
  console.log(`${ctx.pluginId} saw ${ev.event} on task ${ev.taskId ?? "—"}`)
}
```

## Settings

Values declared in the manifest's `[[settings]]` are written as `KEY=value`
lines in `$ROVE_PLUGIN_CONFIG_DIR/.env` by the Settings → Plugins UI.

| Export | Signature | Purpose |
|---|---|---|
| `readSettings` | `(configDir) => Record<string, string>` | Read the whole `.env` as key/value strings. |
| `setting` | `(configDir, key, fallback?) => string` | One value with a fallback. |

```ts
import { pluginContext, setting } from "@sma1lboy/rove-plugin-sdk"

const ctx = pluginContext()
const mode = setting(ctx.configDir, "YOU_EXAMPLE_MODE", "fast")
```

Booleans store as `"1"` or are absent; numbers remain strings, so cast if you
need another type.

A manifest `default` is the Settings editor's pre-fill, not a stored value: the
config `.env` does not exist until the user saves one, so `setting(dir, key)`
with no fallback returns `""` on a fresh install. Pass the same value you
declared as the `default` — that is what the `fallback` parameter is for.

## Calling Rove from code

These helpers exec `$ROVE_BIN_PATH` (falling back to `$KOBE_BIN_PATH`). Use
them for portable callbacks; reach for `RoveSocket` only when you need push
channels.

| Export | Signature | Maps to |
|---|---|---|
| `rove` | `(args, opts?) => Promise<RoveRunResult>` | Raw CLI runner; resolves with exit code, never rejects on non-zero. |
| `roveJson` | `<T>(args, opts?) => Promise<T>` | Run, parse stdout as JSON; throws on non-zero exit or bad JSON. |
| `notify` | `(title, body?, opts?) => Promise<RoveRunResult>` | `rove api notify`; toast in every attached UI. |
| `dispatch` | `(taskId, prompt, opts?) => Promise<RoveRunResult>` | `rove api dispatch`; text into a live session. |
| `listTasks` | `<T>(opts?) => Promise<T>` | `rove api list`; all tasks as daemon-serialized JSON. |
| `openPane` | `(qualifiedPaneId, opts?) => Promise<RoveRunResult & { clients?: number }>` | `rove plugin pane open`; opens one of your `[[panes]]`. `opts.taskId` picks the task (pass an event's `ctx.taskId`); without it the host uses the active task and fails when there is none. Check `clients` — `0` means no attached UI performed the split. |
| `promptUser` | `(title, opts?) => Promise<string \| null>` | `rove api prompt`; host input dialog. Returns `null` on cancel, timeout, no attached TUI, or non-zero exit. |

Combined example:

```ts
import {
  dispatch,
  listTasks,
  notify,
  openPane,
  promptUser,
} from "@sma1lboy/rove-plugin-sdk"

await notify("Rove plugin", "Starting up")

const answer = await promptUser("Repo to watch?", {
  placeholder: "owner/repo",
  timeoutMs: 30_000,
})
if (answer === null) {
  // User cancelled, the prompt timed out, or no TUI is attached.
  process.exit(0)
}

const { tasks } = await listTasks<{ tasks: any[] }>()
const first = tasks[0]
if (first) await dispatch(first.id, `watch ${answer}`)

await openPane("you.example.board")
```

`promptUser` returns `null` for every non-submit path: the user pressed esc,
the prompt exceeded `timeoutMs`, no TUI was attached, or the underlying
`rove api prompt` exited non-zero. Always branch on `null`.

Every helper above takes the same optional `RoveRunOptions`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `binPath` | string? | `$ROVE_BIN_PATH`, then `$KOBE_BIN_PATH` | The Rove binary to exec. Rejects when neither is set. |
| `cwd` | string? | the process's cwd | Working directory for the child. |
| `env` | `Record<string, string>`? | — | Merged **over** the inherited environment. |
| `timeoutMs` | number? | `30_000` | Millis before the child is killed. |

`cwd` is the field to think about from an `[[events]]` hook: a hook runs with
its cwd set to your PLUGIN ROOT, not the task's worktree, so a `rove` call
that has to resolve a repo needs `{ cwd: worktreePath }` — take the path from
the event envelope rather than assuming the process inherited it.

`timeoutMs` defaults to 30_000 — the same number as the host's deadline for a
`[[startup]]` or `[[events]]` hook, but measured from a later instant: the
host starts its clock when it spawns your hook, this one starts when your hook
calls `rove()`. At the defaults the host's deadline therefore always expires
first, and it SIGKILLs the hook's whole process group, the `rove` child
included — so at 30s you never see this rejection, you see your hook
disappear. Raising `timeoutMs` alone changes nothing; raise the hook's
`timeout_ms` in the manifest first.

They resolve with `RoveRunResult`:

| Field | Type | Meaning |
|---|---|---|
| `code` | number | Child exit code. Non-zero is a resolved value, not a rejection. |
| `stdout` | string | Captured stdout (8 MB cap). |
| `stderr` | string | Captured stderr. |

`KobeRunOptions` and `KobeRunResult` are deprecated aliases of these two,
kept for plugins written against the original package name.

## Socket client

`RoveSocket` is a newline-delimited JSON client for the daemon unix socket. It
gives you live broadcast channels that the CLI cannot push.

`RoveSocket` is the only export here; everything under it is a method you
call on an instance (`new RoveSocket().connect()`), not a named import.

| Member | Signature | Purpose |
|---|---|---|
| `RoveSocket` | class (export) | Daemon socket client. |
| `KobeSocket` | alias (export) | Deprecated alias of `RoveSocket`. |
| `RoveSocketOptions` | type (export) | `{ socketPath?: string }` — `connect()`'s argument. Defaults to `$ROVE_SOCKET_PATH`, then `$KOBE_SOCKET_PATH`; rejects when neither is set. `KobeSocketOptions` is its deprecated alias. |
| `DaemonInfo` | type (export) | What `hello()` resolves with (fields below). |
| `.connect` | method: `(opts?: RoveSocketOptions) => Promise<void>` | Connect to the daemon socket. |
| `.request` | method: `<T>(name, payload?) => Promise<T>` | One request → response; rejects on daemon error frames. |
| `.subscribe` | method: `(handler, channels?) => Promise<void>` | Subscribe to channels (`role: "pane"`); omit channels for all. |
| `.hello` | method: `() => Promise<DaemonInfo>` | Ask the RUNNING daemon its build version and channel list. |
| `.onClose` | method: `(handler) => void` | Called once when the connection dies (restart, crash, error). Not called for your own `close()`. |
| `.close` | method: `() => void` | End the socket. |

SDK consumers must always subscribe with `role: "pane"`. The SDK enforces this
so plugins never hold the daemon's GUI lifetime open.

Channel payloads are host-versioned `unknown`: validate what you read against
the shape your target Rove version actually emits. The channel names are the
`DAEMON_CHANNELS` constant:

`task.snapshot`, `issue.snapshot`, `active-task`, `update`, `engine-state`,
`attention.inbox`, `ui-prefs`, `keybindings`, `task.jobs`, `worktree.changes`,
`transcript.activity`, `session.deliver`, `tab.open`, `tab.close`,
`engine.lifecycle`, `notice.event`, `usage.snapshot`, `usage.context`,
`ui.prompt`.

A name the daemon does not know is dropped from the filter, not rejected: the
subscribe succeeds and that channel simply never arrives. So a channel can be
dead for two reasons that look identical, and `DAEMON_CHANNELS` cannot tell
them apart — it is the list YOUR SDK was built against, not the list the host
has. Ask the host with `hello()`:

```ts
const info = await daemon.hello()
if (!info.capabilities.includes("usage.snapshot")) {
  console.error(`Rove ${info.roveVersion} has no usage.snapshot channel`)
}
```

`DaemonInfo` carries `roveVersion` / `kobeVersion` (the same build version
under both spellings; the wire field is `kobeVersion`), `capabilities`,
`protocolVersion` / `minProtocolVersion`, `daemonPid`, and `homeDir` — a
`homeDir` that is not yours means you reached a foreign daemon. It is also
the way to check `$ROVE_BIN_PATH --version` against the host: in a dev
checkout those are different builds.

### Surviving a daemon restart

Your handler receives `daemon.stopping` at a graceful daemon shutdown — not a
channel, always delivered regardless of the filter — and **that is the last
thing it ever receives**. There is no reconnect: after it, the socket is
dead. A crash is worse, because the daemon sends nothing at all.

This matters most in a pane, because a hosted pane's PTY **survives a daemon
restart by design**. Your process stays alive and keeps drawing its last
frame, so a board that has stopped receiving anything is visually
indistinguishable from a live one. Register `onClose` and either reconnect or
say so on screen:

```ts
function connect(): void {
  const daemon = new RoveSocket()
  daemon.onClose(() => {
    live = false
    frame() // draw a "host gone — reconnecting" line, not a stale board
    setTimeout(connect, 1000)
  })
  daemon
    .connect()
    .then(() => daemon.subscribe(onEvent, ["task.snapshot"]))
    .then(() => {
      live = true
      frame()
    })
    .catch(() => {}) // onClose already scheduled the retry
}
```

```ts
import { Pane, pluginContext, RoveSocket } from "@sma1lboy/rove-plugin-sdk"

const ctx = pluginContext()
const pane = new Pane()

let tasks: any[] = []
let live = false
function frame() {
  pane.draw([
    `MY BOARD — ${ctx.taskTitle ?? "no task"}`,
    live ? "" : "  host unreachable — reconnecting",
    ...tasks.map((t) => `  ${t.status.padEnd(8)} ${t.title}`),
  ])
}

function connect() {
  const daemon = new RoveSocket()
  // Without this the pane goes silently blind on a daemon restart: its PTY
  // outlives the daemon, so it keeps drawing the frame above forever.
  daemon.onClose(() => {
    live = false
    frame()
    setTimeout(connect, 1000)
  })
  daemon
    .connect()
    .then(() =>
      daemon.subscribe((name, payload) => {
        if (name !== "task.snapshot") return
        tasks = (payload as any).tasks ?? []
        live = true
        frame()
      }, ["task.snapshot"]),
    )
    .catch(() => {}) // onClose scheduled the retry
}

pane.start()
pane.onKey((k) => { if (k.name === "q") pane.exit(0) })
pane.onResize(frame)
frame()
connect()
```

`pluginContext()` gives a pane the `taskId` it opened in, and its cwd is that
task's worktree — do not try to identify the task by matching cwd against
`worktreePath`, which is ambiguous for the task kinds that reuse an existing
checkout. Panes get no `taskTitle`; fetch it with
`roveJson(["api", "get-task", "--task-id", ctx.taskId!])`.

## Pane kit

A minimal terminal "page" helper for `[[panes]]` entrypoints: alternate
screen, raw-mode input, resize events, and absolute-addressed full-frame
draws. Bring your own framework for rich UIs.

| Export | Signature | Purpose |
|---|---|---|
| `Pane` | class | Terminal page surface. |
| `PaneOptions` | `{ exitOnCtrlC?, input?, output? }` | Constructor options; `exitOnCtrlC` defaults to exiting on `ctrl+c`. |
| `parseKeys` | `(chunk) => Key[]` | Parse a raw stdin chunk into key events. |

`Key`: `{ name: string, ctrl: boolean }`. Names for specials are `enter`,
`escape`, `tab`, `backspace`, `space`, `up`, `down`, `left`, `right`;
printables use their literal character.

### Drawing constraints

`Pane.draw(lines)` uses absolute cursor addressing. Keep these three rules in
mind or the embedded terminal will ghost-wrap:

1. **No newline flow.** Pass an array of complete rows; the kit positions each
   one with CUP and erases to EOL.
2. **Stay inside `pane.cols`.** Long rows wrap at the terminal edge. Mind CJK
   double-width characters.
3. **Redraw the whole frame on every update.** The screen is not scrollback;
   paint every row you want visible.

`Pane.start()` enters the alternate screen and clears it, which is what keeps
these rules workable: a pane runs through the user's interactive login shell,
so anything their rc files print lands in the terminal before your first
frame. Clear the screen yourself if you draw without the kit.

```ts
import { Pane } from "@sma1lboy/rove-plugin-sdk"

const pane = new Pane()
pane.start()

function frame() {
  pane.draw([
    "Hello Rove",
    `Width: ${pane.cols}  Height: ${pane.rows}`,
    "",
    "Press q to quit.",
  ])
}

pane.onKey((k) => { if (k.name === "q") pane.exit(0) })
pane.onResize(frame)
frame()
```

## Contract exports

The SDK re-exports the typed constants and envelope types that the daemon also
imports from `@sma1lboy/rove-plugin-sdk/contract`. This is the single source
for the event catalog and channel list, so host and SDK cannot drift.

| Export | Kind | Meaning |
|---|---|---|
| `PLUGIN_EVENT_NAMES` | `readonly string[]` | Every event a plugin can subscribe to. |
| `DAEMON_CHANNELS` | `readonly string[]` | Every broadcast channel this SDK knows. For what the RUNNING daemon has, call `hello()`. |
| `PluginEventName` | type | Union of event names. |
| `PluginEventEnvelope` | type | The `ROVE_PLUGIN_EVENT_JSON` envelope. |
| `PluginEventTask` | type | Task block embedded in envelopes that map to a task. |
| `DaemonChannelName` | type | Union of channel names. |
| `DaemonFrame` | type | One newline-delimited JSON socket frame. |

Event semantics (when each fires, what `detail` contains) are documented in
the per-event contract in the [plugin event reference](./PLUGIN-EVENTS.md).

## Compatibility aliases

For plugins written against the original `@sma1lboy/kobe-plugin-sdk` naming,
the SDK also exports `kobe`, `kobeJson`, and `KobeSocket` as aliases for
`rove`, `roveJson`, and `RoveSocket`.
