# `rove api` flag reference

Every verb and flag, so you don't pay a `schema` round-trip to look one up.
SKILL.md covers the verbs you need for routing and lifecycle; this file is the
full surface, including the groups SKILL.md deliberately leaves out
(routines, GitHub work items, telemetry reads, field notes).

Authoritative source is still the binary — `rove api schema --verb <name>` or
`rove api <verb> --help`. Read that when this file and a rejection disagree;
the CLI is what ships.

Every fenced block below is GENERATED from the same verb specs `schema`
serves (`bun scripts/gen-skill-api-flags.ts`); the prose between them is
written by hand. Notation: `(REQ)` required, `(x)` the default when the flag is
omitted, `{a|b}` the allowed values, `--a|--b` two spellings of one choice.

Global: `--pretty` (readable JSON), `--help` (usage, exit).
Every `--repo` resolves relative paths against `$PWD` and wants the git toplevel.

## The hot path

These five carry almost all traffic. Nothing here should ever need `schema`.

```text
add     --repo(REQ) --prompt|--prompt-file --title --command --count --agents
        --branch --base-branch --status --pin --activate
send    --prompt|--prompt-file(REQ) --task-id --tab --command --plain --allow-empty
get-task --task-id(REQ)
list    (no flags)
collect --task-ids <csv> | --group | --repo
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
| `set-vendor` | `set-command` (an engine id from `engine-list`, or a full command line) |

Seeing one of these in guidance means that guidance predates the rename —
`rove api schema` is the tiebreak.

`$KOBE_TASK_ID` / `$KOBE_TAB_ID` are NOT retired: they are still exported into
every engine tab as aliases of `$ROVE_TASK_ID` / `$ROVE_TAB_ID`, and parts of
the daemon still read the `KOBE_` spelling. Write the `ROVE_` names; expect to
see both.

## read

<!-- generated:begin read -->
```text
list         (none)
get-task     --task-id(REQ)
pty-list     (none)
collect      --task-ids <a,b,c> --group --repo
digest       --repo(REQ) --since-days(7)
agent-turns  --task-id --repo --since-days(7) --limit(200)
inspect      --task-id
read-output  --task-id --tab --source{auto|history|terminal}(auto) --cursor --limit(40)
```
<!-- generated:end -->

`get-task` is the read before `send --tab` — one task plus its `.tabs[]`.
`collect` is the comparison snapshot across tasks: pass `--group <groupId>`
(what `add --count` returned), a `--task-ids` csv, or a `--repo`; `inspect` is
the wider diagnostic — daemon activity, a pty walk, and every tab snapshot.

`pty-list` is what `NO_ENGINE_TAB`'s hint points at: when `.tabs[]` and reality
disagree, it is the ground truth for what is actually alive — key, alive, pid,
command, OSC title.

`read-output --limit` maxes at 50. `--tab` is terminal-only — it cannot combine
with `--source history`. The cursor is pinned to one source/session/tab; a
moved target returns `SOURCE_CHANGED` rather than silently paging something
else.

`digest` and `agent-turns` are the measurement reads — `digest` aggregates a
repo's recent task + routine activity, `agent-turns` is per-turn telemetry
(vendor, model, timings, tokens). Reach for them when a workflow question
needs numbers, not when you want to know what a task is doing.

## drive

<!-- generated:begin drive -->
```text
send              --task-id --prompt|--prompt-file(REQ) --tab --command --plain
                  --allow-empty
dispatch          --task-id(REQ) --prompt|--prompt-file(REQ) --tab
deferred-list     --task-id
deferred-release  --id(REQ)
deferred-dismiss  --id(REQ)
note              --task-id(REQ) --text(REQ)
note-list         --repo(REQ)
pane-open         --task-id --tab --command --direction{right|down}(right)
                  --placement{split|tab}(split) --title
