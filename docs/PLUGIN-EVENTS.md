# Plugin event reference

Every event a `[[events]]` hook can subscribe to, with its exact trigger
semantics, `detail` fields, and a real envelope. The one-line catalog lives in
[Writing Rove plugins](./PLUGIN-AUTHORING.md#event-catalog); this page is the
per-event contract.

Ground rules that apply to every event here:

- **Async observers.** Your command runs after the fact; exit code and output
  never block or change what happened.
- **The envelope** arrives as JSON in `ROVE_PLUGIN_EVENT_JSON` (SDK:
  `pluginEvent()`), with `ROVE_PLUGIN_EVENT`, `ROVE_PLUGIN_TASK_ID`, and
  `ROVE_PLUGIN_TASK_TITLE` as plain-var shortcuts:

```jsonc
{
  "event": "…",                   // the subscribed name
  "taskId": "01M0…",              // when the event mapped to a task
  "task": {                       // task context at emit time, when known
    "id": "01M0…", "title": "…", "repo": "/path", "branch": "…",
    "worktreePath": "/path", "vendor": "claude", "status": "active"
  },
  "vendor": "claude",             // agent-layer events: which engine reported
  "tabId": "tab-1",               // when the session is a Rove terminal tab
  "sessionId": "…",               // the engine's own session id, when known
  "detail": { /* per-event, documented below */ },
  "at": 1690000000000             // epoch ms at emit
}
```

- **Optional means absent**, never null-filled. A field listed below can be
  missing whenever its source didn't know it, so validate what you read.
- Engine support marks: **C** Claude Code · **X** Codex · **K** Kimi Code.
  Product-layer events are engine-independent.

## Task lifecycle

Sourced from field-level diffs of consecutive task-index snapshots, so every
mutation path fires them: RPC handlers, `land --then-archive`, the
`git worktree remove` sweep, adopt flows. The first snapshot after a daemon
start is baseline: pre-existing tasks never re-fire.

### `task.created` / `task.deleted`

A task appeared in / disappeared from the index. `task` carries the context
(on delete: the last known state). A task adopted WITH a worktree fires
`task.created` and `worktree.created` in the same batch, in that order.

### `task.changed`

Any watched field changed. Excluded on purpose: `position` (board-drag
noise), `updatedAt`/`createdAt` (ride every change), `quotaResume` (the
`quota.*` events cover it), `deletion` (`task.deleted` covers it), and
`prStatus` (its own event below).

| detail field | type | meaning |
|---|---|---|
| `fields` | `string[]` | which fields changed, from: `title`, `branch`, `worktreePath`, `status`, `archived`, `pinned`, `vendor`, `command`, `modelEffort`, `linkedWorkItem`, `scratch` |
| `from` | object | previous value per changed field (omitted when it was unset) |
| `to` | object | new value per changed field (omitted when now unset) |

```jsonc
{ "event": "task.changed", "taskId": "01M0…",
  "detail": { "fields": ["title", "pinned"],
              "from": { "title": "scratch", "pinned": false },
              "to":   { "title": "fix flaky test", "pinned": true } } }
```

### `task.archived`

`archived` flipped false→true, by any path. Restores (true→false) do NOT
fire this; they show up as a `task.changed` with `archived` in `fields`.
No extra detail; the task context is the payload.

### `task.landed`

The task's branch merged into its base repo. This is the one task event still
emitted by its handler, because the merge detail never reaches the snapshot.

| detail field | type | meaning |
|---|---|---|
| `strategy` | `"merge" \| "squash"` | how the branch landed |
| `landedOn` | string | the base branch that received it |
| `commit` | string | the merge/squash commit sha |

### `task.pr-changed`

The task's PR status changed. Compared with the PR poller's own semantics:
`lastCheckedAt`/`lastError` churn does not count as change.

| detail field | type | meaning |
|---|---|---|
| `from`, `to` | `TaskPRStatus` | each optional (absent when there was/is no PR): `provider`, `lifecycle`, `checkState`, `number?`, `url?`, `title?`, `baseRef?`, `headRef?`, `reviewDecision?`, `mergeable?` |

Typical use: toast when `to.checkState` flips to failing, or auto-archive on
`to.lifecycle === "merged"`.

### `worktree.created`

A managed task's worktree materialized: lazy ensure on first open, adopt of
an external worktree, or scratch-adopt. Fires once per task (empty → set
path transition); a worktree MOVE is a `task.changed` on `worktreePath`.

## Issues, notes, delivery, attention

### `issue.changed`

A daemon-tracker issue mutated.

| detail field | type | meaning |
|---|---|---|
| `repo` | string | repo root the issue store is keyed by |
| `op` | object | the raw mutation op, e.g. `{ "type": "create", "title": "…" }`, `{ "type": "set-status", "id": 3, "status": "done" }` |

### `note.filed`

A session filed a field note (`rove api note`).

| detail field | type | meaning |
|---|---|---|
| `repo` | string | the author task's repo |
| `author` | string | the author task's display title |
| `text` | string | the note, capped at 512 chars (`…`-suffixed when cut); the envelope rides every subscriber's spawn env, so read the full body from `rove api note-list` |
| `length` | number | the UNCAPPED length |
| `routed` | boolean | whether a live dispatcher seat received the relay |
| `persisted` | boolean | whether the durable note store took it |

### `message.delivered`

Text was dispatched toward a task's live session (`rove api dispatch`, or a
note relay). **This reports reach, not receipt**: delivery is
broadcast-based, so the daemon cannot observe the paste itself.

