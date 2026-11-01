---
"@sma1lboy/rove": patch
---

On a phone, the web client's engine tabs get a message field under the terminal: type, dictate or paste (images and PDFs included) and Send pastes and submits it through the engine's own composer. The bridge gains `tab.send`. New session takes image and PDF attachments for the first message, and `/?prompt=…&repo=…` opens it with that draft prefilled, without starting anything.
