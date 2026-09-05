---
"@sma1lboy/rove": patch
---

Merge three pieces of logic that were written twice and had drifted apart.

**Worktree adoption ignored your worktree location setting.** The daemon
computed managed worktree roots from its own copy of the layout, and that copy
never learned about `worktree.basePath`. If you moved your worktree location in
Settings → General, an engine starting inside one of those worktrees was not
recognized, so the worktree never became a task — with no error to explain it.
Both sides now derive the roots, and the meaning of the stored setting, from
one module.

**Sidebar `+N −M` chips counted lines the parser rejects.** The daemon's
counter re-scanned `git status` output with a looser filter than the shared
porcelain parser: a status pair with no path, and any line without a separator
in column 3 (a stray warning, a truncated read), were each billed as one added
file. The counter is now built on the parser, which is also the one the
porcelain edge-case tests cover — previously they covered a copy that was no
longer in this path.

**A whitespace-only `.rove/pr-instructions.md` blanked the prompt.** The
`.rove/` → `.kobe/` fallback was implemented three times with two different
ideas of "non-empty". A file holding just a newline was returned as the PR/CI
template (producing an empty prompt) while the same file was correctly skipped
for `init-prompt.md`. Trimming now applies everywhere: a file of pure
whitespace is a placeholder, and the next candidate — or the built-in
template — is used.

**`rove repo show` said the opposite of what runs.** It reported "present
(wins)" from a bare existence check, so an empty `.rove/init-prompt.md` was
shown as winning while the runtime actually used `.kobe/` or your saved
override — in the one situation the command exists to resolve. It now reports
from the same rules the runtime applies, and distinguishes a file that is
shadowed by a higher-precedence one from a file that is ignored for being
empty.
