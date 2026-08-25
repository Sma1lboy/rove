---
"@sma1lboy/rove": patch
---

A scratch shell or directory task opened inside a git repo is now named by its
branch, like every other row, instead of always showing its path. The label
rule was already branch-first; only `main` rows ever looked the branch up, so
a directory task — which stores no branch of its own — could never satisfy it.
Directories that aren't repos still fall back to the path.
