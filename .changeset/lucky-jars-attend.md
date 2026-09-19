---
"@sma1lboy/rove": patch
---

Copilot, Droid, Qoder CLI and Devin now report which engine session is live in a worktree, through their own hooks instead of a screen read. Each installs one `SessionStart` observer — copilot into `~/.copilot/settings.json` (`$COPILOT_HOME`), droid into `~/.factory/settings.json`, qodercli into `~/.qoder/settings.json` (`$QODERCLI_CONFIG_DIR`), devin into `~/.config/devin/config.json` (`$XDG_CONFIG_HOME`). Every merge preserves your own hook entries and rewrites only Rove's, so running them again changes nothing, and a machine without one of those CLIs gets no new file and no new directory. Their screen rules still own working / blocked / idle.

Qoder CLI and Devin are also new to the engine catalog: Rove can now launch and badge both, and each shows up in the new-task engine picker once its binary is on PATH.
