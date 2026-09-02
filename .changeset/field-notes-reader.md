---
"@sma1lboy/rove": patch
---

Read a repo's field notes without leaving Rove: the project header's right-click menu gained a **Field notes** entry that opens a read-only list of the notes agents filed with `rove api note`, newest first, each with its author and time. Until now `rove api note-list` in a shell was the only reader. Also trims `state/zen.ts` to the two state.json keys it actually owns (its three unused helpers and tmux-era doc are gone) and un-exports three onboarding helpers nothing imported.
