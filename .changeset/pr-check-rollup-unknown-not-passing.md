---
"@sma1lboy/rove": patch
---

The per-task PR badge no longer reports a branch's checks as passing when one of them is unreadable. The status rollup that condenses a PR's check runs into a single headline treated any entry it could not classify as if it were absent, so a mix of one green check and one unreadable entry surfaced as a clean "passing" — telling you CI was clear when a check's state was actually unknown. It now reports "passing" only when every check that is not failing or pending is genuinely green, and pulls the headline to "unknown" otherwise; a failing check still wins, a pending one still beats an unknown sibling, and a well-formed all-green PR is unaffected.
