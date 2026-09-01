---
"@sma1lboy/rove": patch
---

Account detection now dispatches through the engine registry instead of a
second hand-written vendor list. Adding a built-in engine is one edit in its
registry entry; previously a missing entry in the neutral status module made
Settings → Accounts and `rove doctor` report "login not detectable" for an
engine that had a working detector wired up. Nothing changes for existing
engines — built-ins, contrib and custom engines all report exactly as before.
