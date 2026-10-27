---
"@sma1lboy/rove": patch
---

Internal cleanup: the OpenCode, pi and Hermes hook installers share one write-only-when-changed helper instead of three copies; installed hook files are byte-identical.
