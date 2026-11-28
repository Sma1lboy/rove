---
"@sma1lboy/rove": patch
---

[tui] Improve full-path pasting in the New task folder picker across Windows, Linux, and macOS: decode `file://` URIs, strip Windows `\\?\` / `\\?\UNC\` prefixes and quotes, unescape POSIX `\ `, preserve Windows backslash separators, list symlinked directories, and confirm exact pasted directories (even with a trailing separator or subfolders) on Enter.
