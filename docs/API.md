# rove api

`rove api` is Rove's scriptable surface: the verbs a shell script, or
another AI agent, uses to spawn tasks, supervise them, read their output,
and land the winner, with no TUI attached.

Each invocation is a short-lived process: connect to (or auto-start) the
daemon, do the work, print one JSON object to stdout, exit. Read-only verbs
marked *offline* below skip the daemon entirely.

`rove api schema` is **the** source of truth when this page and the binary
disagree: names, types, required flags, and enum values, as JSON. Agents
should read it once and drill in with `--verb <name>` instead of parsing
this page. The rest of the binary is documented in the
[CLI reference](./CLI.md).

To teach a coding agent this surface, install the bundled agent skill with
`rove skill install` instead of pasting this page into a prompt.

## One contract, three transports

The verbs on this page are one contract — names, flags, results, error codes —
served by one executor over three transports:

| Transport | Call | Answer |
| --- | --- | --- |
| CLI | `rove api <verb> --flag value` | the result on stdout, or `{ "error": … }` on stderr (below); `--envelope` prints the envelope instead |
| Daemon socket | request `api.invoke` `{ "verb", "params" }` | the envelope |
| Bridge WebSocket (`rove --web`, the phone apps) | op `api.invoke` `{ "verb", "params" }` | `result`, or the full `error` object |

The envelope is `{ "apiVersion", "ok": true, "result" }` or
`{ "apiVersion", "ok": false, "error": { "message", "code", … } }`, where
`error` is exactly the object the CLI prints on stderr. `params` are keyed by
flag name (`"task-id"`, not `taskId`) and typed as `schema --verb` lists them:
a string, a number for `int`/`uint`, a boolean for `bool`, a string list for
`csv`.

`apiVersion` is the one version of this contract. `rove api schema`, both
`hello`s (daemon and bridge) and every envelope report the same number.

Over the socket and the bridge the verb runs inside the daemon or the bridge
process, not beside the caller, so three things differ from the CLI:

- **Paths must be absolute.** There is no caller cwd to resolve `--repo .`
  against; a relative path is `BAD_FLAG`. Without `--task-id`, no `$ROVE_TASK_ID`
  applies either: the target is the active task.
- **No stdin.** `--prompt-file -` is `BAD_FLAG`; pass `--prompt`.
- **No streaming.** `watch` and `pane-graphics` (`cliOnly: true` in `schema`)
  answer `CLI_ONLY_VERB`; subscribe to the daemon's channels instead.

## Run a verb on another machine

With machines registered ([MACHINES.md](MACHINES.md)), a verb can run on any
of them. It crosses the ssh-forwarded daemon socket as `api.invoke` and
executes inside that machine's daemon: its git, its PTY host, its engine
logins. This machine only routes.

- `--machine <alias>` on any verb runs it there:
  `rove api add --machine narwhal --repo /srv/rove --prompt "…"`. Over the
  socket or the bridge, pass `"machine": "<alias>"` beside `verb` and
  `params`. `local` names this machine. `auto` places the call: the machine with the
  fewest tasks in progress (this one wins a tie; a machine that does not
  answer is skipped), reported on stderr as `--machine auto → <alias>`.
- A `--task-id` that lives on another machine runs on that machine without
  `--machine`, so a remote task the sidebar shows answers `send`,
  `read-output`, `delete` and the rest like a local one.
- The rules for socket callers above apply on the far side: `--repo` and other
  paths are absolute paths **on that machine**. `--prompt-file` is read here
  and sent as `--prompt`.
- A forwarded call is never forwarded again, and `list` over the socket
  returns only the answering daemon's own tasks, so two machines that
  registered each other cannot bounce a verb between them.

The bridge logs every destructive verb (`delete`, `land`, `remove-worktree`,
`tab-close`, `issue-delete`, `routine-delete`, `note-delete`) by verb and id,
as it does its own destructive ops.

## Socket limits and recovery

Daemon and standalone PTY Host requests use newline-delimited JSON. Each request
may contain at most **8 MiB of UTF-8 wire bytes**, excluding its terminating newline.
This includes JSON escaping and envelope fields. The receiver closes the connection
as soon as an unfinished or complete frame exceeds the limit; it sends no parse-error
response for that frame. Multiple smaller frames may share a chunk. Split UTF-8
characters survive chunk boundaries.

The limit uses the existing 8 MiB outbound queue budget as a per-connection resource
envelope. It allows multi-megabyte prompts and PTY input; it is not an OS socket limit.
Shorten oversized request fields. PTY writers can divide input into ordered `pty.write`
requests. Receive framing scans each new chunk once and grows storage geometrically,
so a long line sent in small chunks does not repeatedly scan its accumulated prefix.

A slow reader also has an 8 MiB queue of unsent response/event bytes, in addition to
the socket's already accepted write. Complete snapshots for `task.snapshot`,
`active-task`, `update`, `attention.inbox`, `gates`, `ui-prefs`, `worktree.changes`,
`transcript.activity`, `usage.snapshot`, and `usage.context` replace only an older
queued snapshot of the same channel. Other frames retain their order, including
per-task engine/job updates, per-repo issues, commands, keybinding notifications,
RPC responses, lifecycle events and PTY bytes. If the remaining queue exceeds the
budget, the server disconnects that reader. It never silently discards the last
snapshot of a different channel to make room.

Rove's GUI and pane orchestrators reconnect and subscribe again to receive current
snapshots. Outstanding RPCs reject on disconnect, including requests without a
normal deadline. One-shot API callers see a failure; commands are not automatically
retried because the server may already have applied them. Transient events have no
replay log, so a disconnection does not promise recovery of every command or event.
PTY client disconnection detaches the reader and leaves its hosted children running.

## The orchestration loop

Running many agents well is graph engineering, not prompt engineering:
isolated attempts as nodes, your judgment at the gates. Four moves, one
verb each.

**Fan out.** One prompt, N isolated attempts, one call. `add` is the
create verb whether you want one task or five; `--count N` (or `--agents`
for a mixed fleet) is what makes it a parallel round:

```bash
rove api add --repo "$PWD" \
  --agents claude:2,codex:2,copilot:1 \
  --prompt "Try independent approaches to simplify the auth flow."
```

Every `add` response carries a `home` field: the Rove home the tasks were
actually written to. A `ROVE_HOME_DIR` override that collapses (an unquoted
shell variable holding a whole `env` prefix does not word-split) otherwise
reads as a plain success — same `count`, same empty `failures`, different
machine state. Compare it against the home you meant before trusting the round.

Siblings with no `--title` are named from `--prompt` at creation, so a fan-out
is comparable the moment it returns rather than showing N identical `(new
task)` rows until the engines write their first transcripts.

**Completion.** A worker spawned from another Rove task sends its outcome
back to the dispatching engine tab: creation records the dispatcher
(task + tab), so a bare `send` routes home without any id in hand; no
stored report, no blocking wait. Silence is a checkpoint, never a verdict:

```bash
rove api send --prompt "succeeded: auth flow simplified (branch fix/auth-flow)"
```

**Observe.** Read the engine's own structured session, never scrape a TUI
screen:

```bash
rove api read-output --task-id <id>    # newest messages first, honest terminal fallback
rove api read-output --task-id <id> --tab tab-3   # that tab's own conversation or terminal
```

**Fan in.** Compare the attempts, then land one:

```bash
rove api collect --group <groupId>     # the whole round's health, one read
rove api collect --task-ids a,b,c      # or name the attempts yourself
rove api land --task-id a              # merge the winning branch
```

## Output + exit-code contract

- **Success** → one JSON object on stdout, newline-terminated, exit 0.
  `--pretty` indents it (humans only).
- **Error** → `{ "error": { "message", "code", ... } }` on stderr. Common
  rejections additionally carry `hint` and `nextCommandArgs` (argv runnable
  verbatim) so a caller can self-heal without parsing prose.
  A refusal the daemon raises keeps its own machine code — `DIRTY_WORKTREE`,
  `LAND_CONFLICT`, `MISSING_REF`, `ISSUE_NOT_FOUND`, `TASK_DELETING`,
  `GIT_COMMAND_FAILED`, `BAD_EVENT_KIND`, the `EMPTY_BRANCH` pair — in
  `code`, not in the prose. `RPC_ERROR` now means what it says: the daemon
  failed without naming a reason. Never match on `message`; it is written for
  a human and it no longer repeats the code.
- Exit codes: `0` success · `1` handler/RPC failure · `2` usage errors
  (unknown verb, bad/missing flag, unreachable daemon — wherever they are
  raised, including a handler rejecting its own argument) · `3` a parallel
  round that did not fully succeed, **or** a tick `should-run` /
  `send --if-runnable` refused (the verdict is on stdout). Exit 3 on a
  parallel round does **not** promise anything was created: `--count 1`
  takes the same path, so a lone failure returns `count: 0` with an empty
  `tasks`. The full payload still goes to stdout, so whatever *was* created
  is never lost.
