---
"@sma1lboy/rove": patch
---

`rove update` installs into the prefix that owns the binary you are running

On a machine with more than one node install — nvm and homebrew, say —
`npm install -g` writes to the prefix of whichever node happens to run npm,
which is not necessarily the prefix holding the `rove` on your PATH. The
update landed somewhere PATH never looked, and the stale copy kept running.

The update script now resolves the running binary back to its own prefix and
pins the install there. It also warns when a second install is on PATH,
naming which one it updated and which ones it left alone.
