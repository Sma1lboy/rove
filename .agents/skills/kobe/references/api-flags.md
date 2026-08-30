# `rove api` flag reference

Every verb and flag, so you don't pay a `schema` round-trip to look one up.
SKILL.md covers the verbs you need for routing and lifecycle; this file is the
full surface, including the groups SKILL.md deliberately leaves out
(routines, GitHub work items, telemetry reads, field notes).

Authoritative source is still the binary — `rove api schema --verb <name>` or
`rove api <verb> --help`. Read that when this file and a rejection disagree;
the CLI is what ships.

Global: `--pretty` (readable JSON), `--help` (usage, exit).
Every `--repo` resolves relative paths against `$PWD` and wants the git toplevel.

## The hot path

These five carry almost all traffic. Nothing here should ever need `schema`.

```text
add     --repo(REQ) --prompt --title --command --count --agents
        --branch --base-branch --status --pin --activate
send    --prompt(REQ) --task-id --tab --command --plain
get-task --task-id(REQ)
list    (no flags)
collect --task-ids <csv> | --repo
```

Four flag names that have actually been guessed wrong here, and what they are:

| Guessed | Real |
|---|---|
| `add --vendor` | `add --command` (engine id or full command line) |
| `read-output --task` | `read-output --task-id` |
| `dispatch --text` | `dispatch --prompt` (`--text` belongs to `note`) |
| `issue-list --state` | none — `issue-list` takes only `--repo`; filter the JSON yourself |

`--count`/`--agents` require `--prompt`. `--branch` is single-task only.
`--tab new` is the only placement that accepts `send --command`.

## Retired — these no longer exist

| Gone | Now |
|---|---|
| `archive` | `delete` (task + worktree go; the git branch survives unless `--delete-branch`) |
| `fan-out` | `add --count N` / `add --agents claude:2,codex:1` |
| `task-list` | `list` |
| `send-tab` | `send --tab tab-N` |
| `$KOBE_TASK_ID` / `$KOBE_TAB_ID` | `$ROVE_TASK_ID` / `$ROVE_TAB_ID` |

Seeing one of these in guidance means that guidance predates the rename —
`rove api schema` is the tiebreak.

## read

```text
list          (none)                     every task
get-task      --task-id(REQ)             one task + .tabs[] — the read before `send --tab`
collect       --task-ids <csv> --repo    comparison snapshot across tasks
inspect       --task-id                  daemon activity + pty walk + tab snapshots
pty-list      (none)                     live hosted PTYs: key, alive, pid, command, OSC title
read-output   --task-id --tab --source[auto|history|terminal] --cursor --limit
digest        --repo(REQ) --since-days(7)
agent-turns   --task-id --repo --since-days(7) --limit(200)
```

`pty-list` is what `NO_ENGINE_TAB`'s hint points at: when `.tabs[]` and reality
disagree, it is the ground truth for what is actually alive.

`read-output --limit` maxes at 50 (default 40). `--tab` is terminal-only —
it cannot combine with `--source history`. The cursor is pinned to one
source/session/tab; a moved target returns `SOURCE_CHANGED` rather than
silently paging something else.

`digest` and `agent-turns` are the measurement reads — `digest` aggregates a
repo's recent task + routine activity, `agent-turns` is per-turn telemetry
(vendor, model, timings, tokens). Reach for them when a workflow question
needs numbers, not when you want to know what a task is doing.

## drive

```text
send        --prompt(REQ) --task-id --tab --command --plain
dispatch    --task-id(REQ) --prompt(REQ) --tab
note        --task-id(REQ) --text(REQ)
note-list   --repo(REQ)
pane-open   --command --task-id --tab --direction[right|down] --placement[split|tab] --title
pane-close  --title(REQ) --task-id --tab
notify      --title(REQ) --kind --task-id --source
prompt      --title(REQ) --placeholder --initial --timeout
set-active  --task-id | --none
```

**`note` is the repo's durable field-note store.** One line, a verified
conclusion another session could act on — it is appended to the repo's notes
(every future session on this repo starts with them) AND relayed to the
dispatcher. Read them back with `note-list --repo`. This is the right home for
a resolved gotcha; an issue is for work that still needs doing.

`notify --kind` styles the toast: `done`, `needs_input`, `error` get severity
treatment and an unread mark, anything else renders neutrally.

`prompt` blocks on a human answering the attached TUI's input dialog —
`--timeout` defaults to 120000ms, caps at 600000. Returns `{ value }` or
`{ cancelled, reason }`. No attached TUI means no answer.

`pane-open --command` runs through the login shell's `-ilc`, so pipes and
your rc's PATH work.

## create / edit / lifecycle

