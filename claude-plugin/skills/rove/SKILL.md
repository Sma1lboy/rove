---
name: rove
description: Use when controlling Rove tasks, parallel coding attempts, hosted agent sessions, task lifecycle, or the daemon-owned issue tracker from a shell. Also the ONLY channel for messaging another agent session on this machine — `rove api send`, never a peer/MCP side channel.
---

<!-- rove-skill-version: 36 — bump in lockstep with KOBE_SKILL_VERSION (src/lib/skill-install.ts). -->

# Rove shell control

Use `rove api` to manage local coding tasks. Managed Tasks created by API
automation own a git Worktree and branch plus Hosted PTY engine tabs; project
main and directory Tasks reuse existing directories. API automation works
without an open TUI; prompted `send` and `add` ensure a target engine tab.

## Inside a Rove session, Rove verbs come first

Check where you are before choosing how to delegate or parallelize:

```bash
test -n "${ROVE_TASK_ID:-}"
```

When that passes, you are an engine session Rove manages — `$ROVE_TASK_ID`
is your task, `$ROVE_TAB_ID` your tab. Coordination should then go through
Rove, not around it, because work routed through `rove api` gets what
ad-hoc subprocesses never do: its own Worktree and branch (no file
collisions with you), a sidebar row with live state the user can watch,
lifecycle tracking, and an explicit outcome contract.

- Parallel attempts of one prompt → `add --count N`, not N hand-rolled subagents.
- Delegating a scoped piece of work → `add --prompt`, not a raw `claude -p`
  child the user cannot see or manage.
- Following up on a task you started → `send`; comparing → `collect`;
  finished your own task and were spawned by another → a bare `send`
  (no `--task-id`) replies to the DISPATCHER — the exact task + tab that
  created you, recorded at creation (`.task.dispatcher` on `get-task`).
  If that tab died it falls back to the dispatcher task's live canonical
  engine tab; nothing alive fails loud (`DISPATCHER_UNREACHABLE`) — it
  never spawns a new engine, so a failed reply is visible, not fake-ok.
- Messaging another agent session on this machine → `send`, and ONLY `send`
  — never relay through the user, a side file, or a generic peer channel
  (an MCP server offering to message "other instances" is exactly that
  channel: it reaches a process, not a task, so nothing it delivers is
  attributable, watchable, or replyable). Sent from
  inside a Rove task, the prompt arrives prefixed `[ROVE PEER] from
  "<title>" (task <id> — load the Rove agent skill FIRST …)`, so the
  receiver knows who is talking, that this skill is required reading, and
  how to answer — the baked-in reply command is tab-precise
  (`--task-id <sender> --tab <sender's tab>`), so peer conversations need
  no coordinator and no human relay. That prefix is the contract: do not
  strip it with `--plain` for
  coordination messages (`--plain` is only for a verbatim paste the
  receiver should treat as content, not conversation). Received a
  `[ROVE PEER]` message yourself? Load this skill first — required, not
  optional — then reply with the baked-in command, not by asking the user.
- `send` carries text, but that text can carry FILES: peers share a
  filesystem, so put the absolute path of a screenshot, log, diff, or any
  artifact in the prompt and the receiver opens it with its own Read tool —
  images included. An annotated screenshot beats a paragraph describing one;
  prefer "see /path/to/shot.png — the arrow marks the broken card" over
  re-narrating pixels. Paths under the sender's Worktree work too (worktrees
  are world-readable locally); just never expect the receiver to WRITE
  there.
- `dispatch` stays the dispatcher's verb (deliver-only into an
  already-hosted session; never impersonate the user in someone else's
  terminal).

Your own engine's in-context subagents remain fine for read-only
research/exploration inside your task — the boundary is WORK: anything that
edits files, runs long, or the user should be able to see and steer belongs
in a Rove task. Do not recursively fan out from a spawned task.

When the check fails, none of this applies — use `rove api` only if the
user asks for Rove by name.

## Vocabulary — what the user's words map to

