---
"@sma1lboy/rove": patch
---

Dictation learns its vocabulary from the conversation: the bridge hands the sidecar the session's recent messages, and their identifiers, file names and product names steer the recognizer and fix the English it splits or misspells ("Graph, Q, L" → GraphQL). Chinese comes back in Simplified script. `~/.rove/voice/config.json` can switch to Whisper turbo or any OpenAI-compatible transcription endpoint (OpenRouter's provider-specific vocabulary fields included). `scripts/voice/bench.py` scores any of them on 82 code-switched key terms. `scripts/voice/dictionary.py` is gone; its terms move into `~/.rove/voice/vocab.json` on first use.
