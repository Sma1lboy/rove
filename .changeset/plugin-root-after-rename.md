---
"@sma1lboy/rove": patch
---

Plugins installed before the `.kobe` → `.rove` rename load again. The layout migration moved every checkout under `~/.rove/plugins/` but the registry kept naming the old tree, so Settings › Plugins showed "manifest unreadable" for all of them and the daemon enabled none. A managed root recorded under `~/.kobe/plugins/` is re-anchored on read; user-facing copy names the new path.
