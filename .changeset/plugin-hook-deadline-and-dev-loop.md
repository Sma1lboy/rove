---
"@sma1lboy/rove": patch
---

A plugin hook that never exits no longer leaks a process per fire. Event and startup hooks now have a 30s deadline (3s for shutdown, or whatever `timeout_ms` the hook declares), and the host SIGKILLs the hook's whole process group at it — so a `curl` with no `--max-time` on a `tool.post` hook stops one process short of leaking one per tool call. `rove daemon stop` reaps hooks that are still running instead of leaving them behind; previously those children held the daemon's stdio pipes, so the daemon could not exit either.

A hook still running after ~2s now writes a `phase: "running"` record to `log.jsonl` ahead of the record its exit will write, and Settings → Plugins shows it as `still running` rather than `exit null`. `rove plugin log` used to say `(no runs logged yet)` for exactly the failure that leaks.

The daemon also watches each linked plugin's `rove-plugin.toml`, not just `plugins.json`, so a manifest edit applies to a running daemon within about half a second — `rove plugin link` is a one-time registration again, as the Quickstart says. And a TOML syntax error no longer fires `plugin.disabled`: lifecycle events follow registry membership, so an author's typo can't make a plugin run its teardown.
