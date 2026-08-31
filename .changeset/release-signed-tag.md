---
"@sma1lboy/rove": patch
---

`scripts/release.sh` now creates an annotated tag, so a release cuts cleanly on a machine that signs its tags.

With `tag.gpgSign = true` in git config, a signed tag must carry a message, and the script's bare `git tag <name>` died with `fatal: no tag message?` — after the release commit had already been pushed. The version was left committed and untagged, which the script's resume mode recovers, but the release stopped halfway for a reason that had nothing to do with the release.
