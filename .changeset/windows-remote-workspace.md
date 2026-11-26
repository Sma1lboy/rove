---
"@sma1lboy/rove": patch
---

`add --machine` to a Windows machine now runs the agent on this machine and works on the files there, as it does for any other machine. Commands run in Git for Windows' bash in the worktree; the ssh shell's PowerShell profile banner is dropped and exit codes come through. Before, the engine silently started on the Windows machine instead, where a local launcher such as `claudecpa` does not exist.
