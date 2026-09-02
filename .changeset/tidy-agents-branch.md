---
"@sma1lboy/rove": patch
---

Add an Agent Topology page to the sidebar rail (fourth row, `ctrl+a` `4`). Dagre lays out owner-to-subagent spawn edges from each task's recorded dispatcher, batch outlines group siblings from one parallel launch, and task nodes show engine-normalized roles and live activity. Confirmed `rove api send` deliveries are now recorded on the sender as bounded `communications` edges (target, count, last time, and a 160-character preview of the first message) and drawn as directed message lines; hovering a line shows that preview, and selecting a node spotlights its traffic. Left/right cycles between independent spawn roots.
