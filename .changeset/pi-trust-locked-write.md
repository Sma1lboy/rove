---
"@sma1lboy/rove": patch
---

Starting several pi tasks at once no longer leaves some of them stuck on pi's "Trust project folder?" prompt. Each Rove process used to read pi's trust file, add its own worktree and write the whole file back, so two starting together could drop each other's entry or leave the file half-written. The write now goes through the same lock and atomic replace the other engines' trust files use.
