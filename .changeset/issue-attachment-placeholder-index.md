---
"@sma1lboy/rove": patch
---

Pasting another screenshot or PDF into a story draft after deleting an earlier attachment line no longer reuses a label that still points at a different file. The draft body's next `images[N]`/`pdf[N]` index now continues past the highest index already present instead of counting the lines, so a draft edited to leave a gap keeps every attachment reference unambiguous when the prompt rides to the engine.