| Term | What it is | Isolation it gives | Users also say |
|---|---|---|---|
| **Task** | one tracked workspace record — managed worktree, saved-project main, or existing directory | managed Tasks own files + branch; main/directory Tasks reuse files | "a task", "a new one", "a separate attempt" |
| **Worktree** | the isolated git working tree a managed Task owns (`.task.worktreePath`) | — | "workspace", "this checkout", "this branch", "here" |
| **Terminal Tab** | one engine, shell, command, or content surface inside a Task | an engine tab has its own conversation, but every tab uses the SAME Task files | "tab", "chattab", "another chat", "a second agent on this" |
| **Split** | the tree that divides ONE Terminal Tab into several regions (the `pane-open` verb's unit; a leaf is not called a pane) | none — same session's screen, same files | "split it", "side by side", "put the logs next to it" |

Two of those colloquialisms are traps, so read them as INTENT, not as
product terms: in Rove's own vocabulary **Workspace** is the center Terminal
Tab region of the UI (CONTEXT.md), not a checkout, and **ChatTab** is
retired vocabulary for Terminal Tab. A user saying "in this workspace" means
the worktree they are looking at — answer the intent, keep writing the real
term.

They nest — **Task ⊃ Terminal Tab ⊃ Split** — and isolation drops at every
level down:

```text
new Task   → own worktree + own branch     (parallel work can't collide)
new Tab    → own engine session, SAME files (a helper in the same checkout)
new Split  → same session's screen, one tab divided (a monitor beside the work)
```

The distinction that decides every routing call: **a new tab shares the
worktree and branch; only a new task gets its own.** Two tabs in one task
edit the same files, so they can collide — that is a feature when the user
wants a helper in the same checkout, and a bug when they wanted parallel
attempts. A split isolates nothing at all: it is a layout, for watching
something (logs, `btop`, a test loop) next to the work — never the answer to
"do this work".

### Where does this work land?

Inside a Rove session (`$ROVE_TASK_ID` non-empty — check first: it is what
makes the tab/split rows addressable at all), match top to bottom and take
the first row that fits:

| The user says | Lands in | Command |
|---|---|---|
| "you do it", "just fix it", "change X to Y" | you, right here | no Rove verb — edit the files yourself |
| "try it N ways", "compare approaches" | N new tasks | `rove api add --repo "$PWD" --count N --prompt "…"` |
| "split", "side by side", "keep an eye on X while…" | a new region in the CURRENT tab | `rove api pane-open --command "…"` |
| names a tab: "tell the agent in tab 3" | that exact tab | `rove api send --task-id <id> --tab tab-3 --prompt "…"` |
| a LOCATION word: "in this workspace/worktree/checkout", "on this branch", "here", "same task" | THIS task, a NEW Terminal Tab | `rove api send --task-id "$ROVE_TASK_ID" --tab new --prompt "…"` |
| names an ENGINE for the same files: "let codex take over here", "try this one with claude instead" | THIS task, a new tab pinned to that engine | `rove api send --task-id "$ROVE_TASK_ID" --tab new --command codex --prompt "…"` |
| **anything else — no row above matched** | a NEW task — new worktree + branch | `rove api add --repo "$PWD" --prompt "…"` |

Order is the tiebreak: a count ("3 ways in this workspace") beats a location
word, and delegation language loses to "you do it" — the user asking YOU is
not asking for a fleet. Two more rules the table can't show:

- No location word at all ⇒ new task. It is the only routing whose isolation
  cannot corrupt work-in-progress, so it is the safe default.
- "this repo" / "this project" are NOT location words — they name the repo,
  not the checkout. Only worktree-scoped words route to a tab.

Outside a Rove session none of this applies: there is no "this task" to add
a tab to, so `add` (single or `--count`) is the only routing available.

### Know where you are before you route

```bash
echo "$ROVE_TASK_ID / $ROVE_TAB_ID"          # who you are (empty = not a Rove session)
rove api get-task --task-id "$ROVE_TASK_ID"  # .task.worktreePath, .task.branch, .running, .tabs[]
```

`get-task` is the per-task read that answers "what is my worktree, my
branch, and which sibling tabs exist" — `.tabs[]` carries each tab's `id`, `kind`,
`vendor`, `lastTitle` and `alive`, which is exactly the target list for
`send --tab`. A tab flagged `unregistered: true` is a live session the tab
snapshot lost; it is addressable like any other.

## Found a defect in ANOTHER project? File a request, don't work around

The repos on this machine are deliberately interdependent — one project
using (and stumbling over) another is the normal case, not the edge case.
Each saved project can keep a **main task**: a long-lived resident agent on
that repo's own checkout. It is more than "task kind = existing directory" —
it is that project's standing inbox, addressable from any other repo's
session, and it dispatches what it receives.

So when work in repo A surfaces a defect in product B, the default is to
**file a request with B's main task — not to quietly patch around it in A**.
The test: would this bite someone else? A local workaround fixes only you;
a fix in B fixes everyone. Work around locally to unblock yourself if you
must, but file the report either way.

```bash
rove api list                                   # find B's main task id
rove api get-task --task-id <their-main>        # .tabs[] → the engine tab's id
rove api send --task-id <their-main> --tab tab-N --prompt "<report>"
```

Address the engine tab explicitly (`--tab tab-N` from `get-task`'s `.tabs[]`,
`kind == "engine"`): a long-lived main task's engine tab is often not
`tab-1`, and an un-addressed `send` may refuse with `NO_ENGINE_TAB` rather
than guess.

A report worth sending carries: **symptoms** (what happened, concretely, how
many times), **root cause** if you found it, **why it is worth fixing**
(who else it bites), and **suggestions without prescribing the
implementation** — the receiving project decides how to fix its own product.

**Send the report — never `add` a task into someone else's repo.** You hold
the problem-side context (symptoms, root cause, impact); only that project's
main agent holds the solution-side context (code structure, existing issues,
what's mid-flight, where this slots in the schedule). A task you compose
would bake YOUR guess at the fix into the brief, and that guess is usually
wrong — one field report here looked like "add a line to the docs" and
actually split into a docs fix plus a runtime-detection issue anchored in
files the reporter didn't know existed. **You raise the problem; their main
agent decomposes it into tasks.** That translation is the main task's whole
job, and it is why every project should keep one.

## Fresh worktrees start empty — install before you judge

A managed task's worktree is a **brand-new checkout**: no `node_modules`, no
build artifacts, nothing a lockfile promises. Two consequences:

- **A test failure in a fresh worktree may be fake.** Missing dependencies
  masquerade as product bugs ("Could not resolve: react-dom/client" reads
  like a regression, not a missing install). Before reporting any failure as
  real, confirm the repo's install step ran — and when a failure looks
  unrelated to your change, compare against the same command on the base
  branch before believing it.
- **Repos with an install step should ship `.rove/init.sh`** — it runs once
  per worktree, before the engine, in the worktree (per-user override:
  `rove repo set --init-script`; inspect with `rove repo show`, which lists
  `.rove/init.sh: absent` when unset). Working in a repo that lacks one and
  you just paid the install tax? Suggest adding it.

## Discover before calling

Do not guess flags — but do not pay a round-trip for the ones you use every
turn either. These five carry almost all traffic:

```text
add      --repo(REQ) --prompt --title --command --count --agents --activate
send     --prompt(REQ) --task-id --tab --command --plain
get-task --task-id(REQ)          list  (no flags)
collect  --group <groupId> | --task-ids <csv> | --repo
```

Four names that have actually been guessed wrong here: `add --vendor` is
`--command`; `read-output --task` is `--task-id`; `dispatch --text` is
`--prompt` (`--text` belongs to `note`); `issue-list` has no `--state` at all
— filter its JSON yourself.

**[`references/api-flags.md`](references/api-flags.md) is every verb and flag**,
including the groups this file leaves out on purpose: `routine-*` (scheduled
prompts), `workitem-*` (GitHub issues via `gh`), `note`/`note-list` (the repo's
durable field-note store), `read-output`/`digest`/`agent-turns`/`pty-list`, and
the error-code table. Read it when you need a verb that is not above; reach for
`schema` when the binary and that file disagree.

```bash
rove api schema --verb add    # or --group create, --all
rove api <verb> --help
rove api engine-list          # what you can launch, and with what command
```

Commands emit one JSON object; errors use
`{"error":{"message","code",...}}` on stderr. Common rejections also carry
`hint` (what to do) and `nextCommandArgs` (argv for the same `Rove`
executable — run `rove <args...>` verbatim to recover, e.g. `["api","list"]`
after `TASK_NOT_FOUND`). Add `--pretty` for readable output.

## Common operations

```bash
# Create one task and start its first engine turn.
rove api add --repo "$PWD" --title "focused title" --command claude \
  --prompt "<complete scoped instruction>"

# Parallel attempts of the same prompt (hard cap 10; prefer 3-4).
rove api add --repo "$PWD" --count 3 --prompt "<prompt>"
rove api add --repo "$PWD" --agents claude:2,codex:1 --prompt "<prompt>"

# Follow up. Use an explicit id for unattended work; the active task can drift.
# From inside a Rove task this auto-prefixes [ROVE PEER] provenance
# (sender + reply command); --plain sends verbatim.
#
# SINGLE-QUOTE a prompt containing backticks, or your shell runs them as
# command substitution and the words vanish from the message you send. In
# double quotes `rove api send` becomes the OUTPUT of running that command.
rove api send --task-id <id> --prompt "<complete next turn>"

# Reply home: no --task-id inside a dispatched task = the dispatcher's tab.
rove api send --prompt "succeeded: <one line> (branch <final branch>)"

# A task can hold several Terminal Tabs. `get-task` lists ONE task's tabs (the
# usual read before addressing one); `inspect` is the wider diagnostic — every
# task's snapshot plus daemon activity and live pty sessions.
rove api inspect --task-id <id>
rove api send --task-id <id> --tab tab-3 --prompt "<turn>"  # exact alive tab
rove api send --task-id <id> --tab new --prompt "<turn>"    # fresh engine tab
# Same worktree, DIFFERENT agent — the API twin of the TUI's ctrl+e pick. The
# engine is pinned to that tab (survives restarts, unaffected by a later
# set-command) and the task's own engine is left alone. --tab new only.
rove api send --task-id <id> --tab new --command codex --prompt "<turn>"

rove api get-task --task-id <id>
# One read for the whole round — the groupId `add --count` returned. Never
# hand-copy N task ids across turns: collect by group. Lost the groupId? Any
# sibling task's `.groupId` in `list` output recovers it.
rove api collect --group <groupId> --pretty
rove api list --pretty
```

`.running` means any hosted engine tab on the task is alive; a live shell,
command, or content tab alone does not count.
Omitting BOTH `--task-id` and `--tab` inside a task that has a dispatcher
targets that dispatcher's tab (see the reply rule above); otherwise the
target is the active task. Omitting only `--tab` targets a live engine tab
(`tab-1` first, then any surviving engine tab). **Trap: omitting only
`--task-id` while giving `--tab tab-N` inside a dispatched task delivers to
`tab-N` of the DISPATCHER's task** — the dispatcher's id fills in for
`--task-id`, but an explicit `--tab` is kept, so your `send --tab tab-3`
lands in the middle of another session's tab-3, not yours. Target your own
task's tab with `--task-id "$ROVE_TASK_ID" --tab tab-N`. Only when the task
has NO live session at all does `send`
auto-start the canonical engine in the task's worktree (`started: true` in
the result marks that fresh session). If live tabs exist but none resolves
as an engine, it refuses with `NO_ENGINE_TAB` — address one with `--tab
tab-N` or spawn one with `--tab new`; it never silently spawns a duplicate
engine. Its `hint` names `pty-list` — the live-PTY read (key, alive, pid,
command); use it when `.tabs[]` and reality disagree.

## Terminal panes

Split the workspace terminal the user is watching (tmux-style) or open a
separate command tab — the attached TUI performs it, so this is a no-op
headless:

```bash
# Split the focused tab; the pane runs the command via `sh -lc` and
# closes when it exits. Omit --command for an interactive shell.
rove api pane-open --command "btop"
rove api pane-open --direction down --command "watch -n1 git status -sb"
rove api pane-open --placement tab --title logs --command "tail -f app.log"

# Close panes you opened, by their --title (engine panes are never closed).
rove api pane-close --title logs

# Toast a one-liner in every attached Rove UI — surface "done / needs input /
# error" moments without touching any session (kinds get severity styling).
rove api notify --title "build green, artifacts in dist/" --kind done
```

Defaults: the caller's own task (`$ROVE_TASK_ID`, then the active task),
`--placement split`, `--direction right`. Alternate right/down to build a
grid; screen size bounds splitting — a split that would shrink any pane
below the minimum usable size (20×6 cells) falls back to a tab.
Panes land in the USER'S live workspace — open them when asked (monitors,
logs, dashboards), don't scatter panes for work `add` should own.