pane-close        --task-id --title(REQ) --tab
tab-close         --task-id(REQ) --tab(REQ)
notify            --title(REQ) --body --kind(done) --task-id --source
prompt            --title(REQ) --placeholder --initial --timeout
engine-report     --task-id --kind(REQ) --engine --tab --detail
set-active        --task-id --none
```
<!-- generated:end -->

**The `deferred-*` trio is the Inbox, for a caller with no screen.** A `send`
into a busy composer exits 0 with `deferred` in its JSON: the daemon owns the
text now, and the TUI Inbox is where a human releases it. Headless there is no
human, so the record sits until `deferred.expiresAt` (24h after filing) and is
then swept UNDELIVERED — and every `send` to that tab fails
`DEFERRED_PROMPT_PENDING` meanwhile. `deferred-list` shows what is held and
until when, `deferred-release --id` delivers it (re-running the gate, so a
still-busy composer answers `delivered:false` with a `reason` — retry, do not
re-send), and `deferred-dismiss --id` drops it and frees the tab's slot.

**`note` is the repo's durable field-note store.** One line, a verified
conclusion another session could act on — it is appended to the repo's notes
(every future session on this repo starts with them) AND relayed to the
dispatcher. Read them back with `note-list --repo`. This is the right home for
a resolved gotcha; an issue is for work that still needs doing.

`send --allow-empty` is the escape hatch for a `succeeded:` report from a task
that legitimately produced no commits (an investigation, a review, a question
answered); without it such a report is refused with `EMPTY_SUCCESS_REPORT`.

`notify --kind` styles the toast: `done`, `needs_input`, `error` get severity
treatment and an unread mark, anything else renders neutrally.

`prompt` blocks on a human answering the attached TUI's input dialog —
`--timeout` defaults to 120000ms, caps at 600000. Returns `{ value }` or
`{ cancelled, reason }`. No attached TUI means no answer.

`pane-open --command` runs through the login shell's `-ilc`, so pipes and
your rc's PATH work.

`tab-close` names one exact Terminal Tab from `get-task .tabs[].id`. Unlike
`pane-close`, it also works headless: it removes the persisted tab snapshot
and ends that tab's hosted PTYs. It accepts engine, shell/command, and content
tabs; closing the last tab leaves the task open with no session. A missing or
already-closed id returns `TAB_NOT_FOUND` and points back to `get-task`.

`engine-report` is the engine adapter's own channel for reporting a session
event (`--kind`) back to the daemon — not a verb you reach for by hand.

`set-active` takes one or the other: a `--task-id` to focus, or `--none` to
clear the shared active task.

## create / edit / lifecycle

<!-- generated:begin create,edit,lifecycle -->
```text
add          --repo(REQ) --title --branch --base-branch --command --count
             --agents <claude:2,codex:1>
             --status{backlog|in_progress|in_review|done|canceled|error}(backlog) --pin
             --activate(false) --prompt|--prompt-file
rename       --task-id(REQ) --title(REQ)
set-branch   --task-id(REQ) --branch(REQ)
set-command  --task-id(REQ) --command(REQ)
set-effort   --task-id(REQ) --level(REQ)
set-status   --task-id(REQ)
             --status{backlog|in_progress|in_review|done|canceled|error}(REQ)
pin          --task-id(REQ) --pinned(true)
land         --task-id(REQ) --dry-run --strategy{merge|squash}(merge) --delete-branch
             --remove-worktree(true)
delete       --task-id(REQ) --force --delete-branch --wait
```
<!-- generated:end -->

`set-command` takes effect on the NEXT launch only. `set-effort --level` is
engine-owned — the levels a vendor accepts come from its registry entry, so
check `engine-list` rather than guessing.

Task `--status` and issue `--status` are DIFFERENT enums — a task is
`backlog|in_progress|in_review|done|canceled|error`, an issue is
`open|doing|hold|done`.

`land` refuses a dirty base checkout and refuses a branch with zero commits
ahead (`EMPTY_BRANCH`; `EMPTY_BRANCH_DIRTY_WORKTREE` when the worktree still
holds the uncommitted work, with a send-back recovery path). Conflict aborts
cleanly and returns the conflicted files.

`delete --wait` is what turns "queued" into an answer — without it the call
returns before the worktree is gone.

## worktree

<!-- generated:begin worktree -->
```text
ensure-worktree     --task-id(REQ)
discover-adoptable  --repo(REQ)
adopt               --repo(REQ) --worktree(REQ) --branch --command --title
```
<!-- generated:end -->

## issues (daemon-owned)

<!-- generated:begin issues -->
```text
issue-list        --repo(REQ)
issue-create      --repo(REQ) --title(REQ) --body
issue-set-status  --repo(REQ) --id(REQ) --status{open|doing|hold|done}(REQ)
issue-update      --repo(REQ) --id(REQ) --title --body --task
```
<!-- generated:end -->

`--id` is an int, not the ULID a task uses. `issue-update --task <taskId>` is
the kanban "move to In progress"; `--task none` unlinks. Kanban semantics are
in SKILL.md — do not move cards with `issue-set-status doing`.

## workitems (GitHub, through `gh`)

Read-only against the repo's real GitHub issues; nothing is copied into Rove's
own store. These are the INBOUND user reports; Rove issues are the backlog.

<!-- generated:begin workitems -->
```text
workitem-list   --repo(REQ) --state{open|closed|all}(open) --limit(20) --search --assignee
                --label
workitem-start  --repo(REQ) --number(REQ) --vendor{claude|codex|copilot|kimi}
                --base-branch
