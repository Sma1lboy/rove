---
"@sma1lboy/rove": patch
---

[cli] `npm install -g @sma1lboy/rove` works on Windows again. The package ran a repo-only check after install that could not exist in the published tarball; macOS and Linux swallowed the failure, but on Windows it failed the whole install and left a `rove` command pointing at an empty folder.
