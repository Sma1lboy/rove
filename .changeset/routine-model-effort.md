---
"@sma1lboy/rove": patch
---

Routines can pin the model and reasoning effort every run launches with: `rove api routine-create --model M --effort LEVEL`, and `routine-update --model '' --effort ''` clears them. Pins are checked when you save against `--vendor`, else the repo's default engine, else the built-in default, and the routine stores that vendor so its runs launch the same engine the pins were checked against.

Routines with a standing task reject changes to vendor, model and effort with instructions to disable the routine and create a replacement, preventing silent reuse of old launch settings.
