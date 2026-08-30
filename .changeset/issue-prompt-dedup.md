---
"@sma1lboy/rove": patch
---

Story prompts: one implementation, and the sender's text stays last

The TUI and the web board each kept a hand-written copy of the prompt sent
when you start a session from a story, and the copies had drifted — the web
one interpolated the product name, the TUI one hard-coded "Rove". Both now
call one shared builder, so the same action sends the same text wherever you
start it.

The `[ROVE PEER]` and `[ROVE FIELD NOTE]` prefixes now put the sender's
message last and whole, after the provenance line, instead of splicing it
into the end of an English sentence. A non-English message reads as itself
and no longer drags the receiving agent's reply into English.