## Lifecycle

| Verb | Purpose |
|---|---|
| `rename --task-id ID --title T` | Rename a task |
| `set-branch --task-id ID --branch B` | Rename its branch |
| `set-command --task-id ID --command CMD` | Change the engine launch command for the next launch |
| `set-status --task-id ID --status S` | Set lifecycle status |
| `pin --task-id ID [--pinned=false]` | Pin/unpin |
| `set-active --task-id ID` / `--none` | Change shared active task |
| `ensure-worktree --task-id ID` | Materialize without starting an engine |
| `land --task-id ID [--strategy merge\|squash] [--delete-branch] [--remove-worktree=false]` | Merge the task's branch into the base repo's current branch; the Worktree is removed by default (`--remove-worktree=false` keeps it). The branch always stays; dirty/self/base removals are refused, outcome in the result's `worktree` field |
| `delete --task-id ID [--force] [--delete-branch]` | Remove task + Worktree; the git branch stays unless `--delete-branch` (and `--force` never implies it) |
| `discover-adoptable --repo PATH` | Find untracked Worktrees |
| `adopt --repo PATH --worktree PATH` | Import a Worktree |

Once a task's work is merged, `delete` is the normal cleanup — the branch is
git's durable record and survives. There is no "hide the row without
deleting" verb anymore (`archive` was removed); a merged task you want out of
the way is a `delete`, and its branch is still there if you need the history
back. `--delete-branch` (or a dirty-worktree `--force`) still needs
explicit user authorization.

