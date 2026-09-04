# Implementation plans — frozen records

Every file in this directory is a plan written **before** the work it
describes, and kept **as written** afterwards. They are dated for that reason.

## Their file paths are not current, by design

A plan names the tree it was planning against. Executing it moved, renamed and
deleted those files — `2026-07-10-embedded-terminal-identity.md` points at
`packages/kobe-web/pty-server.mjs`, which is `packages/kobe-harness/` since
#871; `2026-07-12-puretui-only-tmux-removal.md` points at the `src/tmux/`
modules whose deletion was the plan's whole point.

So a dangling `packages/**` path in here is not rot to fix. Rewriting the paths
would make each plan describe a tree it was never written against, and the
record would be worth less, not more. A mechanical path sweep over the repo
will flag these; that is the sweep being wrong about this directory.

To find out what the code does now, read the code, `docs/`, or
[`packages/kobe/CHANGELOG.md`](../../../packages/kobe/CHANGELOG.md) — not these.

## Where live documentation lives instead

`docs/` — the pages that ship to [docs.rove.run](https://docs.rove.run) and are
verified against source when they change. `docs/adr/` — decisions, each with a
status line that says whether it still holds.
