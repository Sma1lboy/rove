---
"@sma1lboy/rove": patch
---

`rove api` can now send work to your other machines. Any verb takes `--machine <alias>` and runs inside that machine's daemon, so `rove api add --machine narwhal --repo /srv/rove --prompt "…"` creates the task, its worktree and its engine session over there. A `--task-id` that lives on another machine is routed there by itself, so `send`, `read-output`, `land` and `delete` now act on a remote task the sidebar shows instead of refusing with `NOT_YET_SUPPORTED_REMOTE`. The daemon socket and the bridge (`rove --web`, the phone apps) take the same `"machine"` field on `api.invoke`, which turns a `--resident` daemon on an always-on box into a hub for every machine registered there. Paths are paths on the target machine, and `--prompt-file` is read locally and sent as text. New error codes: `UNKNOWN_MACHINE`, `MACHINE_UNREACHABLE`, `MACHINE_VERSION_SKEW`.
