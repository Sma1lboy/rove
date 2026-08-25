---
"@sma1lboy/rove": patch
---

Extract the path-to-tree builder (`TreeNode`, `buildTree`, `sortTree`) from `filetree/git.ts` into a framework-free `filetree/tree.ts`. The tree builder has no git dependency and is consumed by both the file-tree pane and its React port. `filetree/git.ts` drops from 466 to 412 lines.
