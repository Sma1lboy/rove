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
`active-task`, `update`, `attention.inbox`, `ui-prefs`, `worktree.changes`,
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
rove api read-output --task-id <id>    # paged history, honest terminal fallback
rove api read-output --task-id <id> --tab tab-3   # one exact tab's terminal
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
  round that did not fully succeed. Exit 3 does **not** promise anything was
  created: `--count 1` takes the same path, so a lone failure returns
  `count: 0` with an empty `tasks`. The full payload still goes to stdout, so
  whatever *was* created is never lost.
- `rove api <verb> --help` prints that verb's usage and exits 0.

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
| `MISSING_TARGET` | No `--task-id`, no `$ROVE_TASK_ID`, no active task — nothing was named. |
| `TASK_NOT_FOUND` | An id WAS named and does not resolve. |
| `TAB_NOT_FOUND` | A `--tab tab-N` the task has no live (or restorable) tab for. |
| `NOT_A_REPO` | `--repo` does not point at a git repository. |
| `NO_WORKTREE` | The task has no materialized worktree yet. |
| `HISTORY_REQUIRED` | `read-output --source history` on an engine with no history reader. |
| `HISTORY_UNREADABLE` | The engine's history exists but could not be parsed. |
| `CURSOR_INVALID` | A `--cursor` value this build cannot decode. |
| `CURSOR_TASK_MISMATCH` | The cursor belongs to a different task. |
| `SOURCE_CHANGED` | The cursor's source/session/tab moved under it. |
| `COMPOSER_BUSY` | The target composer held un-sent text; nothing was pasted. |
| `NOT_DELIVERED` | The task was created but the prompt never reached its engine. |
| `DEFERRED_PROMPT_PENDING` | The tab already holds a deferred prompt; release or dismiss it first. |
| `DEFERRED_PROMPT_NOT_FOUND` | A `deferred-release` / `deferred-dismiss` id the daemon no longer holds. |
| `SESSION_FAILED` | A hosted engine session could not be started or written to. |
| `BAD_EFFORT` | The task's engine declares no effort levels, or not that one. |
| `PARTIAL_FANOUT` | A parallel round with at least one failure (exit 3). |

`DELIVER_FAILED` and `CREATE_FAILED` are not error codes in that sense: they
only ever appear inside a `PARTIAL_FANOUT` payload, on `failures[].error.code`,
naming which stage lost that one sibling. A caller reads them from stdout.

Flag parsing: `--key value` and `--key=value` both work; boolean flags may
be given bare (`--force` ⇒ true) or explicitly (`--pinned=false`);
`--tab` / enum / positive-int values are validated against the verb's
spec, and unknown flags are rejected (exit 2). `--repo` resolves relative
paths against `$PWD` (`~` expanded). `spawn-task` is an alias of `add`.

Engines are chosen by COMMAND, not by a vendor enum: `--command` takes an
engine id from `engine-list` (`claude`, `codex`, `copilot`, `kimi`, the shipped
contrib engines whose CLI is installed — `gemini`, `opencode`, `cursor`,
`grok`, `droid`, `amp` — plus any engine you registered) **or** a full command
line Rove runs verbatim
(`--command "codex --search"`). Nothing validates an engine's flags, so probe
an unfamiliar one with `<cmd> --help` before dispatching. See
[ENGINES.md](./ENGINES.md#engine-presets-and-protocols) for how the protocol
Rove speaks to a command is derived from it.

Three verbs were REMOVED (no aliases): `fan-out` → `add --count N`,
`set-vendor` → `set-command`, and `archive` → `delete` (there is no
hide-without-delete any more; the branch survives unless you pass
`--delete-branch`). Calling any of them returns `UNKNOWN_VERB` with the
replacement in `nextCommandArgs`.

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
  name, and its `protocol` (the adapter Rove speaks to it: history reads,
  trust pre-answer, first-message delivery; `generic` = none). A plugin engine
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
- `collect [--task-ids a,b,c] [--group GROUPID] [--repo PATH]`: read-only
  health snapshot of a parallel round — the one read that answers "what is
  this round's status right now" without fanning out to `get-task` per task.
  Select the tasks by fan-out round (`--group`, the `groupId` that
  `add --count` returns), by repo, or by explicit ids.

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
  - `.activity` — `{state, at, forMs}` from the daemon's activity registry:
    the engine's state (`running` / `idle` / `permission_needed` /
    `rate_limited` / `error` / `turn_complete`) and how long it has been in
    it. `forMs` is the "stuck for 40 minutes" number. `null` when the
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
  tail (`fallbackReason`). The cursor is pinned to one source/session/tab and
  returns `SOURCE_CHANGED` if that moved. `--tab tab-N` reads exactly that
  tab's hosted terminal session (terminal-only; `TAB_NOT_FOUND` when the tab
  has no session). A dead session's terminal page includes `terminal.exit`
  (`code`/`signal`/`at`) while the PTY host still runs.
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

