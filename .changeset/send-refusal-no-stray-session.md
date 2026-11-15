---
"@sma1lboy/rove": patch
---

A `rove api send` that is refused as an empty-branch `succeeded:` report no longer leaves a new, empty session behind when it was addressed to a project row with no tab open; the session is opened only once the send is allowed through.
