---
"@sma1lboy/rove": patch
---

Add a `next` update channel: every merge to `main` now publishes to the `next` npm dist-tag after the fast checks, and `rove update --next` (or `install.sh --next`) follows it. Stable stays on `latest`, cut by hand; the nightly is unchanged.
