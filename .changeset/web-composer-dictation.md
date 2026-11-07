---
"@sma1lboy/rove": patch
---

The web New session composer has a `[ Say ]` button: the page records audio and the bridge op `voice.transcribe` sends it to an optional local Whisper sidecar (`scripts/voice/asr_server.py`), then inserts the transcript at the caret. A personal dictionary (`scripts/voice/dictionary.py`) boosts the terms you actually use and rewrites how the model mishears them, which is what makes zh/en code-switching dictation usable.
