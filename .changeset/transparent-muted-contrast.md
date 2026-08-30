---
"@sma1lboy/rove": patch
---

Transparent mode: contrast-guard body text against the detected host terminal background. In transparent mode (the default) `text` and `textMuted` render directly on the host terminal's background, which the palette author never saw — a dark-palette muted gray sat near 2.5:1 on a light host. The TUI now queries the terminal's actual background (OSC 11 via the renderer's palette detection) and lifts the lightness of those tokens away from the host (preserving hue) until they clear a 4.5:1 floor; detection failure or timeout leaves the palette untouched. Backgrounds stay fully transparent — no opacity is traded for readability.
