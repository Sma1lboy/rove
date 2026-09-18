---
"@sma1lboy/rove": patch
---

Show what changed on the first launch after an upgrade

The first time Rove starts on a newly installed version it opens a What's New
page listing the release notes for every version between the one you were
running and the one you just started. `q` / `esc` dismisses it and it stays
gone until the next upgrade; a fresh install and a downgrade never see it.

The page follows your UI language. The release notes themselves are whatever
was published to the GitHub release, which today is English only. An
unreachable GitHub is stated on the page with the release URL — it never
blocks startup, and the page is dismissible before the notes load.
