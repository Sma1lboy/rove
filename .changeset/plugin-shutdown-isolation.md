---
"@sma1lboy/rove": patch
---

Stop one plugin's failure from abandoning every other plugin's shutdown hook.
`runPluginHook` documented itself as never rejecting, but two paths broke that:
the `mkdirSync` calls that create a hook's config/state dirs sat outside any
try, and a manifest may write a TOML `\u0000` escape into its argv, which makes
`spawn` throw synchronously. Either one escaped into `PluginHost.stop()`, where
`Promise.all` short-circuited and returned while the other plugins' hooks were
still running — unawaited, so the daemon's `process.exit` destroyed their grace
timers and left the orphaned children the method exists to prevent. The dir
failure is now recorded as a `spawnError` in that plugin's own `rove plugin
log`, the contract is enforced where every hook call site goes through, and the
reap uses `allSettled`. Event dispatch is likewise isolated per plugin rather
than per batch, and the registry-reload timer — the last dispatch path with no
guard above it — no longer turns a throw into an uncaught daemon exception.

Docs: `[[engines]]` needs a Rove restart (only daemon-run hooks hot-reload);
`turn.interrupted` is TUI-emulated on Claude and Codex, so it never fires with
no TUI attached; `RoveRunOptions` / `RoveRunResult` are documented; the SDK's
socket table no longer presents instance methods as named exports;
`delivery.composerGate` no longer claims that turning it off removes all
typing protection; and `experimental.remoteProjects` says that it gates
`rove add --remote` alone.
