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
| `openPane` | `(qualifiedPaneId, opts?) => Promise<RoveRunResult>` | `rove plugin pane open`; opens one of your `[[panes]]`. |
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

## Socket client

`RoveSocket` is a newline-delimited JSON client for the daemon unix socket. It
gives you live broadcast channels that the CLI cannot push.

| Export | Signature | Purpose |
|---|---|---|
| `RoveSocket` | class | Daemon socket client. |
| `connect` | `(opts?) => Promise<void>` | Connect to `ROVE_SOCKET_PATH`. |
| `request` | `<T>(name, payload?) => Promise<T>` | One request → response; rejects on daemon error frames. |
| `subscribe` | `(handler, channels?) => Promise<void>` | Subscribe to channels (`role: "pane"`); omit channels for all. |
| `close` | `() => void` | End the socket. |

SDK consumers must always subscribe with `role: "pane"`. The SDK enforces this
so plugins never hold the daemon's GUI lifetime open.

Channel payloads are host-versioned `unknown`: validate what you read against
the shape your target Rove version actually emits. The channel names are the
`DAEMON_CHANNELS` constant:

`task.snapshot`, `issue.snapshot`, `active-task`, `update`, `engine-state`,
`attention.inbox`, `ui-prefs`, `keybindings`, `task.jobs`, `worktree.changes`,
`transcript.activity`, `session.deliver`, `tab.open`, `tab.close`,
`engine.lifecycle`, `notice.event`, `usage.snapshot`, `ui.prompt`.

Your handler also receives `daemon.stopping` at daemon shutdown — not a
channel, always delivered regardless of the filter.

```ts
import { Pane, RoveSocket } from "@sma1lboy/rove-plugin-sdk"

const pane = new Pane()
const daemon = new RoveSocket()
await daemon.connect()

let tasks: any[] = []
function frame() {
  pane.draw([
    "MY BOARD",
    "",
    ...tasks.map((t) => `  ${t.status.padEnd(8)} ${t.title}`),
  ])
}

await daemon.subscribe((name, payload) => {
  if (name === "task.snapshot") {
    tasks = (payload as any).tasks ?? []
    frame()
  }
}, ["task.snapshot"])

pane.start()
pane.onKey((k) => { if (k.name === "q") pane.exit(0) })
pane.onResize(frame)
frame()
```

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
| `DAEMON_CHANNELS` | `readonly string[]` | Every broadcast channel on the socket. |
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
