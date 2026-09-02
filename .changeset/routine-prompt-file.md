---
"@sma1lboy/rove": patch
---

`rove api routine-create` and `routine-update` take `--prompt-file` (`-` = stdin), the same escape hatch `send` and `add` have for a prompt with backticks, `$vars` or quotes. Optional `--prompt` flags no longer claim to be "required unless --prompt-file is given" in `--help`.
