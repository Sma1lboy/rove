---
"@sma1lboy/rove": patch
---

Rename 17 tests whose names had drifted from what their assertions actually verify — overstated quantifiers ("every", "exactly", "only the three"), claims of untested clauses ("rethrows real errors", "without mutating"), and one vacuous tombstone test whose name promised concurrent-writer coverage its body never exercised. Assertions are untouched; the one genuine frozen-bug case (parseDiffRows ghost meta row for an empty patch) is documented in .scratch/test-name-drift.md rather than papered over.
