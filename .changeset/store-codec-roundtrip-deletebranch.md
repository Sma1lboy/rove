---
"@sma1lboy/rove": patch
---

Fix the tasks.json load coercion silently dropping `deletion.deleteBranch` — a queued "delete branch too" deletion no longer downgrades to keep-the-branch across a daemon restart. A type-derived schema round-trip test now guards every optional Task field at once, so the next field added to Task cannot repeat this class of silent loss (it was the 7th).
