---
"@sma1lboy/rove": patch
---

The worktree file-preview path guard now rejects Windows-separator escapes, not just their POSIX forms. `worktreeFilePath` — which every file preview and size read routes through — promised to reject absolute and `..`-escaping paths, but it only split on `/` and only caught a leading `/`, so on a local Windows host, where `\` is a path separator too, a `..\..\secret` segment, a `\`-rooted path, or a `C:\…` drive-absolute path all slipped past the guard and read outside the worktree. The check now treats `\` as a separator for the `..` and absolute-path tests while still assembling the result from `/`-segments, so the "relative, inside the worktree" contract holds on both operating systems and a POSIX filename that legitimately contains a backslash is passed through unchanged.
