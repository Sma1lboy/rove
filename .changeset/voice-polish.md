---
"@sma1lboy/rove": patch
---

Dictation: optional cleanup by a chat model, off by default. A `polish` block in `~/.rove/voice/config.json` sends each finished take to any OpenAI-compatible chat endpoint with yap's RecommendedPrompt and the conversation's terms: fillers go, "三次，不对，五次" becomes 5 次, spoken lists become lists. Live partials are never polished, and a failed call keeps the recognizer's text.
