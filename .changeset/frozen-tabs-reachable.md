---
"@sma1lboy/rove": patch
---

After a pty-host restart, a task's real conversations are reachable and named

A reboot (or any pty-host restart) freezes every terminal tab: the session
record keeps its command, cwd and scrollback, and the host lists it. Three
verbs told a headless caller otherwise.

- `send --tab tab-N` refused a frozen tab with `TAB_NOT_FOUND` and pointed at
  `pty-list`, which lists that very tab. It now refuses with `TAB_RESTORED`
  and a hint, and `send --respawn` revives the tab in place and delivers into
  it — resuming its pinned conversation (`--resume <id>`) rather than
  replaying the task's first prompt. The respawn is never implicit: a tab
  with no pinned id would re-run its recorded launch command.
- `send` with no `--tab` fell through to a never-started tab, spawned a blank
  session and reported plain success while both real conversations sat
  frozen. It now lists them as `frozenTabs` (`tab` + `sessionId`) whenever it
  started a new session.
- `get-task` / `collect` now return each engine tab's `sessionId` — the id
  the engine's resume verb needs, persisted since engine tabs existed and
  exposed nowhere. The canonical `send` path also records the id of a session
  it just started, which the write-once snapshot seeding skipped: a tab
  respawned after a restart was pinned to a new conversation while the
  snapshot still named the previous one.