| detail field | type | meaning |
|---|---|---|
| `source` | `"dispatcher" \| "note"` | which flow sent it |
| `tabId` | string? | target tab, when addressed |
| `length` | number | text length (the text itself is not echoed) |
| `clients` | number | attached connections at send time; `0` means nothing can have delivered it |

### `attention.handled`

The human resolved an attention-inbox episode.

| detail field | type | meaning |
|---|---|---|
| `how` | `"dismissed" \| "read"` | which action resolved it |
| `tabId` | string? | tab-precise episodes carry their tab |

## Automations and quota

### `automation.dispatched` / `automation.skipped` / `automation.failed`

One scheduled-automation run finished with that outcome. All three share one
detail shape:

| detail field | type | meaning |
|---|---|---|
| `automationId` | string | the schedule's id |
| `name` | string | its display name |
| `repo` | string | target repo |
| `status` | string | the precise outcome: `dispatched`, `skipped_precheck`, `skipped_missed`, `skipped_unavailable`, `dispatch_failed` |
| `trigger` | `"scheduled" \| "manual"` | cron tick or run-now |
| `scheduledFor` | ISO string | the occurrence this run was for |
| `error` | string? | present on skips/failures: the precheck output, the missed-grace message, or the dispatch error |

`taskId` is set when a task was created (always for `dispatched`; for
`dispatch_failed` when the task exists but its engine did not start).

### `quota.exhausted`

A rate-limited turn armed the auto-resume schedule.

| detail field | type | meaning |
|---|---|---|
| `vendor` | string | which engine's quota is exhausted |
| `resumeAt` | ISO string | when the exhausted window resets (the scheduled resume time) |

### `quota.resumed`

The resume schedule came due and the continue prompt was sent.

| detail field | type | meaning |
|---|---|---|
| `delivered` | boolean | whether a live engine session accepted it; `false` means the session had died and nothing was resumed |

## Sessions and crashes

### `session.start` / `session.end` · C, X (start only), K

The engine's own session lifecycle, from its hooks. `session.end` never
fires on a crash. That is what `session.exited` is for.

### `session.exited`

A hosted PTY child died **abnormally** (non-zero exit or a signal; clean
exits are never recorded). Watched off the PTY host's durable death records,
so it fires even though the host is a separate process. This is the crash
signal.

| detail field | type | meaning |
|---|---|---|
| `key` | string | the PTY session key, `taskId::tabId` |
| `tabId` | string? | parsed from the key |
| `pid` | number \| null | the dead child's pid |
| `code` | number \| null | exit code |
| `signal` | string \| null | killing signal, when signaled |
| `exitedAt` | ISO string | when it died |
| `tail` | `string[]` | last output lines, ANSI-stripped: the death note |

```jsonc
{ "event": "session.exited", "taskId": "01M0…",
  "detail": { "key": "01M0…::tab-1", "tabId": "tab-1", "pid": 4242,
              "code": 1, "signal": null, "exitedAt": "2026-08-26T…",
              "tail": ["Error: ENOMEM", "  at spawn (…)"] } }
```

## Turns and activity

Two views of the same engine, at different granularities. **Activity states**
(`agent.*`) are the reduced per-task+tab badge states, deduped, so you see
transitions, not every report. **Turn edges** (`turn.*`) are one event per
hook report, unreduced.

### `agent.running` / `agent.idle` / `agent.turn-complete` / `agent.permission-needed` / `agent.rate-limited` / `agent.error`

Activity-state transitions. Keyed per task+tab: the same state twice in a
row is suppressed. `tabId` is present when the reporting session identifies
its tab. No detail beyond the envelope.

### `turn.prompt` · C, X, K

A user prompt entered the engine (`turn-start`). One per turn.

### `turn.complete` · C, X, K

The turn finished. When the engine's transcript yielded telemetry, `detail.turn`
carries it (absent otherwise, never fabricated):

