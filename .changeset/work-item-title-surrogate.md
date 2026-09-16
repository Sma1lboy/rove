---
"@sma1lboy/kobe": patch
---

Starting a task from a GitHub issue whose title is long enough to be truncated no longer leaves a broken � glyph at the cut when an emoji or other supplementary character straddles the boundary. The title is now clipped on whole-character boundaries, so the number stays up front, the length stays within the sidebar cap, and the trailing … reads cleanly.
