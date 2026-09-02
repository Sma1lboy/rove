---
"@sma1lboy/rove": patch
---

Every dialog now wears one look. The New task and New routine cards had
lowercase labels and bare inputs while the kanban story drawer had capitalised
labels, rounded field wells and a key legend — same card, two grammars. The
story-drawer version won and is now shared components, so New task, New
routine, Set status and the rename prompt all draw their fields as rounded
wells, mark focus the same way, and close with the same key legend.

The Routines card's square-cornered fields are the visible half of that: a
framed box only gets rounded corners if its author asks, and now nobody has
to. On a terminal shorter than 34 rows the frames drop away instead of the
Create button, which is the row budget that made those borders unaffordable.
