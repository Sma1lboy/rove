---
"@sma1lboy/rove": patch
---

Stop the first ten minutes telling a new user things that are not true. On the
most likely new-user machine — every engine CLI installed, none signed in —
three surfaces disagreed with each other about whether Rove could run anything.

The zero-task welcome pane rendered `✓ engines: claude · codex · kimi` thirty
seconds after the setup wizard said `✗ No usable engine yet` about the same
home: it probed binaries on `PATH` and never read account state. It now shares
`rove doctor`'s probe and has the third state it was missing — usable /
installed-but-not-signed-in / absent.

The wizard's closing summary and `rove doctor --fix` printed "install an engine
CLI (claude, codex, copilot, or kimi) and log in" directly under rows carrying
those CLIs' absolute paths. The remedy now branches on which half failed and
names the engines you actually have to log in to.

`rove doctor` and the wizard walked a shorter engine catalog than the product
launches, so a machine whose only CLI is `opencode`, `gemini`, `cursor-agent`,
`grok`, `droid` or `amp` was told it had no usable engine while the new-task
dialog offered that engine and ran it. Both now see every engine Rove can
launch, and the wizard's inline height is derived from the block it prints
instead of a flat 20 rows that a six-engine machine overflowed.

`rove doctor` told a brand-new install its PTY host was broken and prescribed
`rove reset` — the command it describes in the same breath as not undoable and
as killing every live session. The host is started on demand by the first task
tab, so no pidfile and no socket is the normal cold state; only a genuinely
wedged host proposes the destructive remedy now.

`rove api add` reports the `home` it wrote to. A success payload that never
names its destination cannot be wrong about it, and an isolation override that
collapses (an unquoted shell variable holding a whole `env` prefix does not
word-split) reads as an ordinary success. It also refuses a `--repo` that is
not a git repository instead of persisting a task with an empty branch and an
empty worktree path, and seeds sibling titles from `--prompt`, so a fan-out is
comparable the moment it returns rather than showing N identical `(new task)`
rows at exactly the step that tells you to compare them.

Codex tasks could take their name from the repo's own contributor rules: the
filter for that envelope required a trailing `for ` in the heading, exact
newline padding, and that the record end at `</INSTRUCTIONS>`, and had no
predicate at all for `<recommended_plugins>`. Widened to match what live
rollouts write.

Docs: QUICKSTART says the first launch is setup only and ends by asking you to
run `rove` again, names the full engine list, and notes that the two setup
questions are asked once per machine; `docs/WORK-TRACKING.md` no longer sends
users to the browser Issues page, which was removed in #855. — [@Sma1lboy](https://github.com/Sma1lboy)
