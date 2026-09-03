---
"@sma1lboy/rove": patch
---

Settings drops its dead overlay path, and `t` no longer flips transparency from every section.

`SettingsDialog` carried a second, overlay shape behind a `standalone` prop that production only ever passed `true`. `SettingsDialog.show` had no callers at all, and the overlay branches would not have worked anyway — cursor-follow reads a scrollbox ref only the page branch ever set. The page layout is now the only one.

`t` toggled transparency from the Plugins list, the Keybindings section and Dev — anywhere the surface had focus — while appearing in no keybinding table. It is gone; `enter` on the Transparency row in General does the same thing and always did.
