---
"@sma1lboy/rove": patch
---

Qoder CLI and Devin join the engine catalog: Rove can launch either one, badge what it is doing, and each appears in the new-task engine picker once its binary is on PATH. Both also report which session is live in a worktree through their own hooks — qodercli through `~/.qoder/settings.json` (`$QODERCLI_CONFIG_DIR` honoured), devin through `~/.config/devin/config.json` (`$XDG_CONFIG_HOME`) — which together with Copilot and Droid makes four engines whose live session Rove now learns from the engine instead of reading off the screen. The merge preserves your own hook entries and rewrites only Rove's, so running it again changes nothing, and a machine without either CLI gets no new file and no new directory.
