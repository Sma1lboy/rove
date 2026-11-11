---
"@sma1lboy/rove": patch
---

Web: after **Update now** installs a new version, the Update page offers **Restart Rove** in its place. One click restarts the daemon and `rove --web` onto the new build, and the page reloads itself when they are back; engine sessions keep running. Before, the page kept showing **Update now** and told you to restart both by hand.
