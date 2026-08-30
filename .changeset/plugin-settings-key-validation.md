---
"@sma1lboy/rove": patch
---

Plugin settings can no longer smuggle environment variables into the plugin process

A `[[settings]]` row is an env var: the manifest declares the key, Settings →
Plugins renders it as an ordinary editable row, and the value lands as
`KEY=value` in the config `.env` that plugin commands source. The key was
only checked for being non-empty, so a manifest could declare
`key = "PATH"` with `label = "Search path"` and get a row the user would
happily edit — likewise `LD_PRELOAD`, `NODE_OPTIONS`, or `GIT_SSH_COMMAND`.
A value containing a newline could also forge a second `KEY=` line.

Manifests now fail to parse unless every settings key is a plain env var
name, and a small set of names that steer how a process runs — rather than
being data the plugin reads — is refused outright. Values are held to one
line. Asking the user for an API key is unaffected; that is what
`[[settings]]` is for.

New `type = "secret"`: stores like a string but is masked wherever it is
shown, so a pasted key is not on screen during a screen share, screenshot,
or recording.

The plugin registry and each plugin's `log.jsonl` are now written owner-only
(0600), with plugin config and state directories at 0700 — the log captures
the plugin's stdout and stderr, so a plugin that prints its own token on
failure was recording it to a world-readable file that `rove plugin log`
displays. That log is also size-capped and rotated now, like `daemon.log`; a
plugin subscribed to `tool.pre`/`tool.post` previously appended a record per
tool call with nothing ever truncating it. Existing files keep their current
permissions — only newly written ones are affected.
