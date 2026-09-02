---
"@sma1lboy/rove": patch
---

The agent skill's flag reference is generated from the verb specs

`references/api-flags.md` was hand-written and had drifted from the CLI: it
listed `--prompt-file` on `routine-create`/`routine-update`, where that flag
does not exist, and omitted `set-effort`, `engine-report`, `collect --group`,
`send --allow-empty` and `delete --wait` entirely. Its flag tables now come
from the same verb specs `rove api schema` serves, with an architecture test
that fails naming the stale verb, and SKILL.md points into the file by what a
user asks for ("every morning", "file it upstream") rather than by Rove's own
group names.
