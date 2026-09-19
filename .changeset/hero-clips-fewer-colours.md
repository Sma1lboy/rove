---
"@sma1lboy/rove": patch
---

**The README demo and the three docs clips are a fifth smaller** — the four recorded clips were re-encoded at 48 colours with no dithering instead of 96 with a Bayer dither, taking 1.9 MB off their combined 9.2 MB (the README demo alone goes 3.4 MB → 2.6 MB, and it is the one you pay for on the npm page). The dither turned out to be the surprise: a terminal UI quantises losslessly at 96 colours, so the Bayer pass had a zero quantisation error to diffuse and was doing nothing but burning encode time. Frame counts, durations and the poster frame each clip opens on are unchanged, so nothing about what the clips show moves — only how many bytes they take to say it.
