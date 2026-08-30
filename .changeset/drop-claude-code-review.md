---
"@sma1lboy/rove": patch
---

Drop the Claude Code Review CI workflow. Its findings never gated a merge — an
empty `ANTHROPIC_API_KEY` in Actions made it fail spuriously often enough that
AGENTS.md carried a standing rule to wave those failures through. The hard gates
(typecheck/test, behavior, file-size-cap, coverage-cap, changeset) are unchanged.
