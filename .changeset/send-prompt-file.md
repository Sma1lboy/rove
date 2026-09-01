---
"@sma1lboy/rove": patch
---

`rove api send`, `add`, and `dispatch` accept `--prompt-file PATH` (`-` = stdin) as an alternative to `--prompt`. A message that names a reply command in backticks used to be eaten by the shell — inside double quotes `` `rove api send …` `` is command substitution, so the receiver got that command's output instead of the words, and single quotes would have blocked `$ROVE_TASK_ID`. Reading the text from a file sidesteps every quoting rule; the Rove skill now routes any prompt with backticks, `$vars`, or quotes through a heredoc on `--prompt-file -`.
