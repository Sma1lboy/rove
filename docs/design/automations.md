# Routines — scheduled agent tasks

> Called Routines in the UI and CLI. The code, RPC names and on-disk file
> still say `automation` — renaming those buys nothing and would need a
> migration of `~/.rove/automations.json`.

> Daemon-owned cron. A schedule + a prompt + a repo; every firing creates a
> fresh task and starts its engine with that prompt — or, with
> `persistentSession`, re-delivers into one standing task.

## What it is

```text
Automation = cron rule + prompt + repo
Firing     = a new Task (worktree + branch + engine session)
           | a delivery into the ONE standing Task (persistentSession)
```

The unit of work is an ordinary Rove task, not a hidden background job. A run
that fired at 09:00 is a task in the sidebar you can open, read, and keep
talking to. That is the whole point of modelling it this way: scheduled work
that produces something you cannot inspect is not worth scheduling.

Typical use: *"every weekday at 09:00, audit the dependencies of this repo and
summarize risky changes."*

## Data model

Two records, both in `<ROVE_HOME>/.rove/automations.json` (daemon is the only
writer). Types in [`contracts.ts`](../../packages/kobe-daemon/src/daemon/contracts.ts).

- **`Automation`** — the rule. `schedule` (five-field cron), `prompt`, `repo`,
  optional `vendor` / `baseRef` / `precheck`, `enabled`, `nextRunAt`,
  `missedRunGraceMinutes`, and the standing-session pair `persistentSession` /
  `sessionTaskId` (issue #91). Types in
  [`automation-contracts.ts`](../../packages/kobe-daemon/src/daemon/automation-contracts.ts).
- **`AutomationRun`** — one firing. `scheduledFor` (when it *should* have run),
  `status`, `trigger`, and the `taskId` it produced. Capped at 100 per
  automation.

### Run statuses

| Status | Meaning |
|---|---|
| `dispatched` | Task created (or delivered into the standing session), engine started with the prompt |
| `revived` | Standing session whose engine had died, respawned in the same worktree — files kept, transcript not |
| `deferred` | Standing session's composer was busy; the daemon owns the prompt and queued an Inbox episode |
| `skipped_precheck` | The precheck said there was nothing to do — **healthy** |
| `skipped_missed` | The occurrence was older than the grace window |
| `skipped_unavailable` | The repo/worktree could not be resolved |
| `dispatch_failed` | Task created but its engine did not start |

The "didn't run" reasons are deliberately distinct. Unattended automation
is only trustworthy if a glance tells you whether a human is needed;
`skipped_precheck` and `dispatch_failed` are opposite signals and must not
share a label.

## Standing sessions (issue #91)

`persistentSession` swaps "a task per firing" for one task the schedule keeps
delivering into. It exists because an inspection routine (*is CI worse than last
week?*) is worthless without the previous answer in the same transcript, while a
routine that EDITS code needs the opposite — a fresh branch per run, since a
week of runs on one branch is a branch nobody can land. Hence per-routine, and
off by default.

The four paths one firing can take live in
[`automation-dispatch.ts`](../../packages/kobe-daemon/src/daemon/automation-dispatch.ts):

```text
fire → persistentSession?
       ├─ no  → createTask + startTaskSessionWithPrompt        → dispatched
       └─ yes → sessionTaskId resolves to a live, undeleted task?
                ├─ no  → createTask (marked routine) + spawn,
                │        relink sessionTaskId                   → dispatched
                └─ yes → deliverPromptToLiveEngineDetailed
                         ├─ delivered → dispatched
                         ├─ busy      → defer + Inbox episode   → deferred
                         └─ no-session→ respawn same worktree   → revived
```

**What continuity actually rests on.** The engine's own conversation, kept alive
by the PTY host — which lives outside the daemon on purpose
([`pty-server.ts`](../../packages/kobe-daemon/src/daemon/pty-server.ts)), so it
survives `rove daemon restart`. When that process is gone, the respawn does NOT
inherit the transcript: the daemon's spawn path (`buildEngineSessionLaunch`) has
no resume verb wired into it — `engineResumeArgv` is the TUI's tab-restart path.
Hence `revived` as its own status: a run that started over must not read like
one that had context.

**Why a busy composer cannot be dropped.** `quota-resume` drops a blocked prompt
deliberately — it is a nudge, and the next rate-limit arms another. A routine's
report has no second chance, and a dropped one is indistinguishable from a
routine that never ran. So it files a deferral and an Inbox episode, the same
accepted-but-deferred contract `rove api send` gives agents, and the run records
`deferred` (a success). Because `ComposerBusyError` lives in the `rove` package,
which depends on this one, the outcome crosses the runtime adapter as DATA
(`deliverPromptToLiveEngineDetailed`) rather than as a catchable error type.

**Self-healing.** A `sessionTaskId` whose task was deleted, is mid-deletion, or
lost its worktree resolves to null, and the firing rebuilds and relinks. Without
that, one deleted task would wedge the routine forever — and a wedged schedule
looks exactly like a quiet one.

**In the sidebar.** A standing task carries `Task.routine`, which folds it behind
a per-project `N routine sessions` count row
([`tree-core.ts`](../../packages/kobe/src/tui/panes/sidebar/tree-core.ts)). This
is the one fold in a tree that otherwise has none (owner call 2026-08-01, round
5), scoped so the rule it bends still holds: it hides only what a SCHEDULE
created, never a task a human opened. A folded task stays findable by `/` (the
search builds the tree fully expanded), openable from the Routines page, and
reachable from the Inbox — hiding a ROW, not a task.

## Scheduling

`nextRunAt` is an **absolute timestamp on disk**, never an in-memory timer.
That single decision answers the restart question: a daemon that restarts (or
was down for a day) re-discovers every armed schedule on its first sweep, with
no re-arm pass. Same shape as `Task.quotaResume` and `TaskDeletionState`.

The sweep ([`automation-runner.ts`](../../packages/kobe-daemon/src/daemon/automation-runner.ts))
runs every 60s, and like the quota-resume runner it is **not** gated on
`hasSubscribers` — a schedule that requires an audience is not a schedule.

Cron parsing is hand-rolled ([`cron.ts`](../../packages/kobe-daemon/src/daemon/cron.ts)),
pure JS, no dependency: the repo has no scheduling deps and `bun build --compile`
bans native addons. Two functions, and the second is the interesting one:

- `nextCronAfter(expr, after)` — advance past a firing (strictly after, or the
  sweep would re-fire what it just ran)
- `latestCronAtOrBefore(expr, now, notBefore)` — *what should have run by now*,
  which is the question missed-run compensation actually asks

Day matching follows the Vixie rule: with BOTH day-of-month and weekday
restricted they are OR'd (`0 0 1 * MON` = the 1st **or** any Monday).

### Missed runs

Daemon down at 09:00, back at 09:20, grace 60m → the occurrence runs late.
Back at 14:00 → `skipped_missed`.

Only the **most recent** missed occurrence is ever considered. Three days
offline produces one run, not three — a stampede at boot is worse than a gap.

## Precheck

```bash
--precheck "git log --since=24.hours --oneline | grep -q ."
```

Runs in the repo through the login shell before the engine starts. Exit 0
proceeds; anything else — non-zero, timeout, spawn failure — skips **without
creating a task**.

This is the cost control. The dominant waste in scheduled agent work is firing
on time when nothing changed: the engine still boots, reads the repo, and burns
a turn to conclude "nothing to do". A shell command answers that for free.

Failing closed is deliberate. A broken precheck must not silently degrade into
"run every time", which is exactly the cost it exists to avoid. `automation-run-now`
skips the precheck entirely — asking for it by hand IS the answer.

## Daemon lifetime

Rove's daemon normally self-stops 3s after the last GUI detaches. **An enabled
automation holds it open** (`DaemonLifetime.keepAlive`), because a schedule that
only fires while someone is watching Rove is not a schedule.

The hold is opt-in by construction — the user created the automation — and
releases when the last one is deleted or disabled, restoring ordinary idle
shutdown. `daemon.status` reports `automationHold` so a daemon staying up for a
schedule does not read as a leak.

Releasing needs an explicit nudge: arming is otherwise driven only by GUI
disconnects, so deleting the last automation after the GUI already left would
leave nothing to notice. Every automation mutation calls
`lifetime.reevaluateIdle()`.

## TUI

`ctrl+a` `2` (or clicking the sidebar rail) points the content pane at the
Routines page. It is the triage half of the feature:
what is scheduled, when each fires next, and what the last runs did. The header
says whether an enabled automation is currently holding the daemon open.

`j`/`k` move, `n` creates one, `e` pauses/resumes, `s` runs one now (skipping
its precheck), `d` deletes, `enter` opens the task from the most recent run,
`r` refreshes.

`n` runs four single-field prompts in sequence (name → repo → prompt →
schedule) rather than one multi-field form: the rename dialog already does a
labelled field with validation, and four strings did not justify a new widget.
Cancelling any step aborts. A precheck is CLI-only — it is the one field that
is genuinely optional.

## CLI

```bash
rove api routine-create --repo . --name "weekday audit" \
  --prompt "Audit dependencies and summarize risky changes." \
  --schedule "0 9 * * MON-FRI" \
  --precheck "gh pr list --json number -q '.[0].number'"

rove api routine-list
rove api routine-runs --id <id>
rove api routine-run-now --id <id>
rove api routine-set-enabled --id <id> --enabled false
rove api routine-delete --id <id>
```

Full flag list: `rove api schema --group automation`.

## Prompt delivery

The prompt rides the engine's **own argv** via
`buildEngineSessionLaunch`'s `promptIntent: {kind: "explicit"}` — it is part of
the spawn, not a paste that follows it. A cold engine TUI can swallow a raced
paste, and an unattended run has nobody watching to retype it.

## Not implemented

- Reusing an existing task instead of creating one per run
- Timezones (the daemon host's local time)
- Cost attribution per run, remote/SSH execution targets
