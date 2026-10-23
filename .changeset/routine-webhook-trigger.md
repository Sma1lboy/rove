---
"@sma1lboy/rove": patch
---

Routines can fire from a webhook. `rove api routine-update --id <id> --webhook` generates a secret. A POST to the web server's `/hooks/routines/<id>` signed with it (GitHub's `X-Hub-Signature-256`) then runs the routine right away instead of waiting for its schedule. The precheck still runs, with `ROVE_WEBHOOK_EVENT` and `ROVE_WEBHOOK_ACTION` set so it can filter, for example to opened issues only. The prompt starts with what fired it. With `--persistent-session`, every event lands in the same conversation. See the Routines docs for the GitHub setup.
