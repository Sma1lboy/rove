---
"@sma1lboy/rove": patch
---

Fix the sidebar's ZEN chip rendering as a colored emoji blob on Linux. `☯` (U+262F) has no default emoji presentation, so macOS draws it as a narrow text glyph — but Linux fontconfig routes it to Noto Color Emoji, whose double-width sprite overran the single cell reserved for it and painted over the `ZEN` label beside it. The chip now falls back to a monochrome `◐` off macOS.
