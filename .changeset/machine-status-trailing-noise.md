---
"@sma1lboy/rove": patch
---

A machine whose shell prints a line AFTER a command no longer reads as a broken daemon. Registering a remote runs `rove daemon status --json` over ssh and reads the JSON out of the reply, and a non-interactive login prints on the way out as readily as on the way in — an rc-file echo, a "you have mail". Rove already skipped a banner printed BEFORE the JSON, but the parse then ran to the end of the output, so a single trailing line made `JSON.parse` throw and the healthy machine reported "could not read a daemon status" (BAD_STATUS / NO_DAEMON). Rove now extracts just the first brace-balanced object, tolerating noise on both sides, so the status is read whatever the shell prints around it.