```text
add            --repo(REQ) + the hot-path flags above
rename         --task-id(REQ) --title(REQ)
set-branch     --task-id(REQ) --branch(REQ)
set-command    --task-id(REQ) --command(REQ)      next launch only
set-status     --task-id(REQ) --status(REQ)[backlog|in_progress|in_review|done|canceled|error]
pin            --task-id(REQ) --pinned(true)
land           --task-id(REQ) --strategy[merge|squash] --delete-branch --remove-worktree(true)
delete         --task-id(REQ) --force --delete-branch
```

Task `--status` and issue `--status` are DIFFERENT enums — a task is
`backlog|in_progress|in_review|done|canceled|error`, an issue is
`open|doing|hold|done`.

`land` refuses a dirty base checkout and refuses a branch with zero commits
ahead (`EMPTY_BRANCH`; `EMPTY_BRANCH_DIRTY_WORKTREE` when the worktree still
holds the uncommitted work, with a send-back recovery path). Conflict aborts
cleanly and returns the conflicted files.

## worktree

```text
ensure-worktree      --task-id(REQ)
discover-adoptable   --repo(REQ)
adopt                --repo(REQ) --worktree(REQ) --branch --title --command
```

## issues (daemon-owned)

```text
issue-list        --repo(REQ)
issue-create      --repo(REQ) --title(REQ) --body
issue-update      --repo(REQ) --id(REQ,int) --title --body --task
issue-set-status  --repo(REQ) --id(REQ,int) --status(REQ)[open|doing|hold|done]
```

`--id` is an int, not the ULID a task uses. `issue-update --task <taskId>` is
the kanban "move to In progress"; `--task none` unlinks. Kanban semantics are
in SKILL.md — do not move cards with `issue-set-status doing`.

## workitems (GitHub, through `gh`)

Read-only against the repo's real GitHub issues; nothing is copied into Rove's
own store. These are the INBOUND user reports; Rove issues are the backlog.

```text
workitem-list   --repo(REQ) --state[open|closed|all] --limit(20,max 50) --search --assignee --label
workitem-start  --repo(REQ) --number(REQ,int) --vendor --base-branch
```

`workitem-start` creates a worktree + engine whose first message carries the
issue title, body, and URL, and keeps a link back to the issue. Note it takes
`--vendor` (an engine enum), not `--command` — the one place the older
vocabulary survives.

## routines (scheduled prompts)

Each firing creates a FRESH task — worktree, engine, delivered prompt. An
enabled routine holds the daemon alive so it fires with no TUI attached.

```text
routine-list         (none)
routine-create       --repo(REQ) --name(REQ) --prompt(REQ) --schedule(REQ)
                     --vendor --base-branch --precheck --precheck-timeout(120) --grace(60) --disabled
routine-update       --id(REQ) --name --prompt --schedule --vendor --base-branch --precheck --precheck-timeout --grace
routine-set-enabled  --id(REQ) --enabled(REQ,bool)
routine-delete       --id(REQ)
routine-run-now      --id(REQ)
routine-runs         --id(REQ)
```

`--schedule` is five-field cron in the DAEMON HOST's local time
(`'0 9 * * MON-FRI'`). `--precheck` is a shell command run in the repo before
the engine starts — non-zero exit skips the run without spawning an agent,
which is the cheap way to not burn a turn on "nothing to do". `--grace` is how
late a missed occurrence may still run after the daemon was down; only the
most recent missed occurrence ever runs.

`routine-update --schedule` re-anchors the next run. `--precheck ''` clears it.
`routine-run-now` skips the precheck deliberately (asking for it IS the answer)
and does not shift the schedule. `routine-delete` leaves already-created tasks
alone.

Run statuses from `routine-runs`: `dispatched`, `skipped_precheck` (nothing to
do), `skipped_missed`, `skipped_unavailable`, `dispatch_failed`.

## discover / feedback

```text
schema        --verb <name> | --group <g> | --all      (bare = compact index)
engine-list   (none)                                   ids + RAW launch command + protocol
feedback      --title(REQ) --body(REQ) --category(feedback)
```

`feedback` opens a GitHub Discussion in the Rove repo through `gh` — Rove's own
product feedback channel, not a way to file work for another project (that is
a `send` to their main task; see SKILL.md).

## Error codes

Errors go to stderr as `{"error":{"message","code",...}}`. Most carry `hint`
(what to do) and `nextCommandArgs` (argv for the same executable — run
`rove <args...>` verbatim).

| Code | Means | Recover |
|---|---|---|
| `BAD_FLAG` | flag not on that verb | check the table above, then `schema --verb <v>` |
| `TASK_NOT_FOUND` | id deleted or mistyped | `rove api list` |
| `NO_ENGINE_TAB` | live tabs exist, none is an engine | `--tab tab-N` from `pty-list`, or `--tab new` |
| `DISPATCHER_UNREACHABLE` | bare `send` reply, dispatcher gone | nothing alive to reply to — never silently spawns |
| `SOURCE_CHANGED` | `read-output` cursor's target moved | re-read without the cursor |
| `EMPTY_BRANCH` | `land` on zero commits ahead | the worker committed nothing |
