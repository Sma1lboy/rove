---
"@sma1lboy/rove": patch
---

Landing site: the nav bar fits every screen again, and the page no longer scrolls sideways.

Adding `--docs` to the nav pushed the GitHub button — and with it the star
count, the site's only piece of social proof — off the right edge at every
width from 320px to 630px, and again between 821px and 855px. The bar hides
links in tiers as it narrows, and those tiers were sized before the sixth
link existed. They are re-measured now, and each tier records the bar width
its link set actually needs so the next link added gets re-measured instead of
silently truncating the bar. `--docs` survives to the narrowest width; every
link a tier drops is still reachable from the footer.

Separately, the scroll-reveal entrance parks each stage 14px outside the
viewport until it animates in, and the page could be dragged those 14px
sideways on any screen wider than 880px. The root element now clips it.
