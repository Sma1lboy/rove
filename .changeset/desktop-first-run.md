---
"@sma1lboy/rove": patch
---

[desktop][web] On a computer with no Rove, the desktop app now has an **Install Rove** button that runs the installer, shows its output and opens Rove by itself when it finishes. The welcome page then lists what a first task needs (an agent installed, an agent signed in, a project picked) with a button beside the first missing one that fixes it on the spot. The app also starts a `rove` whose `node` sits beside it when launched from Finder, where it used to fail.
