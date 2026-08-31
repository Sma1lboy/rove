---
"@sma1lboy/rove": patch
---

Stop the sidebar's project list from growing rows nobody asked for.

Creating a task, adopting a worktree, or starting an issue chat used to mint a permanent `kind:"main"` project row for whatever path was involved — including test fixtures under `/tmp`, repos inside `.dev-sandbox`, and checkouts nested in Rove's own worktrees directory. Those rows were also unremovable: `task.delete` refuses a main row ("remove the repo from saved repos instead") while `rove remove` refuses a repo that was never in `savedRepos`, which is exactly the set they belonged to.

A single admission gate now decides what may become a project, applied inside `addSavedRepo` and the main-row coordinator so no caller can skip it. Inferred projects are held to a stricter rule than ones you name yourself: `rove add /tmp/scratch-repo` still works, while a task created against that same path no longer leaves a project row behind. The task itself is unaffected — it renders under a header derived from its own repo, which simply dies with it.

`rove .` in a git repo's root now opens that repo AS the project, instead of creating a throwaway directory session beside the project row it would later be promoted into. A subdirectory, a plain folder, or a repo at an ineligible path keeps the previous directory-session behaviour.

`rove add` also reports a refusal properly instead of printing "already saved" for a path it declined to store.