## Issue tracker

Issues are daemon-owned, not repo files:

```bash
rove api issue-list --repo "$PWD" --pretty
rove api issue-create --repo "$PWD" --title "title" --body "context"
rove api issue-set-status --repo "$PWD" --id <n> --status done
rove api issue-update --repo "$PWD" --id <n> --title "new" --body "body"
rove api issue-update --repo "$PWD" --id <n> --task <taskId>   # link; `--task none` unlinks
```

### Kanban semantics

The TUI and web render issues as a Backlog / In progress / Done board whose
columns derive from the issue's own lifecycle — do NOT move cards with
`issue-set-status doing`:

- **In progress** = the issue has a linked task; `issue-update --task <taskId>`
  IS the move (typical flow: `issue-create` → `add` a task → link them).
- **Done** = `status done`; the daemon mirrors it automatically when the
  linked task finishes.
- **Backlog** = everything else (`open`/`doing`/`hold`, unlinked).

## Choosing the engine (`--command`)

Rove picks an engine by COMMAND, not by a vendor name. `--command` on `add`
and `send --tab new` takes either an engine id from `rove api engine-list`
(`claude`, `codex`, …, plus any preset the user registered) or a full command
line Rove runs verbatim:

```bash
rove api engine-list --pretty                      # ids + the RAW command each runs
rove api add --repo "$PWD" --command "codex --search" --prompt "…"
```

