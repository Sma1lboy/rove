# Rove's local evidence sources

This repo keeps its decision record on disk and in the daemon, not in SaaS
tools. There is no Linear, Notion, Slack, Sentry, Datadog, or warehouse MCP
here — the sibling playbooks in this directory are templates for repos that
have them. These are the sources that actually exist.

Search all of them. A null result in one is evidence about how the decision
was made, so record it rather than skipping it.

## 1. ADRs — `docs/adr/*.md`

The highest-signal source when one exists. Each records Context, Decision, and
Consequences for a decision that was argued. Short and few, so read every one
whose title is even loosely related.

```bash
ls docs/adr/
grep -ril "<topic>" docs/adr/
```

Cite as `docs/adr/NNNN-slug.md`. An ADR marked `Status: accepted` with a date
is direct evidence, not inference. Note that ADRs record the decision at the
time it was made; check git log on the files it names to see whether it held.

## 2. Design notes — `docs/design/*.md`

Roughly two dozen notes on subsystem mechanics and the reasoning behind them
(`daemon.md`, `engine-internals.md`, `dispatcher.md`, and so on).
`keybinding-decisions.md` is the record for every chord argument, which is the
one place that reliably answers "why is it bound to *that* key".

```bash
ls docs/design/
grep -rl "<symbol or feature>" docs/design/
```

These are agent-facing operator docs, so they state constraints bluntly. Quote
them directly rather than paraphrasing.

## 3. The daemon issue store

This repo's backlog. Not GitHub Issues — those are inbound user reports only.

```bash
rove api issue-list --repo "$PWD"
```

Filter the JSON yourself; there is no `--state` flag. An issue body often
carries the repro and the reasoning that a commit message compressed away.
Cite as `issue #N`.

## 4. `packages/kobe/CHANGELOG.md`

~3800 lines of shipped behavior, one entry per change, generated from
changesets. The fastest way to date a behavior change and get the phrasing the
author chose when explaining it to users.

```bash
grep -n "<feature>" packages/kobe/CHANGELOG.md | head
```

Pair a hit with `git log -S` on the same term to get from the note to the diff.

## 5. `HANDOFF.md` (local, gitignored)

Present only on a working checkout. Records current risks and open follow-ups
that never made it into a commit. When it exists it is often the only place a
known-but-unfixed problem is written down. Absent on a fresh clone; say so
rather than treating its absence as "no risks known".

## 6. wisp — the org's shared memory

Cross-repo team knowledge, when the `wisp` CLI is available.

```bash
wisp grep "<topic>"
wisp ls '<project>/**'
```

Useful for decisions that span repos or predate this one. Entries carry dates;
prefer the newest and note contradictions between entries rather than merging
them.

## 7. Git and `gh`

Always available. Use [`code-archaeology.md`](./code-archaeology.md) for the
technique. Two repo-specific notes:

- **Squash merges.** This repo squashes every PR, so a feature's whole
  discussion collapses into one commit. `gh pr view <N>` on the number in the
  squash subject recovers the review thread that the commit dropped.
- **Release commits.** `chore: release — X.Y.Z` commits are automated and
  carry no intent. Skip them when walking history.
