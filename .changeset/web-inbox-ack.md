---
"@sma1lboy/rove": patch
---

The web Inbox can clear "report missing" rows again: `d` (now labelled ack) and a new `[ ack all ]` button send the delivery id these rows are keyed by, so they no longer sit there for days. Those rows now read `report missing` instead of `error`, and every row's state and age line up on one right edge whether or not it has a reply button. F7 no longer tries to dismiss a pending decision.
