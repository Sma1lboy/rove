---
"@sma1lboy/rove": patch
---

Add a light mode. Settings → General → Appearance has a new Mode row with Dark, Light and Auto. Auto asks the terminal for its background and switches again when the terminal reports an appearance change, so a terminal that follows the macOS light/dark setting now takes Rove with it. Until now every theme drew its dark half, and the light palettes that `claude`, `conductor` and the hosted themes already define could not be reached. The choice is saved as `themeMode` in `state.json`, reaches every open session the way a theme switch does, and shows in the Appearance preview before you apply it. Unset stays Dark, so nothing changes until you pick another mode.

A fourth bundled theme, `skylight`, is built around its light half: a cool white canvas, dark ink text, a sky-cyan focus accent and royal blue for running sessions. Its dark half is near-black with the same cyan. Body text, muted text and every state color clear 4.5:1 on its canvas, panels and selected row in both modes.
