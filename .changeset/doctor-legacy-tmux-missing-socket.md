---
"@sma1lboy/rove": patch
---

Stop `rove doctor` reporting a red ✗ for the healthiest possible machine.

The legacy-tmux row exists to find leftover pre-v0.8 sessions. It classifies a
failed `tmux list-sessions` as either "no server" (fine) or "inspection failed"
(a ✗), by matching tmux's message — and the phrasing tmux 3.5 uses when the
socket file does not exist at all, `error connecting to <path> (No such file or
directory)`, was not in the list. So every install that never ran pre-v0.8 Rove
— which is every new install — was told something was wrong:

```
legacy tmux: ✗ inspection failed — tmux list-sessions failed: error connecting to /private/tmp/tmux-501/kobe (No such file or directory)
```

A missing socket is a missing server. That machine now gets the healthy line:

```
legacy tmux: tmux 3.5a — no sessions on `kobe`
```

The same wording covers a stale socket whose server has died, and a genuine
inspection failure still reports one.