```
<!-- generated:end -->

`workitem-list --limit` caps at 50. `workitem-start` creates a worktree +
engine whose first message carries the issue title, body, and URL, and keeps a
link back to the issue. Note it takes `--vendor` (an engine enum), not
`--command` — the one place the older vocabulary survives.

## routines (scheduled prompts)

A cron rule + a prompt + a repo, owned by the daemon. By default each firing
creates a FRESH task — worktree, engine, delivered prompt. With
`--persistent-session` every firing lands in ONE standing task as the next
turn of the same conversation (a Claude Code-style routine: one window, one
vendor, messages keep arriving). An enabled routine holds the daemon alive so
it fires with no TUI attached.

<!-- generated:begin routine -->
```text
routine-list         (none)
routine-create       --repo(REQ) --name(REQ) --prompt|--prompt-file(REQ) --schedule(REQ)
                     --vendor{claude|codex|copilot|kimi} --base-branch --precheck
                     --precheck-timeout(120) --grace(60) --persistent-session --disabled
routine-update       --id(REQ) --name --prompt|--prompt-file --schedule
                     --vendor{claude|codex|copilot|kimi} --base-branch --precheck
                     --precheck-timeout(120) --grace(60) --persistent-session
routine-set-enabled  --id(REQ) --enabled(REQ)
routine-delete       --id(REQ)
routine-run-now      --id(REQ)
routine-runs         --id(REQ)
```
<!-- generated:end -->

`--schedule` is five-field cron in the DAEMON HOST's local time
(`'0 9 * * MON-FRI'`). `--precheck` is a shell command run in the repo before
the engine starts — non-zero exit skips the run without spawning an agent,
which is the cheap way to not burn a turn on "nothing to do". `--grace` is how
late a missed occurrence may still run after the daemon was down; only the
most recent missed occurrence ever runs.

Pick the mode by what the prompt DOES. A routine that EDITS code wants the
default: each run is its own branch you can review and land; a week of runs
piled onto one branch is a branch nobody can merge. A routine that ASKS the
same question every day (a trend check, a digest, "what changed since
yesterday?") is worthless from zero each morning — give it
`--persistent-session`. Its standing task is folded behind the sidebar's
`N routine sessions` row, raises an Inbox entry when a turn finishes, and
never wins the cold-start "which task to open" fallback. If the engine process
is gone when the next firing arrives (an overnight gap usually means it is),
the daemon respawns it in the SAME worktree — files and branch carry over, the
conversation does not — and records that run as `revived`, not `dispatched`.

A bare `--enabled` means true, so pausing a routine is
`routine-set-enabled --id <id> --enabled=false` (the same `=false` spelling
`pin --pinned=false` uses).

`routine-update --schedule` re-anchors the next run. `--precheck ''` clears it.
`routine-run-now` skips the precheck deliberately (asking for it IS the answer)
and does not shift the schedule. `routine-delete` leaves already-created tasks
alone.

Run statuses from `routine-runs`: `dispatched`, `revived` (standing session
respawned — files kept, conversation did not), `deferred` (composer busy; the
prompt is queued in the Inbox, NOT lost), `skipped_precheck` (nothing to do),
`skipped_missed`, `skipped_unavailable`, `dispatch_failed`.

## discover / feedback

<!-- generated:begin discover,feedback -->
```text
schema       --verb --group --all
engine-list  (none)
feedback     --title(REQ) --body(REQ) --category(feedback)
```
<!-- generated:end -->

Bare `schema` is the compact index; `--verb <name>` drills into one verb,
`--group <g>` lists one group, `--all` dumps everything. `engine-list` is the
ids + RAW launch command + protocol.

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
| `DIRTY_WORKTREE` | `delete` on a worktree with uncommitted files | send the worker back to commit, or `delete --force` to discard |
| `DEFERRED_PROMPT_PENDING` | that tab already holds a deferred prompt | `deferred-release --id` (or `deferred-dismiss --id`), then re-send |
| `DEFERRED_PROMPT_NOT_FOUND` | released, dismissed, or swept already | `rove api deferred-list` |
| `ISSUE_NOT_FOUND` | no issue with that number in this repo | `rove api issue-list --repo <path>` |
| `NO_ENGINE_TAB` | live tabs exist, none is an engine | `--tab tab-N` from `pty-list`, or `--tab new` |
| `TAB_NOT_FOUND` | `--tab` names a closed/unknown tab | `get-task` for the live `.tabs[]` |
| `DISPATCHER_UNREACHABLE` | bare `send` reply, dispatcher gone | nothing alive to reply to — never silently spawns |
| `EMPTY_SUCCESS_REPORT` | `succeeded:` from a branch with 0 commits | commit first, or say so with `--allow-empty` |
| `SOURCE_CHANGED` | `read-output` cursor's target moved | re-read without the cursor |
| `EMPTY_BRANCH` | `land` on zero commits ahead | the worker committed nothing |

Daemon-side refusals carry their OWN code (`DIRTY_WORKTREE`, `LAND_CONFLICT`,
`MISSING_REF`, `GIT_COMMAND_FAILED`, …), not `RPC_ERROR`. Match on `code`; the
`message` is prose for a human and does not repeat the code.