## create

- `add --repo PATH [--title T] [--branch B] [--base-branch B]
  [--command CMD] [--count N | --agents claude:2,codex:1] [--status S]
  [--pin] [--activate] [--prompt TEXT | --prompt-file PATH]`: create a task (appears in the
  sidebar immediately). With `--prompt` it also materializes the worktree,
  starts the engine, and delivers the prompt. Does not steal focus unless
  `--activate`. Alias: `spawn-task`. Without `--branch`, the branch name is
  auto-derived from the title following the repo's own branch-naming
  convention (inferred from its existing local + origin branches, e.g.
  `feat/login-flow` in a type-prefixed repo, `login-flow` in a bare-slug or
  empty repo; name collisions get a short `-2`/`-3` suffix).
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
`$ROVE_TASK_ID`/`$ROVE_TAB_ID`, with Kobe aliases). That is the reply address
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
  [--command CMD] [--plain] [--allow-empty]`: paste a
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
  `--plain` skips that prefix. `--tab new` spawns a fresh engine tab, while
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
  instead of pasting into a shell. Any registered engine passes, so a tab may
  run a different vendor than its task. Without `--tab`, the canonical target
  is a live engine tab (`tab-1` first, then any surviving engine tab); when
  live tabs exist but none resolves as an engine, `send` refuses with
  `NO_ENGINE_TAB` rather than silently spawning a duplicate engine. Only a
  task with no live session at all auto-starts its canonical engine tab, in
  the task's worktree. `started: true` in the result marks that fresh
  session (vs. delivery into an existing one).
  If a busy composer defers the prompt, the result has `delivered: false` and
  a `deferred` record — its `id`, the `layer` that blocked it, and
  `expiresAt`, the moment the daemon's sweep drops the text. **Deferred is
  not delivered.** The daemon keeps one deferred prompt per tab, and a later
  send to that tab fails with `DEFERRED_PROMPT_PENDING` until that record is
  released, dismissed, or expires; it never replaces text the daemon already
  accepted. With a human attached, the Inbox is where the prompt gets
  released. With nobody attached, `deferred-release` is — see the three
  verbs below; a record nobody acts on is swept 24h after it was filed and
  never delivered. During an upgrade, a new client fails the send if the
  running daemon cannot provide first-writer-wins filing. Restart Rove to use
  the new daemon, then retry the original command.

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
- `dispatch --task-id ID (--prompt TEXT | --prompt-file PATH) [--tab TAB]`: route text into a
  task's live session (the dispatcher's messenger; see
  [design/dispatcher.md](./design/dispatcher.md)). Unlike `send` it never
  starts an engine — it needs a session that is already hosted. `--tab tab-N`
  delivers into exactly that tab instead of the canonical engine tab. The
  result's `delivered` is the verdict:
  - `true` — the daemon pasted the text into a live engine session, and
    `tabId` names which tab took it.
  - `false` with `reason: "busy"` — a human is mid-message in that composer,
    so nothing was written (`layer` says which gate held it back). Retry when
    the composer is clear, or use `send`, which files a deferral instead.
  - `false` with `reason: "broadcast"` — no hosted session answered, so the
    text went out on the `session.deliver` channel for a browser-hosted
    session to pick up. Nothing can confirm that paste; `clients` is a raw
    connection count (the calling CLI is one of them) and only its `0` proves
    anything — the text reached nobody.
- `deferred-list [--task-id ID]`: every prompt the daemon is holding because
  the target composer was busy when it arrived — the Inbox, read by a caller
  with no screen. Each record carries its `id`, `taskId`, `tabId`, the
  verbatim `prompt`, the `layer` that blocked it, `at`, and `expiresAt`.
  Returns `{ records }`; `--task-id` filters to one task.
- `deferred-release --id ID`: deliver one held prompt now (the Inbox's
  release action). It re-runs the delivery gate rather than bypassing it, so
  a composer that is STILL busy leaves the record held and returns
  `delivered: false` with the blocking `reason` — retry later. Returns
  `{ id, delivered, reason? }`; an id the daemon no longer holds is
  `DEFERRED_PROMPT_NOT_FOUND`.
- `deferred-dismiss --id ID`: drop one held prompt WITHOUT delivering it and
  free its tab's deferred slot. The text is gone — dismiss a message that is
  no longer wanted, then send the replacement. Returns `{ dismissed }`.
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
  `clients`, the attached-connection count: `0` means nobody performed the
  split, so an agent must not report "pane opened" on that verdict. (The
  calling CLI is itself one connection, so `1` does not prove a TUI is
  listening; `0` is the unambiguous case.) Task
  defaults to `$ROVE_TASK_ID` (or its Kobe alias), then the active task. How far splits can go
  is decided by the terminal's size: a split that would shrink any pane
  below the minimum usable size (20×6 cells) falls back to a tab.
- `pane-close [--task-id ID] --title TEXT [--tab TAB]`: the inverse; close
  every pane (split leaf / command tab) in the task whose label matches
  `--title`, the title it was opened with; `--tab tab-N` scopes the match to
  one tab. Engine panes are never closed. Broadcast over the daemon's
  `tab.close` channel; an attached TUI performs the close (headless, nothing
  happens). The result's `clients` is the reach signal: `0` = no attached TUI
  performed the close (same semantics as `dispatch`'s).
- `tab-close --task-id ID --tab TAB`: close one exact Terminal Tab using the
  id returned by `get-task` in `.tabs[].id`. Engine, interactive-shell,
  command, and content tabs are all valid. With an attached TUI, the command
  runs the same close path as ctrl+w, so the tab strip updates immediately;
  headless, it removes the persisted tab snapshot and ends the tab's hosted
  PTY plus any split-leaf PTYs directly. Closing the last tab leaves the task
  open with no session, matching ctrl+w. A tab that still exists in the
  snapshot may be closed after its process dies; an absent or already-closed
  id returns `TAB_NOT_FOUND` with a `get-task` recovery command.
- `notify --title TEXT [--body TEXT] [--kind KIND] [--task-id ID]
  [--source TAG]`: show a toast in every attached Rove UI. `--body` adds a
  second, muted line under the title — context, not a second message.
  `done` / `needs_input` / `error` get severity styling; any other kind
  renders neutrally. The result's `clients` is the reach signal: `0` = no
  attached UI showed the toast (headless).
- `prompt --title TEXT [--placeholder T] [--initial T] [--timeout MS]`:
  ask the human for a line of text through the attached TUI's input dialog;
  blocks until answered/cancelled/timeout (default 120000 ms, max 600000)
  and returns `{ value }` or `{ cancelled, reason }`.
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

## edit

- `rename --task-id ID --title T [--tab TAB]`: set a task's title, or with
  `--tab` one Terminal Tab's name — the API twin of the TUI's f2. Tab
  lifecycle is otherwise symmetric already (`pane-open`, `tab-close`,
  `read-output --tab`, `send --tab`), so naming was the one thing an agent
  could not do to a tab it had opened itself. `TAB_NOT_FOUND` when the task's
  snapshot names no such tab — `get-task` lists the addressable ids in
  `.tabs[].id`. An attached TUI repaints its tab strip; with none attached the
  persisted snapshot carries the name to the next mount.
- `set-branch --task-id ID --branch B`: rename a task's branch
  (`git branch -m` if materialized, else recorded).
- `set-command --task-id ID --command CMD`: set a task's engine launch
  command (takes effect on next session rebuild). The protocol Rove speaks
  to it is derived from the command; the result reports which one, and
  `generic` when the command names no engine Rove knows. Replaces the
  removed `set-vendor`.
- `set-effort --task-id ID --level LEVEL`: set a task's reasoning effort
  level (takes effect on the next session rebuild). Levels are declared by
  the task's engine — codex accepts `none`, `low`, `medium`, `high`, `xhigh`,
  `max`;
  claude declares none. A level the engine does not declare is rejected
  (`BAD_EFFORT`, naming the levels it does accept) rather than passed through,
  because the launch path drops an unknown level silently.
- `set-status --task-id ID --status S`: set lifecycle status:
  `backlog`, `in_progress`, `in_review`, `done`, `canceled`, `error`.

## issues

The daemon-owned issue store (backlog; see
[WORK-TRACKING.md](./WORK-TRACKING.md)). Statuses: `open`, `doing`, `hold`,
`done`.

- `issue-list --repo PATH`: list a repo's issues.
- `issue-create --repo PATH --title T [--body TEXT]`: create an issue.
- `issue-set-status --repo PATH --id N --status S`: set an issue's status.
- `issue-update --repo PATH --id N [--title T] [--body TEXT] [--task ID]`:
  edit title/body and/or link a task (kanban: In progress; `--task none`
  unlinks). All three land in one store write, so a rejected `--task` leaves
  the title and body unchanged — the error means nothing was applied.
- `issue-delete --repo PATH --id N`: delete an issue. Removes ONLY the tracker
  record — a linked task, its branch and its worktree are left untouched. The
  same store op the kanban page's `d` runs, which the CLI could not reach: an
  agent asked to clear a batch of stale stories could previously only mark
  them `done` and leave them. Use `issue-set-status --status done` when the
  story was finished rather than abandoned.

## workitems

A **read-only** view of a repo's GitHub issues (through the `gh` CLI), plus one
action: start a task on one. Deliberately not an import; the issue stays
GitHub's, and nothing is copied into Rove's own issue store. Mechanics:
[design/work-items.md](./design/work-items.md).

- `workitem-list --repo PATH [--state open|closed|all] [--limit N] [--search Q]
  [--assignee USER] [--label L]`: list issues. `--assignee @me` for your own.
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
  [--vendor V] [--base-branch B] [--precheck CMD] [--precheck-timeout SEC]
  [--grace MIN] [--persistent-session] [--disabled] [--target-task ID --target-tab TAB]`: schedule a prompt. `--schedule` is five-field
  cron in the daemon host's local time (`"0 9 * * MON-FRI"`).
