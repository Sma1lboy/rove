---
"@sma1lboy/rove": patch
---

Archive, pin and delete in the web rail show the moment you click, and the rows around them slide into place. Before, the row waited for the bridge's next list push, which came 250 ms after any change plus the round trip. The bridge now pushes the first change after a quiet spell at once, so a change made anywhere (the TUI, the CLI, another browser) also shows about 250 ms sooner. The delete dialog closes on the click; a worktree with uncommitted work brings the row back and asks about a force delete.
