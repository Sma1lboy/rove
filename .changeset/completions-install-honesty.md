---
"@sma1lboy/rove": patch
---

`rove completions <shell> --install` no longer reports a hook it did not write. When your shell config already carried a completions block — a cache shim of your own, or a hand-rolled `# rove completions` line — the command (and the first-run wizard) printed "✓ completions hooked into ~/.zshrc" while leaving the file alone, which is exactly the case a user replacing their own shim needs an honest answer for. It now says the file was left untouched. Your block is still never edited: the only line rove rewrites in place is the live `source <(…)` line an older rove wrote itself.