- `routine-update --id ID [...]`: change any field. A new `--schedule`
  re-anchors the next run; `--precheck ''` clears the precheck. Omitted target flags
  preserve the binding; `--target-task '' --target-tab ''` sends `target: null` to clear it.
- `routine-set-enabled --id ID --enabled BOOL`: pause / resume.
- `routine-run-now --id ID`: run immediately, skipping the precheck. Does
  not shift the schedule.
- `routine-runs --id ID`: run history, newest first. `revived` and `deferred`
  describe revival and queue acceptance; `skipped_cancelled` means disabled, changed or stopped before delivery. Bound deliveries include `taskId`/`tabId`; queue acceptance also includes `deferredId`. An unknown id is an error
  (`automation not found`), not an empty history.
- `routine-delete --id ID`: delete it and its history (tasks it already
  created are untouched). Idempotent: deleting an id that is already gone
  succeeds with `{ "deleted": false }`.

**`--persistent-session`** keeps ONE task per routine and delivers each firing
into it, so a daily check can build on yesterday. Its task is folded behind the
sidebar's `N routine sessions` count row (still findable by search, still
Inbox-reachable). Leave it off for a routine that edits code: a week of runs on
one branch is a branch nobody can land. Two extra run statuses come with it —
`revived` (the engine had exited, so it was respawned in the same worktree; the
files carried over, the conversation did not) and `deferred` (the composer was
busy, so the prompt was accepted into the Inbox and has not been delivered).

