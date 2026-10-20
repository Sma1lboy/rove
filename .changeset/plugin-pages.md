---
"@sma1lboy/rove": patch
---

Plugins can add React pages to the sidebar rail (experimental). A `[[pages]]` entry in `rove-plugin.toml` names a module whose default export receives the host API and returns a page component. The TUI renders that page in the content pane, on its own React, beside Kanban, Routines and Issues. A page can claim one of the existing page-open chords. Settings → Plugins shows how many pages a plugin declares, and why any page failed to load. See "Pages" in the plugin authoring guide.
