---
"@sma1lboy/rove": patch
---

Web on a phone turned sideways (or any screen under 500px tall): dialogs use nearly the full height instead of starting 12% down and stopping at 76%, and a long dialog's buttons (Kanban new story, new routine, …) stay pinned at the bottom while the form scrolls under them. Before, on a 667×375 phone the new-story drawer got 285px and its save buttons sat 330px below the fold. Dialog height on taller screens is unchanged.
