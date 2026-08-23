---
"@sma1lboy/rove": patch
---

Add an Agent Topology page to the OpenTUI sidebar. Dagre lays out durable owner-to-subagent spawn edges from `dispatcher.taskId`, batch outlines group siblings from the same parallel launch by `groupId`, and task nodes show engine-normalized roles and live activity. Confirmed `rove api send` relationships render as directed message loops with separate card ports, filled sender diamonds, and target-bound open arrowheads; hovering a line inspects the bounded first-message preview, while selecting a node spotlights its traffic and names each sent/received peer. Left/right cycles and centers independent spawn roots.
