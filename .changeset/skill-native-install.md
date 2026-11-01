---
"@sma1lboy/rove": patch
---

The Rove agent skill now installs from Settings → Engines in the TUI and the web app, which show each engine's copy. When Rove starts and an engine set up on the machine has no skill, a notice names it once. The welcome guide installs the skill on the spot. Installing no longer needs Node or `npx`, and installed copies refresh themselves after an upgrade. `rove skill install`/`status` remain the shell route; `rove skill command` and `--project` are gone.
