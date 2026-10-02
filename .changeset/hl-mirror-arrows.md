---
"@sma1lboy/rove": patch
---

Plain `h` / `l` now move sideways wherever `←` / `→` already do, vim-style. The new-task selector fields, the engine/effort picker, the issue-detail status/engine/jump rows, the automation schedule segments, the Kanban board cursor, and the quick-task composer's attempts/engine chip rows all answer to `h`/`l`; the dialogs that already had the pair are unchanged. They are additions only — the arrow keys keep working — and each chord sits behind the same scope as its arrow twin, so a focused text field, the composer and `/`-search keep `h`/`l` as ordinary letters. The sidebar is the one deliberate exception: `l` there already opens the row under the cursor, so its `right` stays alone.
