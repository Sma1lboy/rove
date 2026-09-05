---
"@sma1lboy/rove": patch
---

Bound a routine precheck inside the shell that runs it, so it cannot outlive the daemon.

A precheck's timeout lived only in a `setTimeout` on the daemon side. A daemon that was SIGKILLed took that timer with it and left the shell running with nothing that would ever stop it — a precheck shaped like `while [ ! -f flag ]; do sleep 0.01; done` then span at roughly a hundred forks a second until the machine was rebooted. Thirty-three such orphans held a Mac at load 170 with 86% of its CPU in the kernel.

The spawned shell now carries the same deadline itself, and a timeout kills its whole process group rather than the shell alone, so a command's own children (`gh pr list | grep …`) go with it.
