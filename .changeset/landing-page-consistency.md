---
"@sma1lboy/rove": patch
---

fix(landing): plugins, themes and changelog match the home page again

The nav, footer and design tokens were copy-pasted into every page, so the
home page redesign (flat full-width bar, square frames) never reached the
others — and the changelog was a different site entirely: dark background,
Space Grotesk, hardcoded hex, and a nav pointing at three anchors the home
page no longer has.

All four pages now link one `chrome.css` for tokens, nav and footer. The
changelog is rebuilt on it, keeps its live GitHub release rendering, and
gains the nav language toggle the other pages already had (its EN/中文
segmented control is gone; page copy is now translated too). Its type tags
were darkened for a paper background.