**Nothing validates an engine's flags — that is your job.** Before dispatching
an unfamiliar engine or an unfamiliar flag, probe it yourself (`<cmd> --help`,
`<cmd> --version`) and only then compose the command. A bad command line
starts a session that dies or ignores you; Rove will not catch it for you.

**Model is a conscious either/or — default to WITHOUT.** Your own model
knowledge is training-data stale; the user's engine default is fresher than
your guess, and model ids you have never heard of are routinely valid.

- **Without a model (the default):** compose the command with no model flag —
  the session runs on the user's own default for that engine. Choose this
  whenever the user did not name a model this turn.
- **With a model (explicit request only):** the user named a model → pin it,
  passing their string VERBATIM (`--help` first to confirm the flag exists;
  never "correct" an unfamiliar model id to one you know).

```bash
rove api add --repo "$PWD" --command claude --prompt "…"                    # user's default model
rove api add --repo "$PWD" --command "claude --model claude-fable-5" \
  --prompt "…"                                     # user said "use Fable 5" this turn
```

Omit `--command` to use the repo's default engine. `engine-list`'s `protocol`
field says how much Rove understands about an entry — `generic` means it
launches fine but Rove reads no history and pre-answers no trust dialog.

## Parallel-round rules

Spawn a parallel round (`add --count N` / `--agents`) only when the user
requests parallel approaches, comparison, or an explicit count.
Give each round a scoped prompt, report returned IDs, then use
`collect` to compare. Do not recursively fan out from spawned tasks. Do not
poll `send` in a tight loop or use it as casual chat; every call is a full
engine turn.

