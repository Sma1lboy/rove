---
"@sma1lboy/rove": patch
---

A machine registered without a key file comes back after this computer restarts. Rove now offers its own key (`~/.rove/ssh/hub_ed25519`) to such a machine when it has one; before, the machine stayed offline with "Permission denied" once ssh-agent was empty. In the web composer's machine menu, Auto is now the first row.