| detail.turn field | type | meaning |
|---|---|---|
| `id` | string | vendor-stable turn id |
| `model` | string? | model that ran the turn |
| `usage` | object? | token usage: `input_tokens`, `output_tokens`, plus cache fields when the vendor records them |
| `startedAt` / `endedAt` | number | epoch ms bounds of the turn |

```jsonc
{ "event": "turn.complete", "taskId": "01M0…", "vendor": "claude",
  "detail": { "turn": { "id": "msg_…", "model": "claude-sonnet-5",
                        "usage": { "input_tokens": 1200, "output_tokens": 340 },
                        "startedAt": 1690000000000, "endedAt": 1690000042000 } } }
```

### `turn.failed` · C, X (emulated), K

| detail field | type | meaning |
|---|---|---|
| `failure` | `"rate_limit" \| "billing" \| "other"` | normalized failure class |
| `note` | string? | the raw vendor error type, for humans |

A `rate_limit` failure also arms auto-resume, so expect a `quota.exhausted`
right after when the quota probe finds a reset time.

### `turn.interrupted` · K (native), X (emulated)

The user interrupted the turn. Exists because Kimi fires `Interrupt` INSTEAD
of `Stop`. Without this verb an interrupted Kimi turn would strand in
`running`.

## Tools: the high-volume family

### `tool.pre` / `tool.post` · C, X, K · `tool.failed` · C

One event per engine tool call, before/after. **Volume-gated install**: the
underlying engine hooks are written into engine config only while some
enabled plugin subscribes to a `tool.*` event; enabling/disabling such a
plugin takes effect at the next Rove start.

| detail field | type | meaning |
|---|---|---|
| `tool.name` | string? | normalized tool name (`Bash`, `Edit`, …); vendor field spellings die in the adapter |
| `tool.id` | string? | the vendor's tool-use id, when it has one |

Expect real volume: a busy session fires dozens per minute. Keep the hook
sub-second and silent.

## Attention (engine blocked on a human)

### `attention.permission` · C, X, K · `attention.question` · C

The engine stopped and is waiting. One `awaiting-input` report splits on why:

| detail field | type | meaning |
|---|---|---|
| `waiting` | `"permission" \| "input"` | permission dialog vs. a question/elicitation |

## Context compaction

### `context.pre-compact` / `context.post-compact` · C, X, K

| detail field | type | meaning |
|---|---|---|
| `compact.trigger` | `"manual" \| "auto"` | who started the compaction |

## Subagents

### `subagent.start` / `subagent.stop` · C

A nested agent began/ended under the session.

| detail field | type | meaning |
|---|---|---|
| `subagent.type` | string? | the subagent's declared type |
| `subagent.id` | string? | its id, when the vendor names one |

## UI moments

Reported by the attached TUI; they fire only while a TUI is attached.

### `task.opened` / `project.opened`

The user selected/entered a task (or a project's main row). No detail.

### `file.will-open` / `file.opened` / `file.closed`

Files-pane opens, before and after, and the editor tab leaving the strip.

| detail field | type | meaning |
|---|---|---|
| `path` | string | absolute file path |
| `via` | `"plugin" \| "editor" \| "external"`? | on `file.opened`: which route opened it |
| `title` | string? | on `file.closed`: the closing tab's title |

`will-` precedes the action but cannot block it. Observers only.

### `tab.opened` / `tab.closed`

A workspace terminal tab appeared/went away. Mount-time restores don't fire.

| detail field | type | meaning |
|---|---|---|
| `tabId` | string | the tab's id |
| `kind` | string | `engine`, `shell`, `command`, or a content kind |
| `title` | string? | when titled |
| `vendor` | string? | engine tabs: which engine |
| `purpose` | string? | command tabs: their declared purpose |

## Plugin registry

### `plugin.enabled` / `plugin.disabled`

YOUR plugin's registry entry transitioned, delivered only to the affected
plugin, so subscribing is how you get lifecycle callbacks without polling.
`plugin.disabled` is the last event a disabled plugin's hooks receive.

| detail field | type | meaning |
|---|---|---|
| `pluginId` | string | your id (matches `ROVE_PLUGIN_ID`) |

## What is NOT an event

Threshold policies ("worktree dirtier than N", "usage above X%") stay out of
the catalog: they are plugin judgment. Subscribe to the daemon's broadcast
channels over the raw socket (SDK: `RoveSocket.subscribe`, catalog:
`DAEMON_CHANNELS` in the contract module) and decide yourself:
`worktree.changes` and `usage.snapshot` carry the state these policies need.
If a MOMENT you need is genuinely missing, ask via `rove feedback`; the
plumbing makes additions cheap.
