---
"@sma1lboy/rove": patch
---

Stop two `rove api send` deliveries into the same tab from merging into one message. Delivery is a sequence against one PTY — bracketed paste, a settle, then the submit key — and each send runs it from its own process with nothing serialising them, so two senders interleaved as paste A, paste B, Enter A, Enter B. The engine then held one composer containing both messages, submitted it on the first Enter, and the second Enter landed on an empty composer. Measured against a real PTY: two deliveries 50ms apart produced a single turn carrying both messages, 400ms apart produced two. In a fan-out round several workers report back to one coordinator tab at the same moment, which is why peer replies appeared to pile up unsent in the input area. Each delivery now holds a per-session lock across its paste and submit, and a delivery that cannot take the lock still writes rather than refusing.
