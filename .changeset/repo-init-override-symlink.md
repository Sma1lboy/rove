---
"@sma1lboy/rove": patch
---

A repo init override set from one spelling of a repository path is now found from another. On macOS the git toplevel is spelled `/private/var/…` when resolved from a subdirectory but kept as the caller's `/var/…` at the root, so an override written at the root was silently dropped by `rove repo show` run from a subdirectory.
