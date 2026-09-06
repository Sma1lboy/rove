---
"@sma1lboy/rove": patch
---

A custom engine's protocol is now picked from a list, and shown on its row

Adding an engine through Settings asked for its protocol as free text, so a misspelt `cluade` failed validation, wrote nothing, and left an engine quietly running the generic adapter — no transcript reader, no account detection, no resume — with nothing on screen saying which one it got. The step is now the same picker the status and branch dialogs use: the built-in adapters plus a **None** row, so the generic adapter is chosen rather than mistyped, and `esc` abandons the add the way it already did on the id and command steps. Each custom engine's detection line now prints the protocol it borrows, `generic` included.
