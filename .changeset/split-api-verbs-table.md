---
"@sma1lboy/rove": patch
---

Split the `rove api` verb registry out of `packages/kobe/src/cli/api/verbs.ts`.

`verbs.ts` had reached the 500-line file-size cap with no headroom for the next verb. The inline `VERBS` table is now split by domain into `verbs-read.ts`, `verbs-create.ts`, `verbs-drive.ts`, `verbs-edit.ts`, `verbs-lifecycle.ts`, `verbs-worktree.ts`, `verbs-feedback.ts`, and `task-statuses.ts`, while `verbs.ts` keeps the registry metadata, the `schema` handler, and the canonical concat. No verb schema, help text, or behavior changed.
