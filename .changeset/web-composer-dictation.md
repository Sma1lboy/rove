---
"@sma1lboy/rove": patch
---

The web New session composer has a `[ Say ]` button: the page records audio and the bridge op `voice.transcribe` sends it to an optional local Whisper sidecar (`scripts/voice/asr_server.py`), then inserts the transcript at the caret.