**Existing target:** the daemon payload is `target: {kind: "existing-tab", taskId, tabId}`.
The repo must match the task repo; `vendor`, `baseRef` and `persistentSession`
are incompatible with this mode. Updates validate the merged record; clear old
launch settings with `--vendor '' --base-branch '' --persistent-session false`
when binding. Missing/deleting tasks, missing tabs and exited engines fail without
fallback. Disabling stops future scheduling, including a run still in precheck;
already queued Inbox prompts retain their own release/expiry lifecycle. Claims
survive restarts without replay, but a crash after claim and before delivery can
lose an occurrence. See [existing conversation delivery](ROUTINES.md#deliver-into-an-existing-conversation).

**`--precheck`** runs a shell command in the repo before the engine starts;
a non-zero exit skips the run *without* creating a task. Use it so a schedule
does not burn a turn when nothing changed (`git log --since=24.hours --oneline
| grep -q .`). Run statuses: `dispatched`, `skipped_precheck` (healthy:
nothing to do), `skipped_missed`, `skipped_unavailable`, and
`dispatch_failed` (needs a human).

## lifecycle

- `pin --task-id ID [--pinned=false]`: pin/unpin a task to the top of the
  sidebar.
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
- `delete (--task-id ID | --group GROUPID) [--force] [--delete-branch] [--wait]`: remove a task
  and its worktree. **The git branch stays** unless `--delete-branch` is
  passed; git is the durable record, the task row is not. Needs `--force` on a
  dirty worktree; `--force` never implies `--delete-branch`.

  **`--delete-branch` is best-effort and its outcome is in the daemon log, not
  this reply.** `git branch -d` refuses a branch whose commits the base cannot
  reach — the ordinary case for work that never landed — and the removal
  succeeds anyway, by design. The reply cannot carry that verdict: by the time
  `--wait` resolves, the task row it would ride on has been removed, which is
  how `--wait` knows the deletion finished. So a refusal is logged instead, as
  `branch kept task <id> branch=<name> — git refused the delete: <reason>` in
  `~/.rove/daemon.log`, next to the `removed …` line. Check `git branch` if
  you need the answer programmatically.

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
