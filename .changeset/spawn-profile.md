---
"@sma1lboy/rove": patch
---

Find out what Rove is forking. A terminal tab title that flickers between your shell and `git`, a fan that will not settle, an editor a beat behind — all three can mean Rove is spawning child processes far more often than its polls intend, and until now there was no way to tell which poll. `ps` cannot say: a `git` that lives a few milliseconds is caught mid-exec and macOS reports its arguments as `(git)`, so sampling a whole burst yields names and no arguments. `git`'s own `trace2` sees every invocation on the machine but records no parent, so on a machine running several agents it cannot say who asked. Set `ROVE_SPAWN_PROFILE` to a file path and Rove logs one JSON line per child it spawns, naming the code that wanted it, its arguments and the directory it ran in — `jq -r .site` and `sort | uniq -c` then give you a rate per caller. Unset, it costs one boolean test per spawn and touches no disk. See TROUBLESHOOTING for what the normal rates look like.
