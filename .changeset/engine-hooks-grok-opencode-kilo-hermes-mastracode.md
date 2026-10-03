---
"@sma1lboy/rove": patch
---

Add Hermes, Kilo, and MastraCode to the engine catalog. Add session hooks for Grok and Hermes, and turn lifecycle hooks for OpenCode, Kilo, and MastraCode. OpenCode and Kilo preserve turn completion across session updates and distinguish rate limits from billing failures.

Hook installation preserves user configuration and skips absent CLI config directories. Hooks now read complete JSON payloads without waiting for engines to close stdin.