- `rove api <verb> --help` prints that verb's usage and exits 0.
- `--envelope` prints every outcome, success or error, as one envelope on
  stdout ([above](#one-contract-three-transports)); exit codes do not change.

### Codes the CLI itself raises

Separate from the daemon's refusals above — these never cross the socket:

| Code | Raised when |
| --- | --- |
| `MISSING_VERB` | `rove api` with no verb. |
| `BAD_VERB` | A verb (or `schema --verb` / `--group`) name that never existed. |
| `UNKNOWN_VERB` | A verb that was REMOVED; `nextCommandArgs` is its replacement. |
| `MISSING_FLAG` | A required flag was omitted. |
| `BAD_FLAG` | Unknown flag, bad enum value, or a value the verb could not parse. |
| `BAD_TAB` | A `--tab` value that is not `new` or `tab-N`. |
| `BAD_DAEMON` | The daemon could not be reached or started. |
| `DAEMON_VERSION_SKEW` | The daemon is a different build and does not serve this verb. |
| `CLI_ONLY_VERB` | `api.invoke` (socket or bridge) named a verb that streams over stdout/stdin (`watch`, `pane-graphics`). |
| `UNKNOWN_MACHINE` | `--machine` (or `"machine"` over the socket) names no registered machine. |
| `MACHINE_UNREACHABLE` | The machine a verb was routed to did not answer over ssh. |
| `NO_REMOTE_CHECKOUT` | `--repo` names a checkout here, and the target machine has no checkout of that repo (`repo-match`). |
| `UNPUSHED_BASE` | `--base-branch` has commits no remote has; the target machine could not base a task on it. |
| `INBOUND_DENIED` | The target machine's inbound policy refuses this verb's class from other machines (`rove machine inbound`). |
| `PUSH_FAILED` | `publish` (or `land` of a remote task) could not push the task's branch. |
| `MACHINE_VERSION_SKEW` | That machine's Rove predates forwarded verbs; upgrade it. |
| `MISSING_TARGET` | No `--task-id`, no `$ROVE_TASK_ID`, no active task — nothing was named. |
| `MISSING_TEXT` | `row-token` was given neither `--text` to write nor `--clear` to remove. |
| `TASK_NOT_FOUND` | An id WAS named and does not resolve. |
| `TAB_NOT_FOUND` | A `--tab tab-N` the task has no live (or restorable) tab for. |
| `TAB_COLLISION` | `tab-new` found its freshly allocated tab id already running a session; no new tab was created, retry. |
| `FILE_NOT_FOUND` | `tab-new --kind editor --file` names no file in the task's worktree. |
| `NO_EDITOR` | `tab-new --kind editor` found no editor: none set in Settings → General → Editor, `$VISUAL`/`$EDITOR` unset, and none of nvim/vim/emacs/nano installed. |
| `PANE_NOT_FOUND` | `tab-new --kind pane --pane` names no pane of an enabled plugin. |
| `TAB_NOT_SPLITTABLE` | `tab-split` on a content tab; only terminal tabs split. |
| `LAST_LEAF` | `tab-split --action close` on the only pane; close the tab instead. |
| `RESET_ENGINE` | `tab-split --action reset` on a pane that runs an engine; only shell panes reset. |
| `RUN_NOT_FOUND` | `routine-respond --run` names no routine run (unknown, or pruned from the last 100). |
| `RESPONSE_TOO_LARGE` | A `routine-respond` response or a `report --summary` over the 32,000-character cap. |
| `DELIVERY_NOT_FOUND` | `report --delivery` names no delivery (unknown, or pruned past the newest 50 for its task). |
| `GATE_NOT_FOUND` | `gate-answer` / `gate-withdraw` names no gate. |
| `GATE_NOT_OPEN` | The gate is already answered or withdrawn. |
| `BAD_OPTION` | `gate-answer --option` is not one of the gate's option keys (or the gate is free-text only). |
| `NO_ENGINE_TAB` | The task has live tabs but none of them is an engine, so there is nothing to deliver to or interrupt. |
| `NOT_A_REPO` | `--repo` does not point at a git repository. |
| `INVALID_BRANCH` | `--branch` is a name git will not accept (`git check-ref-format --branch`). |
| `REPO_UNRESOLVABLE` | `--repo` resolved, but the repository is gone or unreadable. |
| `NO_WORKTREE` | The task has no materialized worktree yet. |
| `BASE_CHECKOUT` | `delete` was aimed at the project's own checkout, not a Rove worktree. |
| `CALLER_WORKTREE` | `delete` was run from inside the worktree it would remove. |
| `HISTORY_REQUIRED` | `read-output --source history` on an engine with no history reader, or on a non-engine tab. |
| `HISTORY_UNREADABLE` | The engine's history exists but could not be parsed. |
| `CURSOR_INVALID` | A `--cursor` value this build cannot decode. |
| `CURSOR_TASK_MISMATCH` | The cursor belongs to a different task. |
| `SOURCE_CHANGED` | The cursor's source/session/tab moved under it. |
| `TAB_RESTORED` | The `--tab` exists with its scrollback but nothing runs in it; pass `--respawn`. |
| `ENGINE_NOT_RUNNING` | The tab's engine exited into a plain shell, so a paste would run as shell commands. |
| `ENGINE_PROBE_FAILED` | The `ps` probe behind that check failed or blew its deadline, so the tab's engine was never read. |
| `DISPATCHER_UNREACHABLE` | A bare `send` whose dispatcher tab is dead and whose task has no live engine. |
| `NOT_DELIVERED` | The task was created but the prompt never reached its engine. |
| `EMPTY_SUCCESS_REPORT` | A `succeeded:` report from a branch with 0 commits; commit, or pass `--allow-empty`. |
| `SESSION_FAILED` | A hosted engine session could not be started or written to. |
| `ENGINE_LIMIT` | Starting a session would pass `engine.maxLiveSessions`; nothing was started. |
| `ENGINE_ADMISSION_UNAVAILABLE` | The running PTY host predates atomic admission; update and restart it before a capped launch. |
| `ENGINE_ADMISSION_BUSY` | The session inventory kept changing during admission; nothing was started, so retry the returned command. |
| `BAD_EFFORT` | The task's engine declares no effort levels, or not that one. |
| `BAD_MODEL` | The task's engine declares no model flag, so a model cannot be passed to it. |
| `CONFLICTING_FLAGS` | `add --tier` beside `--command`, `--model`, `--effort` or `--agents` — the tier already fills those. |
| `TIER_UNAVAILABLE` | Auto routing is not configured, or the tier's target cannot start (engine not listed, not logged in, model/effort its engine cannot carry). |
| `PARTIAL_FANOUT` | A parallel round with at least one failure (exit 3). |
| `SKIPPED` | `should-run` or `send --if-runnable` refused the tick (exit 3). The verdict is the stdout payload, not an error envelope. |
| `UNSUPPORTED` | `interrupt` on an engine that never declared how it is interrupted. |
| `WATCH_TIMEOUT` | `watch` reached `--timeout` before any `--until` state; nothing has happened YET. |
| `DAEMON_GONE` | The daemon died mid-`watch`; the verb never reconnects silently. |

`DELIVER_FAILED` and `CREATE_FAILED` are not error codes in that sense: they
only ever appear inside a `PARTIAL_FANOUT` payload, on `failures[].error.code`,
naming which stage lost that one sibling. A caller reads them from stdout.

Flag parsing: `--key value` and `--key=value` both work; boolean flags may
be given bare (`--force` ⇒ true) or explicitly (`--pinned=false`);
`--tab` / enum / positive-int values are validated against the verb's
spec, and unknown flags are rejected (exit 2). `--repo` resolves relative
paths against `$PWD` (`~` expanded). `spawn-task` is an alias of `add`.

Engines are chosen by COMMAND, not by a vendor enum: `--command` takes an
engine id from `engine-list` (`claude`, `codex`, `copilot`, `kimi`, `pi`, `omp`, `bob`, the shipped
contrib engines whose CLI is installed — `gemini`, `opencode`, `cursor`,
`grok`, `droid`, `amp`, `devin`, `qodercli`, `cline`, `kiro`, `maki`, `antigravity`, `hermes`, `kilo`, `mastracode` — plus any
engine you registered) **or** a full command
line Rove runs verbatim
(`--command "codex --search"`). Nothing validates an engine's flags, so probe
an unfamiliar one with `<cmd> --help` before dispatching. See
[ENGINES.md](./ENGINES.md#engine-presets-and-protocols) for how the protocol
Rove speaks to a command is derived from it.

Removed verbs have no aliases: `fan-out` → `add --count N`, `archive` →
`delete` (there is no hide-without-delete any more; the branch survives unless
you pass `--delete-branch`), the per-field task edits (`set-vendor`, `rename`,
`set-branch`, `set-command`, `set-effort`, `set-model`, `set-status`, `pin`) →
`update`, `issue-set-status` → `issue-update --status`, and
`routine-set-enabled` → `routine-update --enabled`. Calling any of them returns
`UNKNOWN_VERB` with the replacement in `nextCommandArgs`.

## discover

- `schema` *(offline)*: the API, as JSON. Default is a compact index
  (groups + verb summaries, no flags); drill in with `--verb <name>` (full
  flag detail for one verb), `--group <g>`, or `--all` (everything; large).
  Includes an `apiVersion` agents can gate on.
- `engine-list` *(offline)*: every engine Rove can launch — the same set the
  TUI's engine pickers offer: built-ins, your registered presets, the shipped
  contrib engines whose CLI is on `PATH`, and engines contributed by enabled
  plugins — each with
  the RAW command it runs, its display
  name, its `protocol` (the adapter Rove speaks to it: history reads,
  trust pre-answer, first-message delivery; `generic` = none), and its
  `models` — what the engine can name for `--model` (suggestions, not a
  closed set; `null` = Rove cannot list them for this engine). A plugin engine
  reports its own id as its `protocol` — the plugin's manifest carries the
  screen rules and identity Rove drives it with, so it is not `generic`. What
  it prints is what a launch runs, so an entry can be copied into `--command`
  verbatim or edited first. Returns `{ engines }`.

## read

- `list`: list all tasks. Returns `{ tasks, activeTaskId }` — `activeTaskId`
  is the shared focus that verbs using the implicit target (`send`,
  `pane-open`, `pane-close`, `read-output` without `--task-id`) default to;
  `null` means no active task. Reading it back is the audit trail for any
  delivery that omitted `--task-id`.
  - `--repo PATH`, `--status S1,S2` and `--activity A1,A2` narrow the list.
    Flags combine with AND; a comma list matches any of its values.
    `rove api list --activity permission_needed,error` is every task waiting
    on you. With `--activity`, each returned task carries the `.activity` it
    matched (the same view `collect` reports); a task whose engine state Rove
    cannot read, such as one that never started or one on another machine,
    never matches. `--repo` never matches another machine's task, and
    `unresolvableRepos` beside `tasks` names task repos it could not compare.
    An unknown status or state is refused with `BAD_FLAG`.
- `get-task --task-id <id>`: one task's metadata; `.running` = any of its
  hosted engine tabs is live (not just the first); `.tabs` = the task's
  terminal tabs (`id`/`kind`/`title`/`vendor`/`liveVendor`/`lastTitle`/
  `autoTitle`/`sessionId` + per-tab `alive`/`engineAlive`): the discovery read for
  `send --tab tab-N`. `sessionId` is the conversation the tab pinned — the
  exact id `claude --resume <id>` (or the engine's own resume verb) reopens,
  and the one `send --tab tab-N --respawn` brings back. Present on engine
  tabs that recorded one, dead tabs included; absent for engines that mint
  their own id late and for tabs that never spawned.
  `liveVendor` on a live tab is a fresh foreground process walk (which
  engine actually runs in the tab's shell right now. A hand-typed `claude`
  in a shell tab counts, a ctrl+C'd engine doesn't); dead tabs report the
  last recorded value.
  `alive` and `engineAlive` answer different questions and a fleet reader
  needs both: `alive` is the tab's hosted PTY SESSION, `engineAlive` is
  whether an ENGINE PROCESS is running inside that session's tree. keepAlive
  `exec`s a login shell where an engine exits, so `alive: true,
  engineAlive: false` is a tab holding a bare zsh prompt — the per-tab form
  of the session-outlives-its-engine hazard described under `collect`'s
  `.running` below, and the field that settles it in one read instead of a
  `collect` hop or your own `ps` walk. Both are three-valued: `null` means
  nothing walked the tab (a `ps` that failed, a pty host that could not be
  asked), which is "couldn't look" and never a verdict. **Never read `null`
  as `false`** — the same rule `.running` states, for the same reason.
  A dead tab whose session ended abnormally also carries `exit`
  (`code`/`signal`/`at`); clean exits stay `exit: null`. A live PTY session
  the persisted snapshot does not list still gets a row, marked
  `unregistered: true`; an alive engine is never invisible here.
  `.task.dispatcher` (`{taskId, tabId}`) = the Rove session that created the
  task, when one did: the lineage read for a parallel round's parent.
  `.task.command` = the raw launch command pinned on the task; `.task.vendor`
  = the protocol derived from it. `.task.prompt` = the full text of the
  prompt `add --prompt` delivered into the task's engine (verbatim, never
  truncated), recorded at delivery time — it is the durable copy of the task
  brief, surviving a dead engine or lost context where the engine transcript
  does not; absent when the task was created without a prompt or the paste
  never landed. `.task.baseRef` = the branch the task was cut from
  (`add --base-branch`), the fork point `collect` measures against.
  `.task.prStatus` = the branch's PR as the daemon last polled it
  (`lifecycle`, `number`, `url`, `lastCheckedAt`) — including
  `.prStatus.checkState`: `none` (no PR) / `pending` / `passing` / `failing` /
  `unknown`. This is Rove's CI truth for the branch, and `passing` is what
  "CI is green" means; a local test run is a different claim. Absent until
  the poller has seen a PR for the branch.
  `runnability` is the `should-run` verdict for the whole task, so a
  dashboard shows the answer a scheduler would act on.
- `collect [--task-ids a,b,c] [--group GROUPID] [--repo PATH]`: read-only
  health snapshot of a parallel round — the one read that answers "what is
  this round's status right now" without fanning out to `get-task` per task.
  Select the tasks by fan-out round (`--group`, the `groupId` that
  `add --count` returns), by repo, or by explicit ids.
  Each task also carries `runnability` (the `should-run` verdict).

  With `--repo`, a repo path that no longer resolves to a readable git
  repository is reported, never filtered away: the target failing to resolve
  is a `REPO_UNRESOLVABLE` error naming the path, and a task whose own repo
  will not resolve is listed in `unresolvableRepos` beside `tasks`. An empty
  `tasks` list is only "this round is empty" when `unresolvableRepos` is
  absent — the same null-versus-empty distinction `pty-list` and
  `discover-adoptable` keep.

  Per task: identity, branch, lineage (`.dispatcher`, `.groupId`), plus

  - `.running` — `true` / `false` / `null`. Is an ENGINE PROCESS alive in
    any of the task's engine tabs: the pty host's session inventory joined
    with a live `ps` walk of each session's tree. Both halves are load
    bearing. A session outlives its engine (keepAlive drops the tab into a
    login shell), so the inventory alone reported a task as running for
    hours after its engine was reaped. And `null` means the pty host could
    not be asked at all — "couldn't look", never "nothing is running", the
    same distinction `pty-list` publishes as `sessions: null`. **Never treat
    `null` as `false`**: a cleanup loop that does will delete worktrees
    holding live work. Still process truth, not the cached status field
    `list` reports, which lags and will happily call a working fleet idle.
  - `.activity` — `{state, at, forMs, detail?, source?}` from the daemon's
    activity registry: the engine's state and how long it has been in it.
    States: `idle` and `turn_complete` are both at rest (a precheck asking
    "is it free?" must accept either); `running`; `permission_needed`;
    `rate_limited` (clears on its own); `error` (the last turn failed,
    `.detail.note` carries the engine's text); `dead` (the engine process
    exited). An engine with no failure hook (codex) can die on its first turn
    without telling the daemon; when its own error row is at the bottom of
    its screen, the state reads `error` with `source: "screen"` instead of
    `idle`. `forMs` is the "stuck for 40 minutes" number. `null` when the
    registry cannot answer (daemon restarted, task never observed) — an
    honest unknown, never a fabricated idle. `.activity.state` disagreeing
    with `.running` is itself the signal: `running: false` with a
    `permission_needed` state is a worker that died at a prompt. The daemon
    observes this without an attached TUI, on a slower cadence (~60s) than
    it uses for one.
  - `.tabs` — the same per-tab join as `get-task` (pick a `send --tab`
    target without a second hop). A tab whose session died abnormally
    carries `.exit` with `code`/`signal`/`at`/`layer` **and** `tail`, the last
    lines the session printed, so a crash comes back with its cause attached.
    The tail rides along only when the durable record describes that same
    death. `layer` says WHICH process the record describes, without which
    `code` and `signal` cannot be read together. `"pty"` is the tab's own
    session child, on a dead tab: a signalled session has no wait-status
    code, so `code` then comes from the wrapper's own `Engine exited (code
    N)` banner and belongs to the ENGINE, while `signal` belongs to the
    session that outlived it. `"engine"` is the AI process gone from a tab
    whose SESSION IS STILL ALIVE (`alive: true, engineAlive: false` — the
    login shell the tab keeps in its place); it is reported for a clean
    engine exit too, because `code: 0` ("the human quit their agent") and
    `code: 143` ("it was SIGTERMed and there is unfinished work") are exactly
    what a fleet reader is trying to tell apart. `atApproximate: true` on
    such a row means `at` is when the daemon DISCOVERED the death, not when
    it happened — see the `inspect` `sessionExits` note below.
  - `.changes` — uncommitted files (`added`/`deleted`). Non-zero means the
    task cannot land as-is, however it reported itself.
  - `.base` — committed work: `ahead` (commits vs the base branch) and a
    diffstat. `ahead: 0` against a resolved `baseRef` is the "reported
    succeeded, committed nothing" tell. `baseRef` is the task's RECORDED fork
    point (`add --base-branch`) when it has one — tasks cut from
    `release/2.x` are measured against `release/2.x`, not against a guessed
    `main`; only records predating the field (or a recorded ref that no
    longer resolves) fall back to the `origin/HEAD` → `main` → `master`
    guess.

  Read-only by contract: it starts no engines, writes nothing, and changes
  no task state.
- `context --repo PATH [--limit N] [--text]`: **the coordinator's
  start-of-turn read.** One composed snapshot of a project, meant to be run
  at the beginning of every turn so a coordinating agent works from what the
  command printed instead of from what it remembers. Composition only — five
  reads the daemon already answers, joined server-side.

  The point is the **derived group**. A task's `status` is a claim somebody
  wrote (`update --status`), so a worker that crashed stays `in_progress` forever.
  `context` reports instead which group a task is in, derived from its report,
  its PR observation, its arbitrated engine activity and its tab liveness:

  | `group` | means | your move |
  |---|---|---|
  | `waiting-on-you` | permission prompt, a quota wall with no scheduled resume, a settled error, a dead tab that delivered nothing, a failed deletion | answer it |
  | `landing` | PR open and approved | merge it |
  | `ready-for-review` | a `report` exists, or a turn finished, and nobody acted | read the diff |
  | `working` | an engine is producing output, or the daemon will resume it on a timer | nothing |
  | `idle` | we looked; nothing is happening | nothing |
  | `unknown` | we could not look | look (`get-task`, `read-output`) |

  `rank` is the sort key (0 = `waiting-on-you`), and `tasks` comes back
  sorted by it, so the first row is what needs a person next. Ties break on
  the freshest activity. `unknown` is a sixth group on purpose: absence of a
  signal is never a verdict, so a task the activity registry cannot answer
  for is NOT reported idle — the same `null` ≠ `false` rule the rest of this
  page keeps.

  Two debounces keep the top group honest, both derived from the activity
  observer's own cadences: an `error` must stand 20s (an engine that fails a
  turn and retries by itself fires `turn-failed` then `turn-start` seconds
  apart), and a dead/not-alive tab 60s (one foreground-walk sample — the only
  thing that can see an engine die inside a live PTY). `permission_needed`
  and `rate_limited` are debounced by zero: they are engine hook events, not
  screen reads, and a human is the only thing that clears them.

  Per task: `taskId`, `title`, `branch`, `group`, `rank`, `activity`
  (`{state, forMs}`, `null` when unreadable), `checkState` (Rove's own CI
  truth, when there is a PR), `pr`, and the worker's `report` claim. Nothing
  else — the verb is paid for on every coordinator turn, and `worktreePath`,
  `vendor`, `groupId` and the declared `status` are one `get-task` or
  `collect` hop away.

  Beside the tasks: `attention` — the unhandled attention-inbox episodes
  (routine episodes included; their subject is a schedule, so no repo filter
  can scope them) — and `notes`, the repo's newest 15 field notes, which are
  exactly the ones injected into a fresh session here, so a coordinator
  briefs its workers from what those workers will read.

  Only worktree tasks are listed: the repo's `main` seat and `dir` entries
  are not anybody's turn, and a worktree already being removed is spent (a
  deletion that *failed* is listed, as `waiting-on-you`). `--limit` defaults
  to 20 and drops the quiet tail, reporting `omittedTasks`. Repo resolution
  follows `collect`. A side read that fails degrades to an empty section
  rather than failing the verb.

  `--text` returns `{ text }` — one compact line per task in rank order,
  for an agent that would rather read it than parse it. It replaces the
  structured rows; ask for one or the other, not both.
- `digest --repo PATH [--since-days N]`: the repo's recent agent work,
  tasks touched in the window plus routine outcomes by status. Default
  window 7 days. Repo resolution follows `collect`: an unresolvable `--repo`
  is a `REPO_UNRESOLVABLE` error, and unresolvable task repos come back in
  `unresolvableRepos` rather than being counted as absent. Task outcomes are deliberately absent: completion travels
  to the spawning agent's engine tab (`send`), not into Rove state.
- `agent-turns [--task-id ID] [--repo PATH] [--since-days N] [--limit N]`:
  per-turn agent telemetry, one record per completed engine turn
  (`taskId`/`tabId`/`vendor`/`model`/`sessionId`/`startedAt`/`endedAt`/
  `usage`), newest first, plus a `totals` roll-up (token sums, summed
  wall-clock, turn counts per model). Default window 7 days, 200 records.
  Records are produced by each engine's own adapter from that vendor's
  transcript and stored by the daemon on `turn-complete`. Claude and codex
  have a turn reader; every other engine has none, so a task on one yields an
  empty page because nothing can read its turns, not because it did no work.
  Read-only.
- `pty-list` *(offline)*: hosted PTY sessions (key, alive, pid, command,
  live window title, optional `generation` identifying the host's current
  in-memory session lifetime). `sessions: []` means a live PTY host with nothing
  running; `sessions: null` means there was no host to ask — "couldn't look",
  not an idle fleet. Never read `null` as "no sessions running".
- `read-output [--task-id ID] [--tab TAB] [--source auto|history|terminal]
  [--cursor C] [--limit N]`: a task's engine output as bounded, cursor-paged
  JSON: structured history when the engine has it, else a labeled terminal
  tail (`fallbackReason`). Read-only: it never attaches to a session or types
  into one. Without `--tab` it reads the worktree's NEWEST engine session —
  once a task has a second engine tab, that can be the second tab's; pass
  `--tab` (ids from `get-task` `.tabs[]`) to read one specific session.

  The first page is the NEWEST: the last `--limit` messages (history; default
  40, max 50) or the last `--limit` terminal lines (terminal; default 40, max
  200). `history.firstIndex` is the transcript index of `messages[0]`.
  `cursor` is the forward cursor; once you are caught up it is the **poll
  point** — re-read with it to get only what the session wrote since.
  `olderCursor` pages backward through history (`null` at the start of the
  transcript, and always `null` for terminal). A cursor is pinned to one
  source/session/tab and returns `SOURCE_CHANGED` if that moved.

  `--tab tab-N` reads that tab's own pinned conversation (structured history)
  when it is an engine tab with a pinned session id (claude tabs); otherwise
  that tab's terminal — with `fallbackReason` `history_missing` or
  `engine_unsupported` for an engine tab with no readable history (including
  a pinned conversation with no messages yet, such as a fresh tab still on a
  trust or login prompt; `--source history` returns its empty page), and
  `null` for shell/command tabs. `--source history` on a non-engine tab is
  `HISTORY_REQUIRED`; `TAB_NOT_FOUND` when the tab has no session. A dead
  session's terminal page includes `terminal.exit` (`code`/`signal`/`at`)
  while the PTY host still runs. A history page also carries `engineError`
  when the engine's screen ends on its own error row: a turn that failed
  before replying leaves nothing in the transcript.

  **Following a running session.** Pair `watch` with the poll point instead
  of re-reading everything:

  ```bash
  rove api read-output --task-id X                       # newest page; note .cursor
  rove api watch --task-ids X --until turn_complete      # block until it moves
  rove api read-output --task-id X --cursor <cursor>     # only what was written since
  ```

  Repeat the last two steps (each response's `cursor` is the next poll point).
  The CLI never attaches to the session; this is how an agent follows one
  without taking it over.
- `watch (--task-ids a,b,c | --group GROUPID) --until STATE[,STATE]
  [--timeout MS]`: block until a watched task's engine reaches one of
  `--until`'s states, streaming every transition on the way. This is the
  push-driven replacement for a `collect` polling loop: the daemon already
  publishes each activity transition, so a supervisor no longer pays a
  process spawn and a socket per tick to find out nothing changed.

  Valid states: `idle`, `running`, `turn_complete`, `rate_limited`,
  `permission_needed`, `error`, `dead`. A state that does not exist is
  refused up front with `BAD_FLAG` — for a verb whose whole job is to wait, a
  typo that waits forever is the worst possible failure.

  **`dead` is the one polling is worst at.** A `SIGKILL`ed engine fires no
  hook, so the daemon writes `dead` from the PTY host's exit record and
  pushes it here immediately, instead of it surfacing whenever the next poll
  happened to land.

  **Output is a stream, then a result.** One NDJSON line per transition —
  `{ taskId, tabId?, state, at }` — followed by the usual single result
  object when the watch ends. Reading line-by-line lets a caller act on the
  first line; reading the whole output gets both. The channel replays its
  current value on subscribe, so a task that is ALREADY in an `--until`
  state matches immediately, which is the intended answer.

  Exit codes: `0` with `matched` on a hit; `WATCH_TIMEOUT` when `--timeout`
  (default 300000 ms) elapses first — that says nothing has happened yet,
  never that nothing will; `DAEMON_GONE` when the daemon dies mid-watch. The
  verb never reconnects on its own: reconnecting silently would hide the gap
  in which transitions were missed.
- `inspect [--task-id ID]` *(offline)*: diagnostics in one read, across four
  sections: `daemon` (raw per-task/per-tab activity entries, plus
  `contextUsage` — the collector's current reading per live engine session,
  keyed `taskId::tabId`, carrying `contextTokens` and the session's
  `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheCreationTokens`
  where the engine reports them; this is the only read that shows those
  totals), `sessions`
  (PTY inventory joined with a live process-tree walk; dead sessions carry
  `exit`), `sessionExits` (durable death records, newest first: exit
  `code`/`signal`/`at` plus a plain-text output `tail`, kept in
  `pty-exits.json` so they survive the PTY host's idle-exit. `layer: "pty"`
  is the terminal process, abnormal exits only; `layer: "engine"` is the AI
  process gone from a still-running terminal, and adds `parentAlive` plus
  `vendor` where a walk named the engine. An engine that died while no daemon
  was watching — the daemon idle-exits on its last GUI — is reconciled at the
  next daemon start from the wrapper's `Engine exited (code N)` banner still
  in the session's ring; those records carry `atApproximate: true`, meaning
  `at` is discovery time and no vendor, because nothing on disk records
  either), and `tabs` (the
  snapshots the sidebar names its rows from, reconciled against the live
  session inventory: a task whose snapshot is missing an alive
  `<taskId>::tab-N` session reports those tab ids under `unregistered`,
  and a task with live sessions but no snapshot at all still gets an
  entry). Non-spawning: a missing daemon
  or PTY host degrades that section to `null`. **Run and paste this first**
  when reporting a badge, label, engine-identity, or engine-crash bug.

- `deliveries --task-id ID [--limit N]`: the task's armed deliveries, newest
  first; the daemon keeps the newest 50 per task. A delivery is one prompt
  that asked for a report (see `report`). Each entry has `id` (`d-<n>`),
  `source` (`routine`, `send`, `gate-answer`), `tabId`, `promptHead` (first
  200 characters), `at`, and `status`: `awaiting`, `reported`, `missing` or
  `skipped`. A reported entry carries `report`
  (`{ outcome, summary, evidence[], next?, at }`). A missing one carries
  `missing` (`{ cause, note?, at }`); `cause` is `turn-complete` (the turn
  ended with no report), `turn-failed` (`note` is the failure detail),
  `interrupted` (the turn was interrupted), `session-end` (the engine
  session ended), `engine-dead` (`note` is the last line of the tab's
  output), `rate-limited` (the engine hit its quota; quota-resume
  continues the turn and a late report still lands), or `stalled` (awaiting
  for over 10 minutes while the tab was neither running nor at a permission
  prompt; `note` is `tab state: <state>`). A permission prompt does not mark
  a delivery missing.

  A tab runs its prompts in order, so a turn event settles the OLDEST
  matching delivery: a `turn-start` begins the oldest one whose turn has not
  started, and a turn end (`turn-complete`, `interrupted`, `session-end`)
  ends the oldest one whose turn has started. A Stop that arrives before any
  turn started belongs to an earlier prompt the paste queued behind. A failed
  turn ends the oldest started delivery, else the oldest awaiting one; an
  engine exit ends all of the tab's. A missing delivery raises a
  `report_missing` Inbox row (none for `rate-limited`: the engine's own
  rate-limit row covers it), keyed by the delivery so the tab's next turn
  does not clear it. A late `report` or dismissing the row clears it. A loop prompt can read
  `deliveries --limit 5` instead of a growing notes file.

- `should-run --task-id ID [--tab TAB]`: would a tick sent to this task be
  used? Prints `{ run: true }` and exits `0`, or `{ run: false, reason,
  detail?, until?, gateIds? }` and exits `3` (the verdict is on stdout in
  both cases). The first matching `reason` wins, in this order:
  `task-missing`; `awaiting-owner` (an open gate; `gateIds`); `report-missing`
  (the tab's newest delivery ended unreported and its Inbox row is neither
  dismissed nor answered by a late `report`; skipped ticks and a delivery the
  rate limit ended do not count);
  `quota` (`rate_limited`; `until` is the reset time, from the armed
  quota-resume or else the usage cache, and the block ends there; with no known
  reset the quota is not a reason to skip); `engine-error` (a sticky `error`, billing and auth included);
  `engine-dead` (an exact `--tab` whose engine exited); `awaiting-permission`;
  `busy` (a turn is running, the newest delivery still awaits its report, or
  a `send --if-runnable` is mid-paste). A task whose only gate is answered
  but undelivered is runnable: the next tick carries the answer. Without
  `--tab` the whole task is judged (any running tab is busy) and a dead
  engine is not a skip, since `send` revives it; `--tab new` judges only
  task-level state. Reasons that need a person clear when they act:
  answering or withdrawing the gate, a late `report` or dismissing the
  `report_missing` row (TUI, bridge or weixin), the engine's next
  `turn-start`. The daemon's routine runner and the quota-resume timer ask the
  same question. `get-task` and `collect` carry the same verdict as
  `runnability`.

## create

- `add --repo PATH [--title T] [--branch B] [--base-branch B]
  [--worktree-name NAME]
  [--command CMD] [--count N | --agents claude:2,codex:1] [--status S]
  [--pin] [--activate] [--require-report] [--prompt TEXT | --prompt-file PATH]`: create a task (appears in the
  sidebar immediately). With `--prompt` it also materializes the worktree,
  starts the engine, and delivers the prompt. Does not steal focus unless
  `--activate`. Alias: `spawn-task`. The result's `.engine`
  (`{vendor, command, model, effort}`, per row for `--count`/`--agents`) is
  what the task actually launches after the flags and the repo's default
  engine are resolved. `.warnings` names a `--model` that plainly belongs to
  another vendor (codex handed a `claude-*` id); the task is still created,
  since a wrapper command can point an engine at a gateway that serves
  foreign models. Without `--branch`, the branch name is
  auto-derived from the title following the repo's own branch-naming
  convention (inferred from its existing local + origin branches, e.g.
  `feat/login-flow` in a type-prefixed repo, `login-flow` in a bare-slug or
  empty repo; name collisions get a short `-2`/`-3` suffix, and a name that
  clashes with an existing branch's folder is skipped or flattened). A title that
  kebab-cases to nothing — written in a non-Latin script, or all emoji /
  punctuation — falls back to `task-<last 6 of the task id>`, so two such
  tasks get two distinct names instead of `task` and `task-2`.
  An explicit `--branch` is checked against `git check-ref-format --branch`
  BEFORE the task is created; a name git would refuse is `INVALID_BRANCH`
  and nothing is written.

  `--repo` is resolved to the repository root, so a path pointing at a
  SUBDIRECTORY is accepted and climbs. When it does, the result carries
  `repoResolvedFrom` with the path you passed — absent when `--repo` already
  named the root.

  A `--title` is flattened to one line: newlines, tabs and other control
  characters collapse to single spaces (the sidebar row does not wrap, and a
  raw newline breaks its height).

  `--worktree-name` names the worktree DIRECTORY instead of taking one from
  the animal pool, so a caller can predict `.task.worktreePath`
  (`<worktrees root>/<NAME>`) rather than reading it back with `get-task`
  afterwards. It must be one path segment of letters, digits, `.`, `_` or `-`
  and may not start with `.` (`INVALID_WORKTREE_NAME`); a name already in use
  in this repo — a live task, a directory on disk, or a concurrent create —
  is refused with `WORKTREE_NAME_TAKEN` and never silently suffixed `-v2`,
  because a caller that asked for `probe-1` and quietly got `probe-1-v2`
  looks in the wrong place and finds out somewhere else. Single task only,
  like `--branch`.

  `--base-branch` cuts the new branch from that ref instead of the repo's
  current HEAD and is persisted on the task (`.task.baseRef`) — the fork
  point `collect` measures against, durable across daemon restarts. The
  delivered `--prompt` text is persisted too (`.task.prompt`) — the durable
  copy of the task brief; it survives a dead engine or lost context, where
  the engine's own transcript does not.

  **Parallel attempts** live here too: `--count N` spawns N sibling tasks of
  the SAME prompt, each with its own worktree and branch, sharing one
  `groupId` and `#i/N` titles; `--agents claude:2,codex:1` does the same
  with a mixed fleet (engine IDS only; a raw command line can't be
  expressed per-sibling; issue N separate `add --command` calls for that).
  Capped at 10; prefer 3-4. Both require `--prompt` (a parallel round IS its
  prompt) and reject `--branch` (siblings cannot share one branch);
  `--agents` also rejects `--count` and `--command` (it already names each
  sibling's engine). This was the `fan-out` verb, which no longer exists.

  `--command` picks the engine (an id from `engine-list`, or a full command
  line). Omitted, the repo's default engine is used — skipping any engine
  switched off in Settings → Engines, the same as the TUI's picker.
  `--effort LEVEL` and `--model MODEL` pin the engine's reasoning level and
  model for the first session onward; both are gated per engine
  (`BAD_EFFORT` / `BAD_MODEL`), and `--model` is passed verbatim in the
  engine's own spelling. `--tier swift|standard|deep` fills all three from
  the auto-routing table (Settings → Auto routing) and records `.task.tier`;
  it is exclusive with `--command`/`--model`/`--effort`/`--agents`
  (`CONFLICTING_FLAGS`) and refuses a tier that cannot start
  (`TIER_UNAVAILABLE`).

  `--require-report` sets `Task.requireReport`: the task's own first
  `--prompt` and every later `send` to it arm a delivery, as if each carried
  `--expect-report`. For a task ticked unattended; change the setting with
  `update --require-report on|off`. `add --expect-report` arms the first
  prompt only. The reply carries `deliveryId`.

  `--tier auto` asks a classifier to read `--prompt` and pick the tier for
  you. It needs a prompt (`BAD_FLAG` without one) and it is **off until you
  configure it** — see
  [`autoRouting.classifier`](./CONFIGURATION.md#the-tier-classifier), which
  also spells out where the prompt text goes. It never fails a create: an
  unset classifier, a missing key, a timeout, an answer below the confidence
  threshold, or a tier this machine cannot start all create the task with the
  ordinary defaults and report what happened in `.tierAuto`.

  `--repo` accepts paths `rove add` refuses — a checkout under `.scratch/`,
  `.dev-sandbox/` or `$TMPDIR` gets a task here and gets
  `cannot be a project — inside a sandbox or scratch directory` there. The
  two verbs ask different questions: `rove add` registers a PROJECT, and the
  eligibility gate exists to stop throwaway checkouts becoming permanent
  sidebar rows. `add --repo` creates a TASK, and the same gate still runs —
  it just skips minting the project row and the `savedRepos` entry instead
  of failing the call. So the task appears under a header derived from its
  own repo, and disappears with it.

A create issued from inside a Rove engine tab records
the caller as the new task's `dispatcher` (`{taskId, tabId}` from
`$ROVE_TASK_ID`/`$ROVE_TAB_ID`, with Rove aliases). That is the reply address
the worker's bare `send` routes back to. Creates from a plain shell or the
TUI record none.

Those env vars are **verified, not trusted**: an environment variable is
inherited by every descendant process, so an agent's detached background
process keeps exporting the ids of a tab it no longer runs in, and every
task it creates would name a stranger's session as its dispatcher. Rove
believes the pair only when `<taskId>::<tabId>` is a live session AND that
session's shell is an ancestor of the calling process. When it isn't, the
dispatcher / `[ROVE PEER]` provenance / spawner coda are all omitted (a
wrong reply address delivers to someone else; no address at least fails
visibly), and the verb's JSON result carries an `identityWarning` field
saying so.

A new task's FIRST prompt (`add --prompt`, a parallel round, quick-fork) carries
only facts about its own worktree; the standing worker instructions, naming its
branch included, live in the Rove agent skill. Prompts into existing sessions
(`send`, `send --tab new`, `dispatch`) are never modified.

## drive

- `send [--task-id ID] (--prompt TEXT | --prompt-file PATH) [--tab TAB]
  [--command CMD] [--plain] [--allow-empty] [--expect-report] [--if-runnable]`: paste a
  follow-up into a task's running engine (one full turn). `--prompt-file`
  reads the text from a file (`-` = stdin) so the shell never sees it:
  backticks inside a double-quoted `--prompt` are command substitution, and
  a message that names a reply command (`` `rove api send …` ``) ships that
  command's OUTPUT instead of the words. `add` and `dispatch` take the same
  flag. Without
  `--task-id`, a task that has a `dispatcher` on record replies to that
  exact tab, falling back to the dispatcher task's live canonical engine
  tab when the tab died, and failing loud (`DISPATCHER_UNREACHABLE`) when
  nothing on that task is alive, never silently spawning a new engine.
  Otherwise the default is the active task and its canonical engine tab.
  From another Rove task, the message includes `[ROVE PEER]` provenance and
  a tab-precise reply command (`--task-id <sender> --tab <sender's tab>`);
  `--plain` skips that prefix, and a refused send's retry `nextCommandArgs`
  carry `--plain` so replaying them does not stack a second prefix. `delivered: true` says the bytes landed and
  nothing more: when the target was already in `error` or `dead`, the
  result carries `targetState` (and `targetDetail`), so a prompt sent into a
  failed session is visible as such. `--tab new` spawns a fresh engine tab, while
  `--tab tab-N` targets that exact tab (`TAB_NOT_FOUND` if it is dead or
  absent). A tab a **pty-host restart froze** is neither: it is listed by
  `pty-list` with its scrollback and launch command intact, and it refuses
  with `TAB_RESTORED` until you pass `--respawn`. `--respawn` (valid only
  with `--tab tab-N`) revives that tab in place and then delivers, replying
  `respawned: true`. A tab with a `sessionId` comes back on its own
  conversation (`--resume <id>`); a tab without one comes back on a fresh
  conversation; a tab Rove holds no snapshot for replays its frozen launch
  command, which for claude carries the task's original first prompt. That
  last case is why the flag is never implicit. The prompt you send is always
  pasted once the engine is up, never woven into the relaunch.
  When `send` STARTS a new session (`started: true`) while the task has
  freeze-restored engine tabs it did not use, the reply carries `frozenTabs`
  — `{tab, sessionId}` for each — because otherwise "opened a blank agent
  while your two real conversations are frozen" reports exactly like a
  healthy first start, and `get-task` then says `running: true`. `--command CMD` is valid only with `--tab new`: it pins that new
  tab to that engine without changing the task's own. Using it with an
  existing tab is a `BAD_FLAG` error rather than a silent switch.
  Delivery needs a live engine in that tab: one that exited into the
  keep-alive shell refuses with `ENGINE_NOT_RUNNING` and a `--tab new` hint
  instead of pasting into a shell. When the `ps` probe behind that check fails
  or blows its deadline the refusal is `ENGINE_PROBE_FAILED` instead — the tab
  was never looked at, so nothing is claimed about its engine. Any registered
  engine passes, so a tab may run a different vendor than its task. Without `--tab`, the canonical target
  is a live engine tab (`tab-1` first, then any surviving engine tab); when
  live tabs exist but none resolves as an engine, `send` refuses with
  `NO_ENGINE_TAB` rather than silently spawning a duplicate engine. Only a
  task with no live session at all auto-starts its canonical engine tab, in
  the task's worktree. `started: true` in the result marks that fresh
  session (vs. delivery into an existing one).

  **`--expect-report` arms a delivery.** The reply carries `deliveryId`
  (`d-<n>`), and the pasted prompt ends with a footer line:
  `[ROVE] When this turn ends, report: rove api report --delivery d-41 --outcome done|partial|blocked|failed --summary … [--evidence …]… [--next …]`.
  The agent answers with `report`. A turn that ends without one marks the
  delivery `missing` and raises a `report_missing` Inbox row (see
  `deliveries`). A task with `requireReport` arms every `send` without the
  flag. A send whose paste fails drops its delivery, so a refused send
  leaves nothing awaiting.

  **`--if-runnable` sends only when `should-run` says the task can use the
  tick.** The daemon evaluates the verdict, claims the tab and (when the send
  owes a report) arms the delivery in one step, so two ticks arriving
  together cannot both pass; the paste itself still happens in the calling
  process, and the claim holds the tab `busy` until it lands (or 90 seconds,
  for a caller that died). On a skip nothing is pasted and the reply is
  `{ taskId, skipped: { run: false, reason, detail?, until?, gateIds? } }`
  with exit `3`; when the send would have armed a delivery it carries
  `deliveryId` of a `skipped` delivery (`deliveries` lists it). Repeats of
  the same refusal fold into one row (`repeats`). A skip is dropped, never
  held for later. `dispatch` and `add --count` do not take the flag:
  `dispatch` is an agent-to-agent reply into a live session, and a fan-out
  creates fresh tasks, which have no prior state to judge. `send --tab new`
  is judged on task-level state only (gates, unreported deliveries).

  **`engine.maxLiveSessions` caps new sessions.** When that setting is a
  positive number, a call that would START an engine session (`add` with a
  prompt, `send --tab new`, a `send` to a task with no live session) first
  counts the live engine tabs across every task. At or past the cap it
  refuses with `ENGINE_LIMIT`, carrying `taskId`, `live`, `limit`, and the
  `send` that retries the same prompt. Nothing is spawned and no tab is
  left behind. An `add` refused this way has still created its task, so the
  retry starts it once a session ends. Delivery into an engine that is
  already running is never limited. Unset (the default) means no cap.

  Admission is atomic at the PTY host across independent CLI processes, including
  exact-tab `send --tab tab-N --respawn`. Pending launches and unavailable process
  probes retain their slots; an engine that exits into the keep-alive shell releases
  its slot. Refusal retries preserve `--tab` and `--command`. A host predating atomic
  admission refuses capped launches with `ENGINE_ADMISSION_UNAVAILABLE` until it is
  restarted; inventory contention can return `ENGINE_ADMISSION_BUSY` for retry.

  **The prompt is pasted and submitted, unconditionally.** Rove does not read
  the target composer or wait out a quiet keyboard first: a `send` that
  reaches a live engine tab is written to it. The only refusals left are
  physical — no such tab, a dead PTY, no engine process in it — and each has
  its own error code in the table above.

  A prompt opening with `succeeded:` is checked against the SENDER's own
  branch before any delivery: sent from a verified managed task whose branch
  has 0 commits, it is refused with `EMPTY_SUCCESS_REPORT` and nothing is
  delivered. The claim and the evidence are both in hand at that moment, and
  a report is what a coordinator acts on — `land`'s `EMPTY_BRANCH` catches
  the same mismatch two steps later, after the coordinator has believed it.
  The check is deliberately narrow: it needs a verified sender identity, a
  managed (non-`main`, non-`dir`) task, and a definite `ahead === 0` — an
  unresolvable base reads `null` and never refuses. `--allow-empty` states an
  intentional empty success (an investigation, a review) and delivers.

  **Delivery result fields.** Before writing a byte, delivery waits for the
  engine to announce bracketed paste (DECSET 2004), which is the engine
  saying it has taken its tty into raw mode and started reading. This is not
  a nicety: a pty in canonical mode DISCARDS input past the tty's 1024-byte
  buffer rather than blocking, so a prompt written into a still-booting
  engine used to arrive as a 1024-byte prefix with no error anywhere.

  - `engineReady` — the engine was confirmed reading when the write happened.
  - `delivered` — the prompt was written to the engine's pty.
  - `bytes` — how many bytes were written (prompt plus paste wrapper).
  - `promptEcho` — `"confirmed"` when the prompt's tail was seen echoed back,
    `"unconfirmed"` otherwise. Unconfirmed is INCONCLUSIVE, not failure:
    engines that collapse a large paste into a `[Pasted text #1]` placeholder
    never echo the text, so a positive proves delivery while a negative
    merely fails to.
  - `reason` — why nothing was confirmed. Present only with
    `engineReady: false`.

  Every engine receives Enter, including while it is mid-turn. Codex first receives End, which flushes its pending paste without changing the text. On Windows, Enter alone can join an unfinished paste burst as a newline and leave the message in the input box. Delivery does not read the engine's footer to choose a submit key. How an engine handles a mid-turn submission remains the engine's own behavior, not something this result reports.

  Deliveries into one tab are serialized against each other. The paste and the submit key are one act, and two sends racing on the same tab used to interleave their halves — both messages landing in one composer, submitted together as a single turn by the first Enter while the second Enter hit an empty composer. That is what made several workers reporting into one coordinator tab look like their replies were piling up unsent. A send now waits for any delivery already in flight on that tab; one that waits too long delivers anyway rather than refusing, so a contended tab can still merge in the worst case, but a report is never dropped to avoid it.

  A FRESH spawn carries the prompt on the engine's own command line, so there
  is no write to observe; `engineReady` there reports the engine PROCESS being
  found inside the session, and nothing else. A hosted session stays alive
  after its engine exits — the wrapper `exec`s a login shell in its place — so
  its liveness answers a different question, and a launch command that does not
  exist would otherwise report a clean success on every field. A spawn that
  produces no engine fails as `SESSION_FAILED`, carrying the already-created
  `taskId`, the `session` key, and the session's own last line as `reason`. The
  one non-failure that reports `engineReady: false` is a repo whose
  `.rove/init.sh` is still running: it precedes the engine, so `delivered`
  stays `true` (the prompt is still riding an argv that has not run yet) and
  `reason` says so, rather than holding `add` open for the length of an
  install.
- `interrupt --task-id ID [--tab TAB]`: stop the turn a task's engine is
  currently running — the headless twin of pressing the engine's own
  interrupt key. The session, its conversation and its worktree all survive,
  which is what separates this from `tab-close` and `delete`.

  It exists because the escalation had a hole in the middle. When a worker
  runs away, `send` cannot reach it (delivery needs a quiet composer, and a
  runaway engine's composer is exactly not that), so the only remaining
  levers destroyed something: `tab-close` throws the conversation away,
  `delete` throws the worktree away. Dispatchers took the second option
  because it was the only one that existed.

  Delivery is a plain PTY write of the ENGINE'S OWN interrupt bytes, from
  the engine registry (`EngineCapabilities.interruptSequence`) — the same
  thing a human pressing the key produces. An engine that has not declared
  them (every `generic` protocol engine) is refused with `UNSUPPORTED`
  rather than guessed at: `Esc` and `ctrl-C` mean opposite things across
  engines, and one of the two guesses quits the process.

  Returns `{ taskId, tabId, vendor, interrupted, bytes }`. `interrupted`
  reports the WRITE, not the effect — an engine acknowledges an interrupt on
  its own screen and its own schedule, so read `collect`'s `.activity.state`
  for what actually happened.

- `dispatch --task-id ID (--prompt TEXT | --prompt-file PATH) [--tab TAB]`: route text into a
  task's live session (the dispatcher's messenger; see
  [design/dispatcher.md](./design/dispatcher.md)). Unlike `send` it never
  starts an engine — it needs a session that is already hosted. `--tab tab-N`
  delivers into exactly that tab instead of the canonical engine tab. The
  result's `delivered` is the verdict:
  - `true` — the daemon pasted the text into a live engine session, and
    `tabId` names which tab took it.
  - `false` with `reason: "broadcast"` — no hosted session answered, so the
    text went out on the `session.deliver` channel for a browser-hosted
    session to pick up. Nothing can confirm that paste; `clients` is a raw
    connection count (the calling CLI is one of them) and only its `0` proves
    anything — the text reached nobody.
- `note --task-id ID --text TEXT`: file a one-line field note (a resolved,
  repo-level gotcha). Appended to the repo's durable note store, so every
  future worktree session on this repo starts with it in its system prompt;
  and forwarded to the dispatcher session for live relay to in-flight tasks.
- `note-list --repo PATH`: read a repo's accumulated field notes, newest
  first. Returns `{ notes }`, each carrying the `id` `note-delete` takes. The
  same list is readable inside the TUI from the project header's right-click
  menu (**Field notes**, see [TUI.md](./TUI.md)).
- `note-delete --repo PATH --id N`: retire one field note. The note store is
  not an archive — its newest 15 entries are injected into every fresh session
  on the repo, so a note whose fact has stopped being true keeps being handed
  to agents as if it still were, and the only correction used to be editing
  the daemon's JSON by hand. Returns `{ deleted }`; `false` is an answer, not
  an error (the retention ring may already have evicted that note).
- `set-active [--task-id ID] [--none]`: set (or clear) the shared active
  task every attached sidebar highlights.
- `gate-raise --task-id ID [--tab T] --question TEXT [--option KEY=LABEL]…
  [--recommend KEY] [--context TEXT]`: ask the OWNER a decision only they can
  make (decision gate). `--option` repeats, up to 6; `--question` ≤ 500
  chars, `--context` ≤ 4000. `--tab` defaults to the tab you run in. The
  gate shows in the owner's Inbox as `decision_needed` and in `gates`; it
  stays until answered or withdrawn. Returns `{ gate }` with the `g-N` id.
- `gate-answer --gate g-N [--option KEY] [--text TEXT]`: answer an open gate
  (at least one; `--option` must be one of the gate's keys, else `BAD_OPTION`).
  The answer is persisted first, then pasted into the gate's tab as
  `[ROVE GATE g-N answered] <question>` / `Answer: KEY — label` /
  `Note: TEXT`. No live engine → `{ delivered: false }` and the gate keeps
  `handoff: "undelivered"`: nothing is queued or retried; the next `send` or
  routine firing into that tab carries the answer in front of its prompt. A
  prompt typed into the TUI, a TUI revive, and `dispatch` do not. Answering
  a closed gate is `GATE_NOT_OPEN`.
- `gate-withdraw --gate g-N`: close an open gate nobody needs to answer
  anymore, or an answered one whose answer never reached the engine (the
  owner's explicit close; the answer is dropped). A delivered gate is
  `GATE_NOT_OPEN`. Deleting a task closes its open and undelivered gates.
- `gates [--repo PATH] [--task-id ID] [--status open|answered|withdrawn|all]`:
  list gates (default `open`). `context` also lists the repo's open gates
  under `gates`.
- `pane-open [--task-id ID] [--tab TAB] [--command CMD] [--direction
  right|down] [--placement split|tab] [--title TEXT]`: open a terminal pane
  in a task's workspace: split the focused tab (default, tmux-style
  beside/below the active pane; `--tab tab-N` hosts the split in that tab
  instead) or open a separate command tab. `--command` runs via your login
  shell (`-ilc`, so shell-rc `PATH`/exports apply, same as the engine tab)
  and the pane closes when it exits; omit it for an interactive
  shell. Broadcast over the daemon's `tab.open` channel, so an attached TUI
  showing the task performs the split (headless, nothing happens). The result
  carries the resolved `title` — the label `pane-close --title` must match,
  derived from the command's first word when `--title` is omitted — and
  `clients`, the attached-connection count, and `reached`. `reached: false`
  means no front-end subscribes to the `tab.open` channel, so nobody performed
  the split and an agent must not report "pane opened". (The calling CLI is
  itself one connection, so `clients: 1` alone does not prove a TUI is
  listening; `reached` does.) Task
  defaults to `$ROVE_TASK_ID` (or its Rove alias), then the active task. How far splits can go
  is decided by the terminal's size: a split that would shrink any pane
  below the minimum usable size (20×6 cells) falls back to a tab.
- `pane-close [--task-id ID] --title TEXT [--tab TAB]`: the inverse; close
  every pane (split leaf / command tab) in the task whose label matches
  `--title`, the title it was opened with; `--tab tab-N` scopes the match to
  one tab. Engine panes are never closed. Broadcast over the daemon's
  `tab.close` channel; an attached TUI performs the close (headless, nothing
  happens). The result's `reached` is the reach signal: `false` = no attached
  front-end performed the close.
- `pane-graphics [--task-id ID] --tab TAB [--image-id N]`: hand opaque
  graphics bytes, read from stdin, to every TUI attached to this task, for it
  to write to its own terminal. This is a transport, not a picture format —
  Rove parses nothing, and the bytes are whatever protocol your terminal
  speaks. It exists because a pane cannot do either half for itself: its
  `tty(1)` is its own PTY slave, and the outer emulator's identity is scrubbed
  from its environment, so it can neither reach the real terminal nor ask it
  anything.

  Call it once with **nothing on stdin** to be given `imageId` (allocated per
  tab, so two panes never overwrite each other's picture) and
  `cellWidth`/`cellHeight` in pixels — the numbers that turn a pixel size into
  a count of cells. Build your payload around those, then pipe each frame in
  with `--image-id`, which replaces that picture in place instead of leaking a
  fresh id per frame. `wrote` reports whether anything was broadcast, and
  `clients` is the usual reach signal.

  `ok: false` with `unsupported` is a real answer, not an error:
  `no-cell-size` means no attached terminal could measure a cell (it declined
  `CSI 16 t`), and `mixed-cell-size` means two attached terminals reported
  different ones — a task can be open in two GUIs at different font sizes, and
  there is no single honest answer then. Fall back to whatever you draw
  without graphics.

- `tab-close --task-id ID --tab TAB`: close one exact Terminal Tab using the
  id returned by `get-task` in `.tabs[].id`. Engine, interactive-shell,
  command, and content tabs are all valid. With an attached TUI, the command
  runs the same close path as ctrl+w, so the tab strip updates immediately;
  headless, it removes the persisted tab snapshot and ends the tab's hosted
  PTY plus any split-leaf PTYs directly. Closing the last tab leaves the task
  open with no session, matching ctrl+w. A tab that still exists in the
  snapshot may be closed after its process dies; an absent or already-closed
  id returns `TAB_NOT_FOUND` with a `get-task` recovery command.
- `tab-new --task-id ID --kind shell|engine [--command CMD]`: open a new
  Terminal Tab with no first message — the TUI's sidebar "New shell" and its
  picker's Enter on an empty message. `shell` runs the login shell
  (`$SHELL`) in the task's worktree and types the `ROVE_TASK_ID` /
  `ROVE_TAB_ID` export into it; `engine` starts the task's engine (or `--command`'s,
  as `send --tab new --command` pins it) idle, ready for a first message.
  The worktree is created if needed, and an engine tab respects
  `engine.maxLiveSessions` (`ENGINE_LIMIT`; the refused tab leaves no row).
  The tab id and its persisted row are allocated in one locked `state.json`
  update, then the session spawns, then the daemon broadcasts `tab.add` so
  attached TUIs absorb the row (a TUI otherwise holds a stale tab list and
  would overwrite it). Returns `{ok, taskId, tabId, session, kind, clients}`
  (`clients` = attached connections told; `0` = none); the tab then lists in
  `get-task .tabs[]`. A session already running under the allocated id fails
  as `TAB_COLLISION`. `--command` with `--kind shell` is `BAD_FLAG`.
  `tab-new` also opens three kinds that run something Rove resolves, never a
  command line from the caller: `--kind editor --file PATH [--line N]` opens PATH (relative to
  the worktree; `..` and a symlink out are `BAD_FLAG`, a missing file
  `FILE_NOT_FOUND`) in the editor from Settings → General → Editor, else
  `$VISUAL`/`$EDITOR`, else the first installed of nvim/vim/emacs/nano (`NO_EDITOR`
  when none), as a command tab in the task's one editor slot: the previous
  editor tab is closed (through the TUI's close path when one is attached) once the new
  one runs. `--line N` opens at line N: `+N` for vi/vim/nvim/nano/emacs/emacsclient/micro/kak/mg/joe,
  `PATH:N` for helix, or wherever `{line}` sits in `editor.customCommand`; the result
  then carries `atLine` — `false` when the editor has none of those forms and the file
  opened at its top. `--line` with any other kind is `BAD_FLAG`. `--kind pane --pane PLUGIN.PANE [--tab TAB]` opens a pane of an enabled
  plugin (`PANE_NOT_FOUND` otherwise), split into `--tab` (default the active tab) or
  as its own command tab, as the pane's manifest `placement` says and as the TUI's
  picker does; the result then also carries `leaf` when it split. `--kind viewport
  --view-task ID` adds an engine tab that shows another task's first engine session
  (`.tabs[].viewOf` names that task; its liveness is that session's) and
  starts nothing; the task must be in the same project and have a worktree.
- `tab-split --task-id ID --tab TAB --action open|close|rename|reset
  [--leaf leaf-N] [--direction right|down] [--title TEXT] [--cols N --rows N]`:
  edit one Terminal Tab's split panes with no TUI — the TUI's ctrl+\ / ctrl+= /
  ctrl+w / F2 / F5. `open` splits `--leaf` (default: the tree's active pane)
  toward `--direction` (default `right`) into a new login shell in the task's
  worktree; `--cols`/`--rows` are that pane's size, for the minimum-pane gate
  (too small → `changed: false`, nothing spawned). `close` ends `--leaf` (the
  last pane is `LAST_LEAF`: close the tab instead), `rename` sets its label
  (an empty `--title` clears it), `reset` kills a shell pane and spawns a fresh
  login shell (an engine pane is `RESET_ENGINE`). `leaf-1` is the tab's own
  process; every other pane is its own hosted session `<taskId>::<tabId>::<leaf>`,
  swept by `tab-close`. The layout is the tab's persisted split tree in
  `state.json` (one locked update), then the daemon broadcasts the row over
  `tab.add` so an attached TUI absorbs the tree instead of overwriting it. No
  command line is taken: panes are always the login shell. Returns
  `{ok, taskId, tabId, leaf, changed, split, clients}`; `split` is
  `{activeLeafId, root}` (null once back to one pane) and `get-task .tabs[].split`
  carries the same.
- `notify --title TEXT [--body TEXT] [--kind KIND] [--task-id ID]
  [--source TAG]`: show a toast in every attached Rove UI. `--body` adds a
  second, muted line under the title — context, not a second message.
  `done` / `needs_input` / `error` get severity styling; any other kind
  renders neutrally. The result's `clients` is the reach signal: `0` = no
  attached UI showed the toast (headless).
- `prompt --title TEXT [--placeholder T] [--initial T] [--timeout MS]`:
  ask the human for a line of text through the attached TUI's input dialog;
  blocks until answered/cancelled/timeout (default 120000 ms, max 600000)
  and returns `{ value }` or `{ cancelled, reason }`. `reason` is
  `cancelled`, `timeout`, or `no-gui`: with no front-end attached to show the
  dialog, it returns at once instead of waiting out the timeout.
- `engine-report --kind KIND [--task-id ID] [--engine ID] [--tab TAB]
  [--detail JSON]`: report a normalized engine-activity verb for a task,
  the public face of the `engine.reportEvent` RPC the built-in hook adapters
  use. Lets a plugin-contributed engine (or any wrapper) drive the sidebar
  badge, attention inbox, and plugin event stream. Task/tab default to
  `$ROVE_TASK_ID` / `$ROVE_TAB_ID`; without either, the caller's cwd is
  mapped to a task by worktree path. Kinds: `session-start`, `turn-start`,
  `turn-complete`, `turn-failed`, `turn-interrupted`, `awaiting-input`,
  `session-end` (activity state), plus `tool-pre/post/failed`,
  `pre/post-compact`, `subagent-start/stop` (plugin-only).
- `report --delivery ID --outcome O --summary TEXT [--evidence X]… [--next TEXT]`
  (or `--json PATH|-`): close the report that a delivered prompt asked for.
  `ID` is the `d-<n>` in the prompt's `[ROVE]` or `[ROVE ROUTINE]` line.
  `O` is `done`, `partial`, `blocked` or `failed`. `--evidence` repeats: a
  commit, PR url, test command with its result, or a file path (up to 50
  items, 2,000 characters each). `--next` says what the next tick should do
  (4,000 characters). `--summary` is capped at 32,000 characters
  (`RESPONSE_TOO_LARGE`, never truncated). `--json` reads
  `{ delivery, outcome, summary, evidence?, next? }` from a file or stdin
  and cannot be mixed with the individual flags; use it for text with quotes
  or backticks. An unknown id is `DELIVERY_NOT_FOUND`. Run it as the last
  step of the turn.

  Reporting again replaces the earlier report. A report on a `missing`
  delivery flips it to `reported` and clears its `report_missing` Inbox
  row. The first line of `--summary` (up to 280 characters) also refreshes
  the task card's report summary, so no second `update --report-summary` is
  needed. Daemon RPCs behind this: `delivery.arm`, `delivery.settle`,
  `delivery.report`, `delivery.list`, `task.requireReport`.
- `attention-dismiss --delivery ID`: dismiss the `report_missing` Inbox row of
  a delivery. `ID` is the `d-<n>` from the row. This is the explicit way to
  accept an unreported tick: opening or visiting the row does not clear it,
  because the verdict keeps blocking the next tick until a late `report` or
  this dismiss. An unknown id is `DELIVERY_NOT_FOUND`. Daemon RPC:
  `attention.dismiss` with `deliveryId`.

## edit

- `update --task-id ID [--title T] [--branch B] [--command CMD] [--model M]
  [--effort LEVEL] [--pinned true|false] [--require-report on|off] [--status S] [--report-branch B]
  [--report-pr N] [--report-summary TEXT]`: change any combination of a task's
  fields in one call. Every field is validated before anything is written,
  then applied in a fixed order: branch → command → model/effort → title →
  pinned → status. The call is not atomic: if a step fails midway, the error
  reports the fields already `applied`. The result is `{ ok, taskId, updated,
  command?, protocol?, generic?, engine? }`, where `updated` lists the fields
  written, in order.
  - `--title T`: the task's title. With `--tab TAB` it names one Terminal Tab
    instead (the API twin of the TUI's f2) and `--title` is the only other flag
    allowed. `TAB_NOT_FOUND` when the task's snapshot names no such tab —
    `get-task` lists the addressable ids in `.tabs[].id`.
  - `--branch B`: rename the task's branch (`git branch -m` if materialized,
    else recorded).
  - `--command CMD`: the engine launch command (takes effect on next session
    rebuild). The protocol Rove speaks to it is derived from the command; the
    result reports which one, and `generic: true` when the command names no
    engine Rove knows.
  - `--effort LEVEL`: reasoning effort (next session rebuild). Levels are
    declared by the task's engine — codex accepts `none`, `low`, `medium`,
    `high`, `xhigh`, `max`; claude declares none. A level the engine does not
    declare is rejected (`BAD_EFFORT`, naming the levels it does accept)
    rather than passed through, because the launch path drops an unknown level
    silently.
  - `--model M`: pin the model (next session rebuild). Passed to the engine
    verbatim in its own spelling; `engine-list`'s `models` are suggestions.
    Rejected (`BAD_MODEL`) when the task's engine declares no model flag.
    A `--command` that changes the task's engine clears its model and effort
    pins; pass `--model` / `--effort` in the same call to re-pin them.
  - `--pinned true|false`: pin/unpin the task to the top of the sidebar.
  - `--require-report on|off`: `on` makes every later `send` to the task arm
    a delivery, as `add --require-report` does; `off` restores plain sends.
  - `--status S`: lifecycle status: `backlog`, `in_progress`, `in_review`,
    `done`, `canceled`, `error`.
  - `--report-branch` / `--report-pr` / `--report-summary` (require
    `--status`) record what the WORKER says it delivered, as `.report` on the
    task (`{ branch?, pr?, summary?, at }`), readable from `get-task` and
    `collect`.

  **`.report` is a CLAIM; `.prStatus` is an OBSERVATION.** The daemon polls
  the forge for `prStatus.number` / `prStatus.checkState`; `report.pr` is
  whatever the worker typed, and a worker can report a PR that does not
  exist. A dispatcher deciding whether to land needs to know which of the two
  it is holding, which is why they are separate fields and not one merged
  view.

  Report fields MERGE onto any previous report and restamp `at`, so a
  follow-up naming only `--report-pr` keeps the branch reported earlier.
  An `update --status` with no `--report-*` flag writes no report at all — an
  empty one would restamp `at` and claim the worker reported again.

  The old per-field verbs are gone (no aliases): calling one returns
  `UNKNOWN_VERB` with the `update` form in `nextCommandArgs`.

## issues

The daemon-owned issue store (backlog; see
[WORK-TRACKING.md](./WORK-TRACKING.md)). Statuses: `open`, `doing`, `hold`,
`done`.

- `issue-list --repo PATH [--status S1,S2] [--search Q]`: list a repo's issues.
  `--status` keeps any of the listed statuses; `--search` keeps issues whose
  title or body contains `Q`, ignoring case. Filters AND together. `nextId`
  and `skipped` still describe the whole board.
- `issue-create --repo PATH --title T [--body TEXT]`: create an issue.
- `issue-update --repo PATH --id N [--title T] [--body TEXT] [--task ID]
  [--status S]`: edit title/body, link a task (kanban: In progress; `--task none`
  unlinks) and/or set the status. Title, body and link land in one store
  write, so a rejected `--task` leaves them unchanged — the error means nothing
  was applied. `--status` follows as its own `setStatus` change (the op plugin
  `issue.changed` events report).
- `issue-delete --repo PATH --id N`: delete an issue. Removes ONLY the tracker
  record — a linked task, its branch and its worktree are left untouched. The
  same store op the kanban page's `d` runs, which the CLI could not reach: an
  agent asked to clear a batch of stale stories could previously only mark
  them `done` and leave them. Use `issue-update --status done` when the
  story was finished rather than abandoned.

## workitems

A **read-only** view of a repo's GitHub issues (through the `gh` CLI), plus one
action: start a task on one. Deliberately not an import; the issue stays
GitHub's, and nothing is copied into Rove's own issue store. Mechanics:
[design/work-items.md](./design/work-items.md).

- `workitem-list --repo PATH [--state open|closed|all] [--limit N] [--search Q]
  [--assignee USER] [--author USER] [--label L]`: list issues. `--assignee @me`
  for the ones assigned to you, `--author @me` for the ones you opened.
- `workitem-start --repo PATH --number N [--vendor V] [--base-branch B]`:
  create a task for issue N and start its engine with the issue title, body,
  and URL as the first message. The task keeps a `linkedWorkItem` pointing
  back, and its branch derives from the issue title following the repo's
  branch-naming convention.

Requires `gh` installed and authenticated; failures name which of those is
missing (`gh-missing` / `auth` / `no-remote`) rather than a generic error.

## routine

Scheduled agent tasks (Routines): a cron rule + a prompt + a repo. By default
every firing creates a **fresh task** (worktree + branch + engine session) with
the prompt as its first message; `--persistent-session` instead re-delivers into
ONE standing task. `--target-task ID --target-tab tab-N` instead binds an existing
conversation without creating or reviving a task or tab.
An enabled routine keeps the daemon alive so schedules fire with no TUI
attached. Walkthrough: [Routines](ROUTINES.md). Mechanics:
[design/automations.md](./design/automations.md).

- `routine-list`: every routine with its next run time.
- `routine-create --repo PATH --name N (--prompt TEXT | --prompt-file PATH) --schedule CRON
  [--vendor V] [--model M] [--effort LEVEL] [--base-branch B] [--precheck CMD] [--precheck-timeout SEC]
  [--grace MIN] [--persistent-session] [--disabled] [--target-task ID --target-tab TAB]`: schedule a prompt. `--schedule` is five-field
  cron in the daemon host's local time (`"0 9 * * MON-FRI"`). `--model` / `--effort`
  pin every run's engine, validated at save time with the same `BAD_MODEL` /
  `BAD_EFFORT` as `add` against `--vendor`, else the repo's default engine, else
  the built-in default; a pinned routine stores that vendor, so runs launch the
  engine the pins were checked against. Without pins or `--vendor`, runs launch
  the built-in default. The daemon refuses model/effort without a vendor.
- `routine-update --id ID [...]`: change any field; `--enabled true|false` pauses / resumes. A new `--schedule`
  re-anchors the next run; `--precheck ''` clears the precheck, `--model ''` / `--effort ''` clear those pins,
  and `--vendor ''` under surviving pins re-resolves, re-validates and stores the engine. Omitted target flags
  preserve the binding; `--target-task '' --target-tab ''` sends `target: null` to clear it.
  While a routine retains a standing task, vendor/model/effort changes and clears
  are rejected even if its engine has exited. Disable it and create a replacement
  with the desired pins. Unchanged pins and other field updates remain supported.
- `routine-run-now --id ID`: run immediately, skipping the precheck. Does
  not shift the schedule.
- `routine-respond --run RUN_ID (--text T | --prompt-file PATH|-)`: store the
  agent's response on one run. It is the routine spelling of
  `report --delivery <deliveryId> --outcome done --summary <text>` and writes
  the same delivery report, so `deliveries` shows it too. Each delivered
  routine prompt starts with a
  `[ROVE ROUTINE] "<name>" run #<n> — when done, report with: rove api report --delivery d-<n> --outcome done|partial|blocked|failed --summary … [--evidence …]… [--next …]`
  line, then the prompt. One response per run, a second call replaces it; cap
  32,000 characters (`RESPONSE_TOO_LARGE`, never truncated); an unknown run id
  is `RUN_NOT_FOUND`. No response is ever inferred from a transcript. Prefer
  `report` when the run ended `partial`, `blocked` or `failed`, or when you
  have evidence to attach.
- `routine-runs --id ID`: run history, newest first. Each delivered run
  carries `deliveryId` and `deliveryStatus` (`awaiting`, `reported`,
  `missing`), and `response: { text, at }` once the agent reported; both are
  read from the linked delivery. Runs from before deliveries existed keep
  the response they stored. `revived` describes a
  respawned standing session; `skipped_cancelled` means disabled, changed or stopped before delivery; `skipped_blocked` means should-run refused the tick (`blocked` is the verdict, see `should-run`; the cause is already in the Inbox and `routine-run-now` bypasses it), except `engine-dead` and `engine-error`, which have no Inbox row of their own and are recorded `dispatch_failed` with the same `blocked`. Bound deliveries include `taskId`/`tabId`. An unknown id is an error
  (`automation not found`), not an empty history.
- `routine-delete --id ID`: delete it and its history (tasks it already
  created are untouched). Idempotent: deleting an id that is already gone
  succeeds with `{ "deleted": false }`.

**`--persistent-session`** keeps ONE task per routine and delivers each firing
into it, so a daily check can build on yesterday. Its task is folded behind the
sidebar's `N routine sessions` count row (still findable by search, still
Inbox-reachable). Leave it off for a routine that edits code: a week of runs on
one branch is a branch nobody can land. One extra run status comes with it —
`revived` (the engine had exited, so it was respawned in the same worktree; the
files carried over, the conversation did not).

**Existing target:** the daemon payload is `target: {kind: "existing-tab", taskId, tabId}`.
The repo must match the task repo; `vendor`, `model`, `effort`, `baseRef` and `persistentSession`
are incompatible with this mode. Updates validate the merged record; clear old
launch settings with `--vendor '' --model '' --effort '' --base-branch '' --persistent-session false`
when binding. Missing/deleting tasks, missing tabs and exited engines fail without
fallback. Disabling stops future scheduling, including a run still in precheck. Claims
survive restarts without replay, but a crash after claim and before delivery can
lose an occurrence. See [existing conversation delivery](ROUTINES.md#deliver-into-an-existing-conversation).

**`--precheck`** runs a shell command in the repo before the engine starts;
a non-zero exit skips the run *without* creating a task. Use it so a schedule
does not burn a turn when nothing changed (`git log --since=24.hours --oneline
| grep -q .`). Run statuses: `dispatched`, `skipped_precheck` (healthy:
nothing to do), `skipped_missed`, `skipped_unavailable`, and
`dispatch_failed` (needs a human).

## lifecycle

- `land --task-id ID [--dry-run] [--strategy merge|squash] [--delete-branch]
  [--remove-worktree=false]`: merge a task's branch back into its
  base repo's current branch (`--no-ff` merge, or one squash commit). Refuses
  a dirty base checkout, a branch that no longer resolves in the base repo
  (`MISSING_REF` — renamed or deleted outside Rove), and a branch with no
  commits ahead of base (`EMPTY_BRANCH`; `EMPTY_BRANCH_DIRTY_WORKTREE` when
  uncommitted work is still sitting in the worktree, with a send-back recovery
  command); on conflict it aborts and returns the conflicted files. Returns
  `{ landedOn, commit }`.
  **A successful land removes the task's worktree by default** — the
  directory is spent once the branch is in. Pass `--remove-worktree=false` to
  keep it. The **branch always stays** either way (pair with
  `--delete-branch` to drop it too); git is the durable record, the working
  directory is not. Removal never forces: a dirty worktree, the base
  checkout, and the worktree the caller is running from are all refused, and
  the outcome lands in the result's `worktree` field
  (`{ removed, reason? }`) instead of failing the land.

  **`--dry-run` answers "may this land, and into what" without writing.** It
  returns `{ branch, landedOn, ahead?, baseDirty?, refusal?, dirtyFiles?,
  baseDir }`: `landedOn` is the base checkout's CURRENT branch — the merge
  destination, which is the thing "check the base checkout is on the branch
  you mean" asks you to check — and `ahead` is how many commits would land.
  When the land would be refused, `refusal` is one of `DETACHED_HEAD`,
  `UNREADABLE_BASE`, `UNBORN_BASE`, `SAME_BRANCH`, `MAIN_CHECKOUT_DIRTY`,
  `MISSING_REF`, `EMPTY_BRANCH`, `EMPTY_BRANCH_DIRTY_WORKTREE`, and
  `message` carries the same words the land
  itself would have failed with. A coordinator picking which sibling of a
  round to land should read this first — `ahead: 0` is the empty-merge that
  otherwise only surfaces at land time.

  **`--delete-branch` needs the worktree gone.** git refuses to delete a
  branch a live worktree has checked out, so pairing `--delete-branch` with
  `--remove-worktree=false` — or with a removal that got refused (dirty tree,
  base checkout, the caller's own worktree) — keeps the branch. The result
  says so in `branchKept` (`{ reason }`) and writes no `branchAnchor`.
- `delete (--task-id ID | --group GROUPID) [--force] [--delete-branch]
  [--delete-remote] [--wait]`: remove a task
  and its worktree. **The git branch stays** unless `--delete-branch` is
  passed; git is the durable record, the task row is not. Needs `--force` on a
  dirty worktree; `--force` never implies `--delete-branch`.

  **`--delete-branch` deletes the LOCAL branch by git's own rules.**
  `git branch -d` refuses a branch whose commits the base cannot reach — the
  ordinary case for work that never landed — but also accepts anything the
  branch's upstream already contains, so a pushed branch deletes even
  unmerged. `--force` upgrades the delete to `git branch -D` and takes the
  unmerged case too. The removal succeeds either way, by design.

  **`--delete-remote` is a separate opt-in that `--delete-branch` never
  implies.** A local branch is recoverable from any clone that still has it;
  a remote one is recoverable by nobody, and deleting it closes an open PR.
  It pushes `git push <remote> --delete <branch>` to the branch's own
  configured remote (`branch.<name>.remote`), falling back to `origin`.

  **The branch outcome is in the reply.** With either branch flag the result
  carries `branch`:

  ```json
  { "branch": "fix/x", "deleted": true,
    "remote": { "name": "origin", "deleted": true } }
  ```

  `deleted: false` comes with `keptReason` — git's own sentence about why it
  kept the branch (unmerged work under `-d`, or a sibling worktree still
  holding it). The point is that you can now read which happened instead of
  inferring it from `status: "removed"`, which is the worktree's outcome and
  never the branch's. `branch.remote.deleted: false` carries `error` the same
  way.

  Both flags therefore imply `--wait`: git refuses to delete a branch a live
  worktree still holds, so a verdict read before the removal resolves would
  be describing the worktree. The daemon still logs `branch kept task <id>
  branch=<name> — git refused the delete: <reason>` to `~/.rove/daemon.log`,
  next to the `removed …` line.

  **The delete gate refuses what it cannot read.** Without `--force`, deletion
  probes for gitignored work (`git status --ignored`); a probe that fails is a
  refusal, not a pass. See `docs/WORKTREES.md`.

  **The removal runs in the background** — tearing down a worktree can take
  tens of seconds — so the default reply reports only that the request was
  taken: `{ taskId, queued, status }` with `status` either `queued` or
  `not_found`. `queued: false` means no deletion was scheduled at all (no
  task by that id), and it is deliberately distinguishable from acceptance:
  the two used to return the same empty object, so a caller deleting a list
  could not tell which entries were even accepted.

  **`--wait`** follows the deletion to its outcome and reports it:

  - `removed` — the worktree and the task row are gone.
  - `failed` — removal failed and `error` carries git's own message (a
    locked or non-empty directory, a permissions problem). The task KEEPS its
    row, with `deletion.phase: "error"`, so it stays visible and re-deletable.
    Before this existed the failure reached `daemon.log` and nothing else,
    which made a failed delete indistinguishable from a successful one.
  - `pending` — still running after 60s. Not a failure: the daemon still owns
    it, so look again with `list` rather than retrying the delete.

  A deletion's state is also readable at any time from `list`: the task's
  `deletion` field carries `phase` (`queued` / `running` / `error`) and, on
  `error`, the message.

  **`--group GROUPID`** closes a whole fan-out round in one call, selecting by
  the same `groupId` `collect --group` takes (the one `add --count` returned).
  Creating and reading were already batched; only deleting was one call per
  loser, and the documented workflow ends by removing the N-1 that lost.
  Returns `{ groupId, count, failures, results }` with one entry per sibling —
  each the same object a single delete returns, or `{ taskId, status:
  "failed", error, code }`. A refusal on one sibling (a dirty worktree is the
  common one) is RECORDED rather than thrown, because aborting there would
  leave the caller unable to tell which of N were already removed. Mutually
  exclusive with `--task-id`.

## worktree

- `ensure-worktree --task-id ID`: materialize a task's git worktree on
  disk now (without starting an engine). Returns `{ worktreePath }`.
- `remove-worktree --task-id ID [--force]`: its INVERSE — remove the worktree
  directory and keep the task row and its branch, so `ensure-worktree` can
  materialize it again. This is what a script reclaiming idle checkouts wants;
  `delete` takes the task record with it. Returns `{ worktreePath, branch,
  removed, residue? }`.

  Runs the same path as the Worktrees page's delete: the engine session is
  torn down before the directory is unlinked, a dirty tree is refused without
  `--force`, and every forced removal first takes a salvage snapshot into
  `refs/rove/salvage/<branch>-<stamp>`. Two refusals are this verb's own,
  because it is scriptable and its caller is often an agent inside the very
  worktree it names: `BASE_CHECKOUT` (the project's own checkout) and
  `CALLER_WORKTREE` (the directory the command is running from). `NO_WORKTREE`
  when the task never materialized one. `residue` means git deregistered the
  worktree but could not delete the directory — the removal is as complete as
  git can make it, and this is the only time that leftover path is named.
- `discover-adoptable --repo PATH`: list existing git worktrees not yet
  tracked as Rove tasks. Returns `{ worktrees, unreadable }`. The
  repository's own primary checkout is never offered — not even when `PATH`
  is one of its linked worktrees, where the caller and the main checkout are
  different directories. `adopt` validates against this same list, so it
  refuses the primary checkout by name. `unreadable` is
  the admin-dir names under `<repo>/.git/worktrees/` that `git worktree list`
  omitted without an error — a worktree that exists on disk (uncommitted work
  and all) but cannot be read, and so cannot be adopted until the permissions
  are fixed. `worktrees: []` with `unreadable: []` is the only combination that
  means "this repo has nothing to adopt".
- `adopt --repo PATH --worktree PATH [--branch B] [--command CMD] [--title T]`:
  import an existing git worktree as a Rove task.

## feedback

- `feedback --title T --body TEXT [--category SLUG]` *(offline)*: create a
  GitHub Discussion in the Rove repository's Feedback category via `gh`.
