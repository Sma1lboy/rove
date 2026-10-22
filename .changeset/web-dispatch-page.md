---
"@sma1lboy/rove": patch
---

The web client has a Dispatch page: every prompt one session hands another (`rove api send`, `api dispatch`, `api add` from an agent, a routine firing) shows as a lane an ASCII courier runs from sender to target, then waits, works, asks or fails there as the target's engine reports. The daemon keeps each dispatch's progress in a new `dispatch.snapshot` channel, so a page opened mid-flight still sees what is on its way.
