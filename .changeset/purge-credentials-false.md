---
"@sma1lboy/rove": patch
---

`rove remove <ssh-key> --purge-credentials=false` no longer deletes the remote project's SSH password from the OS keychain. Any `--purge-credentials=<value>` used to count as "purge", so the explicit opt-out did the irreversible delete; `=true/1/yes` and `=false/0/no` now mean what they say, and any other value exits 2 with the usage text before the project is forgotten.
