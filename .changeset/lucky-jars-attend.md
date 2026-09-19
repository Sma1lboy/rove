---
"@sma1lboy/rove": patch
---

Copilot and Droid now report which engine session is live in a worktree, through their own hooks instead of a screen read. Copilot writes a `SessionStart` entry into `~/.copilot/settings.json` (`$COPILOT_HOME` honoured) and Droid into `~/.factory/settings.json`; both merges preserve your own hook entries and rewrite only Rove's, so running them again changes nothing. Their screen manifests still own working / blocked / idle exactly as before. A machine without either CLI installed gets no new file and no new directory.
