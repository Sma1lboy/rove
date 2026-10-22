---
"@sma1lboy/rove": patch
---

Kanban and Issues are now first-party mods that are not installed by default, in the TUI and the web alike. Install one from Settings → Plugins (an Install button in the web, enter in the TUI) or with `rove plugin install kanban` / `rove plugin install issues`; its rail row and `ctrl+a` chord appear everywhere at once. Uninstalling hides them again and leaves the issue store on disk, so a later install picks your stories back up. The old `plugins.bundled.<id>.enabled` switches are ignored.
