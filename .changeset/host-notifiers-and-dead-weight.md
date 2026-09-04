---
"@sma1lboy/rove": patch
---

Internal cleanup, no behavior change. The workspace host's five toast paths
collapse into one `useHostNotifiers` hook: two of them existed only as
hand-declared workarounds for hook ordering — each carrying a comment saying
so — because they needed `selectedId`, which a later hook produces. Passing
`selectedId` as a getter removes the constraint, and with it both workarounds
and a third notifier built inline in an argument list. Alongside it, seven
exports whose only reference was inside their own file lose the `export`
keyword, `product.ts` loses two unused imports, and the one message key
nothing renders (`worktrees.row.linkedTask`) is deleted from both locales.
