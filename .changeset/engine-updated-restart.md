---
"@sma1lboy/rove": patch
---

After you upgrade an engine CLI, `rove api get-task` marks each tab still running the old version with `engineUpdated: true`, and `rove api tab-revive --restart-updated` relaunches that tab onto the new version with its conversation resumed — only once its turn is over, so a working or waiting engine is never cut off (`busy: <state>`).
