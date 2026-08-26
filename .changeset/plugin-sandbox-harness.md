---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Named plugin sandboxes: `bun plugin-sandbox <name> <link|run|api|smoketest|home|reset>`
gives every plugin-dev or demo-recording task its own isolated home, daemon,
PTY host, plugin registry, and web port under `.scratch/plugin-sandbox/<name>` —
parallel sandboxes never collide with each other, the shared dev sandbox, or
production. The SDK ships a first runnable example
(`examples/hello-events`), and `smoketest` proves the whole chain end to end:
link the example, boot a fresh daemon, fire `issue.changed`, assert the hook
saw it.
