# Routines

Work that runs without you. A **Routine** is a cron rule + a prompt + a repo,
owned by the daemon. By default every firing creates a fresh [task](CONCEPTS.md)
with its own worktree, its own branch, and its own engine session, carrying the
prompt as that session's first message. A routine that needs to remember what it
said yesterday can instead keep [one standing session](#one-standing-session-instead-of-a-task-per-run).

That last part is the design, not an implementation detail. A run is not a
hidden background job with a log file somewhere; it is an ordinary task in your
sidebar that you can open, read, disagree with, and keep talking to. Scheduled
work you cannot inspect afterwards is not worth scheduling.

![The Routines page: three scheduled prompts with their repo, cron expression and next run, and the selected routine's prompt, precheck and run history in the detail box below](assets/routines.png)

## Two minutes to your first routine

The example throughout this page is the one in the screenshot: *every morning at
03:00, audit this repo's dependencies and open a branch with the safe upgrades.*

### From the TUI

1. `ctrl+a` `2` (or click **Routines** in the sidebar rail) opens the page.
2. `n` opens the composer. `tab` / `shift+tab` walk the fields: **name**,
   **repo** (a scrolling picker over your projects), **prompt**, and
   **schedule**, five labelled cells (min / hour / day / month / weekday)
   where `←`/`→` picks a cell and `↑`/`↓` changes it. The composer restates
   the next fire time in your own clock as you type ("weekdays at 12:00 · in
   2d · Mon 12:00"), so a cron expression you got wrong is visible before you
   save it.
3. `s` runs it once, right now. **Do this.** It is how you find out the prompt
   works without waiting a day for the schedule, and it does not shift the next
   scheduled run.
4. `enter` opens the task that run created. From here it is a normal session.

![The New routine composer: name, repo picker and prompt above five labelled cron cells, with the hour cell selected and the schedule restated underneath as "weekdays at 12:00 · in 2d · Mon 12:00"](assets/routines-composer.png)

There is no in-page editing: recreate the routine, or use `rove api
routine-update`. A precheck (below) is CLI-only; it is the one field that is
genuinely optional.

The page end to end: walking the schedules, pausing one, then composing a
routine whose next fire time is restated in plain words as the cron cells
change:

![Walking the routines, pausing one, and composing a new one as the cron preview follows each cell](assets/routines.gif)

<video controls playsInline preload="metadata" poster="assets/routines.png" style={{ width: "100%" }}>
  <source src="assets/routines.mp4" type="video/mp4" />
  Your browser cannot play this video. [Download the full-quality MP4](assets/routines.mp4).
</video>

### From the CLI

The same routine, with the precheck the TUI cannot set:

```bash
rove api routine-create --repo . \
  --name "Nightly dependency audit" \
  --prompt "Audit dependencies for advisories and open a branch with the safe upgrades." \
  --schedule "0 3 * * *" \
  --precheck "git log --since=24.hours --oneline | grep -q ."

rove api routine-list                       # every routine + its next run
rove api routine-run-now --id <id>          # fire it now, skipping the precheck
rove api routine-runs --id <id>             # run history, newest first
```

Full flag list: `rove api schema --group routine`, or [rove api](API.md).

## Reading the page

| Where | What it tells you |
|---|---|
| Header, right | Whether an enabled routine is **keeping the daemon awake** right now |
| Row | Name, repo, five-field schedule, and the next run in relative time (`in 5h`), or `paused` |
| Detail box | The selected routine's prompt, its precheck if any, and **RECENT RUNS** with their outcomes |
| `[ run now ]` | The same thing `s` does; try it without waiting for the schedule |

Keys: `j`/`k` move, `n` creates, `e` pauses or resumes, `s` runs now, `d`
deletes, `r` refreshes, `enter` opens the task from the latest run, `esc` or `q`
closes the page.

Deleting removes the routine and its run history. **Tasks it already created are
untouched.** They are ordinary tasks and outlive the schedule that made them.

To find them — a routine that has been firing for weeks has a task per run —
read the ids off its history before deleting it, since deleting takes the
history with it:

```bash
rove api routine-runs --id <id> | jq -r '.runs[].taskId | select(.)'
```

Then delete the ones you want with `rove api delete --task-id <id>`. Rove does
not sweep them for you: they are ordinary tasks, some may hold work you want,
and a schedule deleting tasks in the background is not a thing you should have
to expect.

## The schedule

Five-field cron, in the **daemon host's local time** (there is no timezone
field):

```text
┌─ minute (0-59)
│ ┌─ hour (0-23)
│ │ ┌─ day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌─ day of week (0-6 or SUN-SAT)
0 3 * * *
```

| Expression | Fires |
|---|---|
| `0 3 * * *` | Every day at 03:00 |
| `0 9 * * MON-FRI` | Weekdays at 09:00 |
| `0 4 * * MON` | Mondays at 04:00 |
| `*/30 * * * *` | Every half hour |

Day matching follows the Vixie rule: when **both** day-of-month and weekday are
restricted they are OR'd, so `0 0 1 * MON` means the 1st **or** any Monday, not
"a Monday the 1st".

## The precheck: don't burn a turn on an idle repo

```bash
--precheck "git log --since=24.hours --oneline | grep -q ."
```

The command runs in the repo, through your login shell, **before** the engine
starts. Exit 0 proceeds. Anything else skips the run *without creating a
task*: a non-zero exit, a timeout (120s by default, `--precheck-timeout`), or
a failure to spawn.

This is the cost control. The dominant waste in scheduled agent work is firing
on time when nothing has changed: the engine still boots, still reads the repo,
and still burns a turn to conclude there was nothing to do. A shell command
answers that for free.

It fails closed on purpose. A broken precheck must never quietly degrade into
"run every time", which is exactly the cost it exists to prevent. `run now` /
`routine-run-now` skips the precheck entirely; asking for the run by hand *is*
the answer to "should this run?".

## What each run did

Run outcomes are deliberately distinct rather than a single "didn't run", because
unattended work is only trustworthy if one glance tells you whether a human is
needed:

| Status | Meaning |
|---|---|
| `dispatched` | Task created (or delivered into the standing session), engine started with the prompt |
| `revived` | Standing session only: its engine had died, so it was respawned in the same worktree. The files carried over, the **conversation did not** |
| `deferred` | Standing session only: the composer was busy, so the prompt is queued in your Inbox. **Not lost** — release it there |
| `skipped_precheck` | The precheck said there was nothing to do. **Healthy** |
| `skipped_missed` | The occurrence was older than the grace window |
| `skipped_unavailable` | The repo or worktree could not be resolved |
| `dispatch_failed` | Task created, but its engine did not start. **Needs you** |

`skipped_precheck` and `dispatch_failed` are opposite signals; they never share
a label.

## One standing session instead of a task per run

A routine that asks the same question every day — *is CI slower than last week?*
— is worthless starting from zero each morning. Give it a standing session and
every firing lands in the **same** task, as another turn in one conversation:

```bash
rove api routine-create --repo . \
  --name "CI trend" \
  --prompt "How do this week's CI times compare with last week?" \
  --schedule "0 9 * * MON-FRI" \
  --persistent-session
```

**Leave it off for a routine that edits code.** A fresh worktree per run is what
makes each result a branch you can review and land; a week of runs piled onto
one branch is a branch nobody can merge.

### Where its output goes

The standing task does not sit in your sidebar as another row. It rests behind a
**`N routine sessions`** count row under its project — press `enter` on that row
to open it and see them, `enter` again to close. Seven daily routines would
otherwise be forty-nine rows a week competing with the handful of tasks you
opened yourself.

Hidden at rest is not hidden: the task is still found by `/` search, still opens
from the Routines page (`enter` on the routine), and still raises an **Inbox**
entry when its turn finishes or it needs you. That entry is how you learn what
last night's routine said — you do not go looking for it.

It also never wins the "which task should I open?" fallback on a cold start. A
routine that fired at 03:00 is genuinely the most recently touched task in the
install and the least likely one you meant; opening Rove lands on your own work
instead.

### When the engine has exited

Continuity comes from the engine's own live conversation, which the PTY host
keeps alive across daemon restarts. When that process is gone — an overnight gap
usually means it is — the next firing respawns it **in the same worktree**. The
files and the branch carry over; the transcript does not, and that run is
recorded as `revived` rather than `dispatched` so a run that started over never
reads like one that had yesterday in front of it.

If the standing task is deleted, the routine simply builds a new one on its next
firing rather than failing forever.

## Restarts, and runs you missed

The next run is stored as an **absolute timestamp on disk**, never an in-memory
timer. A daemon that restarts, or that was down for a day, rediscovers every
armed schedule on its first sweep, with no re-arm step and no lost schedule.

If the daemon was down when a run was due, the occurrence still runs late as
long as it falls inside the grace window (`--grace`, minutes). Down at 09:00,
back at 09:20 with a 60-minute grace → it runs. Back at 14:00 → `skipped_missed`.

Only the **most recent** missed occurrence is ever considered. Three days
offline produces one run, not three: a stampede at boot is worse than a gap.

## The daemon stays awake for you

Rove's daemon normally stops a few seconds after the last GUI detaches. **An
enabled routine holds it open**, because a schedule that only fires while
someone is watching Rove is not a schedule. The header says so while it is
happening, and `rove daemon status` reports the hold, so a daemon staying up for
a schedule does not read as a leak.

The hold releases when the last routine is deleted or disabled, restoring
ordinary idle shutdown. See [Sessions](SESSIONS.md) for the rest of the daemon's
lifetime rules.

## Limits

Known and deliberate, as of today:

- A standing session's engine, once it has exited, comes back without the
  previous transcript (see below).
- No timezone field; schedules are the daemon host's local time.
- No per-run cost attribution, and no remote/SSH execution target.

## See also

- [rove api](API.md#routine): every `routine-*` verb and flag.
- [The TUI](TUI.md#routines-ctrla-2): the Routines page among the other pages.
- [Concepts](CONCEPTS.md): what a task is, and why a run being one matters.
- [design/automations.md](design/automations.md): internal design note, the
  sweep, the cron implementation, the daemon-lifetime hold.
