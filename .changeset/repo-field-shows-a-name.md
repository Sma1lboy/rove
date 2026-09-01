---
"@sma1lboy/rove": patch
---

New task dialog: the repo field takes a name, and shows the path beside it

The Existing tab's repo field used to be a full absolute path — the one thing
that identifies a repo sitting at the far right of a string whose left half is
identical on every row you own. It now holds the repo's NAME, with the
directory in muted text at the row's right edge, matching how the picker rows
below already read. Those picker rows now right-align their directory tails
into one column too, instead of trailing two spaces after each name.

The field holds a name because an opentui `<input>` edits whatever its `value`
prop says: showing a name while state kept a path meant the short string got
written back on the next keystroke. So a name is resolved to a path at submit
time — and when two saved repos share a basename (routine with a hundred repos
flat under one parent), the dialog keeps the full path rather than picking one,
and typing the shared name outright says so instead of silently opening the
alphabetically-first match. Typing a path by hand still works and still renders
verbatim.
