---
"@sma1lboy/rove": patch
---

The web client can attach files up to 500 MB; the limit was 5 MB. A file over 1 MB is sent in parts, so a large upload no longer has to fit one message and the rest of the page keeps working while it goes. Dropping a large file on a terminal shows an "Uploading…" notice until its path is typed in.
