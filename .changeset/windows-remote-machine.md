---
"@sma1lboy/rove": patch
---

A native Windows Rove can be registered with `rove machine add` from any other machine: its tasks show in the rail, terminals attach, and verbs, files and diffs run there. The hub relays to it over ssh whatever shell sshd starts (cmd or PowerShell), skips a PowerShell profile's output, and finds a `rove` missing from the ssh session's PATH in the usual Windows install folders.
