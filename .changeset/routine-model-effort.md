---
"@sma1lboy/rove": patch
---

Routines can pin the model and reasoning effort every run launches with: `rove api routine-create --model M --effort LEVEL`, checked against the routine's engine when you save it, and `routine-update --model '' --effort ''` clears them.

Routines with a standing task reject changes to vendor, model and effort with instructions to disable the routine and create a replacement, preventing silent reuse of old launch settings.
