---
"@sma1lboy/rove": patch
---

Fix numstat rename parsing for paths containing literal braces

Switch `git diff --numstat` callers to `--numstat -z` so renames are emitted
as NUL-delimited old/new path pairs instead of brace-compacted `src/{old =>
new}` syntax. The brace form is inherently ambiguous when a path itself
contains `{` (e.g. `src/{a{b/f.txt`), which previously produced silently
wrong filenames. All three file-tree numstat consumers (working diff, cached
fallback, and branch-scope diff) now pass `-z`; the shared parser in
`src/lib/git-parsers.ts` no longer tries to split brace-compacted fields.
