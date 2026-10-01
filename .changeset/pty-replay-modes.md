---
"@sma1lboy/rove": patch
---

Reopening a tab no longer loses terminal modes an app set long ago. The Hosted PTY host replays only the last 512 KB of output, so a mouse-tracking mode turned on once at startup (omp, `vim`, `less --mouse`) used to vanish, and the wheel then scrolled Rove's nearly empty local buffer instead of the app. The host now records the modes in effect where its buffer begins (mouse tracking and encoding, bracketed paste, cursor/keypad modes, alternate screen, cursor visibility). It re-sends them before every full replay and keeps them across a host restart. Engines started with no Rove window attached (`rove api add`, dispatched tasks) now get answers to their DA1 and DECRQM feature probes from the host, matching what the embedded terminal would answer. omp started that way used to turn off synchronized output and its paste-mode keep-alive. A running host picks this up after `rove reset`.
