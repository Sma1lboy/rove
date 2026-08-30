---
"@sma1lboy/rove": patch
---

Stop two concurrency faults that broke work Rove didn't own

Pre-trusting a worktree for codex used to read-check-append
`~/.codex/config.toml` unguarded, so two spawns for the same worktree (a
retried launch, TUI and daemon at once) could both append the same
`[projects."<path>"]` table. Codex rejects the whole config on a duplicate
TOML key — every codex task on the machine fails, not just the raced one.
The write now serializes on a lock file beside the config and self-heals any
duplicate stanza in the exact shape it writes, so the file stays valid even
when a stale lock outlives its holder.

The orchestrator's read-only git probes — the dirty check before worktree
removal, land's pre-merge checks, branch/ref lookups — ran `git status` and
friends without the `GIT_OPTIONAL_LOCKS=0` policy the rest of the app
already honors, so a probe could grab `.git/index.lock` while the engine in
that worktree was mid-commit and make the agent's own `git commit` fail
with "Unable to create .git/index.lock". Probes now run lock-free; writes
(worktree add/remove, merge, branch) deliberately keep taking the lock.
