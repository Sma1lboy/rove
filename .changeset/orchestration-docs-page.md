---
"@sma1lboy/rove": patch
---

New docs page: Orchestrating many agents (`docs/ORCHESTRATION.md`).

The existing docs covered the mechanics — the verb table in API.md, the
Task/Worktree/Tab nouns in CONCEPTS.md — but no page explained how to
actually run a multi-agent workflow: when a new task beats a new tab, how
wide to fan out, how worker outcomes travel back through the dispatcher,
how to close a round with `collect`/`land`/`archive`, and the failure modes
(silent workers, "succeeded" with nothing committed, fresh-worktree install
failures masquerading as product bugs). Every command on the page was
verified against `rove api schema`. Published under Automating on
docs.rove.run.
