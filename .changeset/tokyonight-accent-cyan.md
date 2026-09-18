---
"@sma1lboy/rove": patch
---

Give the Tokyo Night theme an accent colour that is not also its warning colour

`accent` and `warning` both resolved to the same orange, so a kanban card's "working" badge was the same colour as a warning badge — the two states the card's own tone vocabulary puts side by side. Accent now uses the palette's cyan, which sits 177° away from that orange and raises contrast against the dark background from 8.0 to 11.6. The other bundled themes already kept the two apart; only Tokyo Night collided.

Orange keeps the roles it should have: `warning`, plus the `syntaxNumber` and `markdownStrong` syntax slots.
