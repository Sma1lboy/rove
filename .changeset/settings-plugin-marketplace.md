---
"@sma1lboy/rove": patch
---

Browse and install plugins from Settings, without dropping to a shell

The marketplace was already there — `rove plugin search` queries the `rove-plugin` topic on GitHub — but the only way to act on it was to leave the TUI and type `rove plugin install`. Settings → Plugins said as much: its empty state offered a shell command.

Settings now has a Marketplace section next to Plugins. It lists the topic most-starred first, tags what is already in the registry, and installs on `enter`. The confirmation gate is unchanged in substance: the clone is staged, the manifest's build commands, startup hooks, actions and event handlers are all shown, and nothing the plugin authored runs until you confirm — `rove plugin install` and this section now share one two-phase installer rather than each having their own.

Cloning and building no longer block the process they run in, so the install reports its phase instead of freezing the UI behind a `git clone`.
