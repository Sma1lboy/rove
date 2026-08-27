---
"@sma1lboy/rove": patch
---

Pin the plugin SDK examples to the manifest contract. Every example is now parsed by the real `rove-plugin.toml` parser, checked for a misspelled event name or unsupported pane placement, and required to ship the entrypoint files its commands name — the examples are also inside the SDK's typecheck scope for the first time. Copying a broken example used to be silent; now it turns CI red.
