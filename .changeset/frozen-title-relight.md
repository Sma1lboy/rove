---
"@sma1lboy/rove": patch
---

A tab whose engine has stopped no longer keeps re-lighting its activity badge. When an engine dies mid-turn it leaves its last spinner frame in the terminal title, and nothing will ever rewrite it — so the observer that watches PTY titles has to time how long that frame has sat still before it can call the tab idle. It kept that clock in memory alongside the session it was watching, and threw the whole thing away every time a `pty.list` call failed. The next call rebuilt it from scratch with the clock at zero, the frozen frame counted as fresh evidence all over again, and the dot came back on. In one report that happened roughly every ninety seconds for hours, so a stopped engine's badge read `running` essentially forever. The observer now keeps its clocks across a failed call: a session is written off on evidence — its process exited, or a list that actually answered no longer names it — never because the daemon briefly could not look.
