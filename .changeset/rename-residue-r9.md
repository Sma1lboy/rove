---
"@sma1lboy/rove": patch
---

Six leftovers from the `.kobe` → `.rove` rename, and the api surface that
disagreed with itself about which engines exist.

Settings › Developer › Reset UI state unlinks only the canonical `tasks.json`,
and the legacy `~/.kobe/tasks.json` read fallback ignored the daemon migration
marker — so every pre-rename task came back on the next start, and every save
folded them in as concurrent creates. The fallback is now gated on that marker
in the one place both readers share, and `doctor` uses it too, so it stops
reporting `tasks.json: absent` for a home `rove export` can read.

`pty-exits.json` and `pty-sessions/` never migrated at all: they were left off
the daemon-start copy list on purpose (a daemon copying them would race the
host that owns them), so `.kobe` became their permanent home and deleting it —
which the docs call safe — threw away every frozen session and exit record. The
PTY host moves them at its own boot now, leaving a compatibility symlink.
`linkLegacyRuntimePath` also stopped creating `~/.kobe` on fresh installs,
where its only content was dangling links.

`rove skill status` reported the first skill copy it found, so a pre-rename
`~/.agents/skills/kobe` went unmentioned once a `rove` copy existed — while
agents kept loading it. It is now named as a stale duplicate. `doctor --report`
prints both spellings of each knob (a `ROVE_WEB_HOST` value used to arrive
redacted), and `ROVE_FILETREE_WATCH`, `ROVE_RPC_TIMEOUT_MS`, `ROVE_HOOK_DEBUG`
and `ROVE_DAEMON_IDLE_GRACE_MS` reach their readers directly instead of only
through the wrapper's mirror — with rows in the CLI reference.

`rove api` accepts the plugin-contributed engines `engine-list` advertises:
`--vendor`, `--agents` and `schema` used to reject them with an error pointing
at `engine-list`, and a task created with `--command <plugin-engine>` recorded
`generic`. `routine-runs` on an unknown id now errors instead of answering
`{"runs":[]}`, which reads as "it exists and has not run yet".
