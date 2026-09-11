---
"@sma1lboy/rove": patch
---

The New task dialog's repo field now finds a repo by name even when it was never saved, as long as it sits beside one that was. Saved repos cluster under a few parent directories, and typing `rove` used to be handed to validation as the literal text `rove`, which failed with "path does not exist" unless the name was already in the list. The field now looks for a same-named git checkout under each saved repo's parent directory before giving up; one hit resolves to that path, two hits under different parents are refused the same way two saved repos sharing a name are, and no hits still fall through to the old error. A repo reached through the directory browser is remembered in the saved list on creation, so it is offered by name the next time the dialog opens.
