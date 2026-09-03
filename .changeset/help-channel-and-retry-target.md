---
"@sma1lboy/rove": patch
---

`rove --help` mentions channel switching, and an empty-success retry keeps its target

`update` has accepted `--channel latest` / a bare `nightly` for several releases, but the top-level help still read `update [version|list]` — the subcommand lock-step test only compares the command list, so the description drifted past CI.

`send`'s empty-success refusal hands back a `nextCommandArgs` you are told to run verbatim; it dropped the `--task-id` / `--tab` you addressed, so the retry re-resolved through the active-task fallback and could deliver into a different task. It now carries the target forward.
