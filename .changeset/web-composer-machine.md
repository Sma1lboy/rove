---
"@sma1lboy/rove": patch
---

The web New task composer can now start a task on any registered machine: a machine chip beside the project chip lists this machine and every `rove machine add` machine (one that is offline or too old is shown with its state and cannot be picked), the project list switches to that machine's own repos by id, a typed `owner/repo` or URL and every row under "Your GitHub repositories" offers "Clone … on <machine>" so the machine fetches the repo with its own git and gh sign-in when you press Start (a `CLONE_FAILED` or `MACHINE_UNREACHABLE` shows in the composer's error line), and a typed branch picks what the task branches from; the classic dialog's separate remote tab is gone, and the bridge gains `machines.repos` plus `repo` ids and `clone` on `task.spawn` for another machine.
