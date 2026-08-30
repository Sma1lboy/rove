---
"@sma1lboy/rove": patch
---

Stop writing agent output and credentials as world-readable files

The hosted-PTY freeze store persists each session's whole scrollback ring, so
its records held every byte an agent printed — `env` output, `cat`ed key files,
a git remote carrying a PAT — at mode 0644 in a 0755 directory, readable by any
local user. That store, the PTY exit records, plugin settings `.env` (where
plugin authors are told to keep API keys), `state.json`, `tasks.json`, and the
agent-turn telemetry now all land 0600, with owner-only directories where the
directory is dedicated to the sensitive file.

`rove doctor --report` also stopped printing the value of every `ROVE_*` /
`KOBE_*` variable. That namespace is the plugin env contract, so a token parked
there went straight into a file meant for public bug reports. Known
diagnostic keys (paths, ports, mode flags) still show their value; anything
else is listed as `KEY=(set)`, which keeps the diagnostic signal without the
secret.
