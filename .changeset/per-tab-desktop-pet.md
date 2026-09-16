---
"@sma1lboy/rove": patch
---

Add an opt-in desktop pet: one ASCII creature per terminal tab, on the tab's sidebar row. It reads the same per-tab activity the row's state glyph and the card badge read, so it can never disagree with them — it dozes when the tab idles, works while the engine runs, waits when the row shows `!`, and grins when a turn lands. Two species (a cat and a dango) are hashed off the tab id, so sibling tabs are not all the same animal and a tab keeps its creature across restarts. Off by default under Settings → Dev → "Desktop pet" (`rove.desktop_pet`); with it off the rail renders exactly as it did before.
