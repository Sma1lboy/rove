---
"@sma1lboy/rove": patch
---

The web dashboard now resolves theme colours through the TUI's shared hex normalizer, so a theme slot written in the schema-sanctioned `#abc` shorthand or `#aabbccdd` (alpha) form gets the same expanded, alpha-stripped `#rrggbb` the TUI uses — previously the web kept the literal verbatim and fed it into its colour-blend helper, which reads only six digits, so every derived slot (subtle text, hover, border tones) blended the wrong channels; a malformed hex now skips the slot instead of producing a garbage colour.
