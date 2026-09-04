---
"@sma1lboy/rove-plugin-sdk": patch
---

`usage.context` joins the SDK's `DAEMON_CHANNELS`. The channel shipped in the
daemon but the published SDK never learned the name, so a plugin typed against
it could not subscribe — and the daemon drops unknown channel names from a
filter rather than rejecting them, so the subscribe succeeded and the channel
simply never arrived, with no error anywhere. Documented alongside the drop
behaviour in the SDK's channel list.
