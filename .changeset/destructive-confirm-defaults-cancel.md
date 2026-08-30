---
"@sma1lboy/rove": patch
---

Destructive confirms no longer arm the destroy button

Every confirm dialog used to open with the cursor on the confirm button, so a
single stray Enter on "Force delete worktree?" — the one that warns
uncommitted work will be PERMANENTLY LOST — destroyed it. The `initialActive`
escape hatch existed but no caller used it.

Confirm dialogs now understand `danger`, modeled on the context menu's
`danger` flag: destructive confirms (task delete and force delete, worktree
delete and force delete, issue delete, routine delete, reset UI state) open
with focus on Cancel, and their confirm button is drawn in the error color.
Plain confirms — quit, restart backend, land branch, and the dismiss-only
"that input is invalid" notices — keep confirm-first focus.
