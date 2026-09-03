---
"@sma1lboy/rove": patch
---

Internal: the daemon's six file-backed stores now share one mutation serializer. The "queue this read-modify-write behind a settled promise tail" primitive was written six times in two spellings — four private `enqueue` methods (automations, attention inbox, agent turns, deferred prompts) and two module-level `withLock` copies (issues, notes) — and `json-file.ts`, already the single owner of the atomic write half, now owns `serialized(path, fn)` too. The lock key stays the file path, since each store reads and writes its document whole; a rejected mutation still settles the tail rather than wedging the queue. Repo resolution for the two repo-keyed stores collapsed the same way: `gitTopLevel` moved beside its siblings in `repo-key.ts`, which now exposes `resolveRepoRoot` for the shared stat-and-derive half while each store keeps its own answer to "no worktree line". No user-visible change — `issue-list`, `note-list` and `inspect` are byte-identical.
