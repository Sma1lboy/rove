---
"@sma1lboy/rove": patch
---

Watch the plugin registry by stat-polling instead of `fs.watch`. On macOS the FSEvents stream behind `fs.watch` starts asynchronously, so a `plugins.json` write landing before the stream is live was dropped forever — the daemon never saw the install/enable until the next mutation, and the plugin-runtime test flaked ~8% under a loaded suite (issue #61). The host now takes a synchronous baseline stat before the first registry load and polls every 200ms, so no write can fall between the watcher and the load.
