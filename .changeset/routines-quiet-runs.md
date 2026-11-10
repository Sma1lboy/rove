---
"@sma1lboy/rove": patch
---

Routines are quieter: a standing-session routine sends its full prompt only when the session is new, revived or the prompt changed, a routine turn with nothing to report just ends without a "report missing" Inbox entry or holding the next run, and a routine turn that reported no longer adds a separate "turn finished" Inbox entry. A routine whose repo has been moved or deleted now shows up once in the Inbox as unavailable, instead of skipping every run silently when it has a precheck.
