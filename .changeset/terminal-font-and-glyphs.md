---
"@sma1lboy/rove": patch
---

Wait for the whole terminal font stack before the first paint

`loadTerminalFont()` awaited only JetBrains Mono, which ships as a latin
subset — so every icon glyph an engine draws falls through to a Nerd Font, a
family the browser never requests until something actually renders that
character. Interactively the lazy load is invisible; anything that reads the
terminal early sees missing-glyph boxes where the icons belong. Each family in
the stack is now warmed independently, so a machine without Nerd Fonts still
renders the rest.
