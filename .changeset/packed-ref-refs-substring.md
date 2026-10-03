---
"@sma1lboy/rove": patch
---

Read a worktree's packed refs correctly when the checkout's own path contains a `refs` substring.

Match packed refs by ref name so paths such as `prefs/` no longer make existing refs appear absent to the base-ref and behind-count caches.
