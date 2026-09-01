---
"@sma1lboy/rove": patch
---

Lead each saved-repo row in the new-task picker with its folder name, and mute the path behind it.

The saved list is a column of absolute paths that mostly share a prefix (`/Users/me/i/kobe`, `/Users/me/i/wisp`, …), so every row opened with the same run of characters and the one word telling them apart sat far right, past the ragged part. The basename now leads at a fixed left edge and its directory trails in muted text — the same string, re-ordered so the identifying half is what the cursor's emphasis lands on. Directory browse rows (typing a `/`) already list bare folder names and are unchanged.
