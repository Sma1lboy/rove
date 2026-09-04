---
"@sma1lboy/rove": patch
---

Plugin engines can declare `first_message_delivery` in their manifest. A CLI
whose first positional is a subcommand or a project directory died on its own
first prompt under the `"argv"` default, and the key that fixes it existed on
the registry but was unreachable from a manifest. An unknown value is now a
manifest error instead of a silent fallback to the broken default.
