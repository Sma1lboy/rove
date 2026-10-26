---
"@sma1lboy/rove": patch
---

The web side panel now follows `rove api panel-show`: the page on that task opens the panel on the requested view (leaving zen, without taking focus or switching task) and every other page remembers it for when you get there. The page also tells the daemon whether it has a panel, whether it is open and whether it is narrow, so `rove api viewers` is accurate. The Browser asks the bridge before framing an https page: a site that forbids being embedded (GitHub, for one), or a localhost address while you are on another device, now shows a quiet one-line note instead of a blank frame.
