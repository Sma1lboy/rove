---
"@sma1lboy/rove": patch
---

Dictation fixes words the recognizer heard wrong, not only misspelled: a run that sounds like a term from the conversation becomes that term ("Jithub" → GitHub; a Chinese run is compared as pinyin). `"phonetic": false` in `~/.rove/voice/config.json` turns it off. The voice sidecar now runs from one environment, `scripts/voice/pyproject.toml`: `uv run --project scripts/voice scripts/voice/asr_server.py`.
