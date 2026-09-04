---
"@sma1lboy/rove": patch
---

`rove plugin link` / `install` create a plugin's config and state directories
0700, as the docs promise. They were 0755, and because `mkdirSync` never
chmods a directory that already exists, the CLI's mode won permanently — the
daemon's own 0700 could never take effect on a plugin the CLI had registered
first. The config directory is where the docs tell users to paste API keys.
