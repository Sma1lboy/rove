---
"@sma1lboy/rove": patch
---

Rail-page cursors now stay on screen, and the Kanban board keeps its cards readable in a narrow window.

Worktrees, Routines, GitHub Issues and Kanban all moved a cursor with nothing following it, and Routines and Issues rendered their rows into a plain box with no scroll region at all — past the first screenful the selected row simply was not in the frame. All four now scroll the cursor row into view through one shared mechanism.

The board also decides its lane count from the width it actually has rather than the whole terminal's: at 100 columns four lanes left each card nine cells, less than the ten its date alone needs, so it now shows the single-lane view there. The wide layout is unchanged.

Routines: `enter` opens the latest run's task instead of the newest run that happened to create one — a healthy `skipped_precheck` used to open work from a different day. The "Ran X: dispatched" notice now clears when the cursor moves instead of sitting under the next routine as if it were its result; the GitHub Issues notice clears on a repo or filter switch for the same reason. Worktrees answers to `j`/`k` alongside the arrows, like every other list.
