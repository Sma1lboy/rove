---
"@sma1lboy/rove": patch
---

Remove the archived-task surface from the TUI (issue #75 slice B).

- The sidebar no longer has an "Archived" view; the working set is the only list.
- The `a` keybinding for toggling archive is removed.
- The tree context menu no longer shows an "Archive" action.
- The `experimental.archivedHistoryPreview` beta setting and its Settings → Dev row are removed.
- The settings API no longer exposes or persists `archivedHistoryPreview`.
- Related i18n keys (`tasks.menu.archive`, `sidebar.archive`, `history.archivedTag`, `settings.dev.archivedHistory*`) are removed in all locales.
- Existing `state.json` files with the removed key are tolerated; unknown keys do not cause parse failures.