### Completion flows back through an engine tab (`send`)

Outcomes are explicit, never inferred — and they travel as a MESSAGE to the
spawning agent's engine tab, not as stored state nobody reads.

**Worker side** — a task created from inside another Rove task records its
dispatcher (the creating task + tab); when the work is finished, a bare
`rove api send --prompt "<succeeded|failed>: <one line> (branch <final
branch>)"` routes the outcome back to that exact tab. Include the final
branch name — the spawner needs it to `land`. Use the BARE form: an explicit
`--task-id <spawner>` skips dispatcher routing and lands on that task's
canonical engine tab, which can be a different agent's session.

**Name your branch before you report it.** A new task starts on an
auto-generated placeholder branch (`new-task`, `duck`, …); you are the only
party who knows what the work turned out to be. Once the shape is clear,
rename it to a short descriptive name in this repo's own convention:

```bash
rove api set-branch --task-id "$ROVE_TASK_ID" --branch <descriptive-slug>
```

Do this while you work, not at the end — the branch name is what the user
reads in the sidebar to tell your task from its siblings.

**"Succeeded" means COMMITTED.** Green tests in your working tree are not a
deliverable — the only thing `land` can merge is commits on your branch.
Before reporting success: `git status` clean, your work committed with a
real message (you wrote the code; you write its message). A worker that ran
everything, passed everything, and committed nothing has delivered nothing —
that exact mismatch has shipped empty merges before.

**Coordinator side** — do NOT block or poll. Keep working (or end your
turn); each worker's outcome arrives in your chat as a `[ROVE PEER]` message
with its task id. What arrives is the worker's claim, not Rove-verified —
verify the winner's actual diff before landing. Silence never proves a
worker died (it may be mid-turn or stuck on a permission prompt): peek with
`collect`/`get-task`, nudge with `send`, and never mark a silent task failed
or auto-retry it.

### Closing a round

After comparing attempts, finish the round instead of leaving tasks behind:

```bash
# Land the winner: merge its branch into the base repo's CURRENT branch.
# Verify the base checkout is on the intended branch first.
rove api land --task-id <winner>

# Delete the losers: task + worktree go away, the git branch survives
# (recoverable). NOT --delete-branch — that destroys history and needs
# explicit user authorization.
rove api delete --task-id <loser1>
rove api delete --task-id <loser2>
```

`land` refuses a dirty base checkout; on merge conflict it aborts cleanly and
returns the conflicted files for manual resolution. `delete` removes a
loser's Worktree but keeps its branch (recoverable); `--delete-branch`
destroys the history and is never part of closing a round without explicit
user authorization.
