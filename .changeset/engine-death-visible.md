---
"@sma1lboy/rove": patch
---

Show engine deaths, and tell a rate limit apart from a crash

A killed engine used to be a UI no-op. The exit record (code, signal, the
403/quota text) was already written to `pty-exits.json`, but the only consumer
was the CLI: the observer folded the death into idle, so a dead tab rendered
identically to a shell that had never run anything. Deaths now reach the
sidebar and the tab strip as `†`, and land in the Inbox as their own episode.

The tab strip drew `rate_limited` and `error` with the same `!`, while the
sidebar has always drawn them apart — one tab, two surfaces, two answers. The
strip now uses the rail's own glyphs (`◷` rate limited, `†` dead), and a
rate-limited Inbox card shows when its auto-resume fires ("resumes 3:14 PM")
— a time the daemon has always persisted and nothing ever displayed.

Kimi can now classify its own failures, so a Kimi rate limit reaches
`rate_limited` (and arms auto-resume) instead of reducing to a generic error.
