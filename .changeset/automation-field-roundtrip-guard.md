---
"@sma1lboy/rove": patch
---

Guard every Automation field across a daemon restart. A new test creates an automation with all seventeen fields set, reloads the store from disk the way a restart does, and compares the whole record, so a field the loader forgets now fails CI instead of silently disappearing after `rove daemon restart`. The same test checks that every `AutomationPatch` key actually changes the record through update, and that clearing precheck, baseRef, or the standing-session link removes the field on disk.
