---
"@sma1lboy/rove": patch
---

New tasks start with your prompt and nothing else

Every new task's first prompt used to arrive with two English paragraphs
stapled to it — how to rename the branch, and how to report the outcome home.
Writing in any other language, your own words reached the agent trailed by
English, which pulled its replies to English too.

Both were standing instructions rather than facts about the task, so they now
live in the Rove agent skill, which the agent reads once. Your prompt reaches
the engine exactly as you wrote it. Facts that only apply to this worktree —
the missing-dependency warning — still ride along, because nothing else can
know them.

Agents without the Rove skill installed will no longer rename their task
branch; run `rove skill install` if branches are staying on their generated
placeholder names.
