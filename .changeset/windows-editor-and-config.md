---
"@sma1lboy/rove": patch
---

`rove config` opens an editor on Windows, and the file tree's `enter` can too. Both went through a `sh` probe that Windows has no binary for, so `binaryAvailable()` caught its own spawn failure and reported every editor as missing — `rove config` then printed "no editor found — set $EDITOR" at users who had already set `$EDITOR` to an installed editor, which was the one action that could not help. The probe and both launch paths now use Git for Windows' bash, the shell Rove already runs every engine and terminal tab through, and paths interpolated into those command lines are converted to the MSYS form Git Bash understands (and converts back for Windows programs like `notepad`). POSIX behaviour is unchanged.
