---
"@sma1lboy/rove": patch
---

Keep file previews tied to the selected path. Filenames containing brackets, wildcards, or leading pathspec syntax now open only their own diff, including after a rename.

Show pure renames and empty-file additions or deletions in both single-file and combined diffs. Missing or unreadable text files report an error with the existing retry action, while valid empty files say so. Switching previews shows loading until that path's result arrives instead of displaying the previous file under the new title.
