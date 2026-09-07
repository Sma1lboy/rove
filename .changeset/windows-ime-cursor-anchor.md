---
"@sma1lboy/rove": patch
---

Put the IME composition window where you are typing on Windows. Windows Terminal draws the pinyin (and any other input-method) preedit and candidate list at the console cursor, and Rove left that cursor at the last cell it painted — the top of the sidebar — so the composition appeared far from the engine's input line. The cursor anchor that already fixed this on macOS now runs on Windows too: after every frame the hidden host cursor is parked on the focused terminal's cursor cell, so the IME window follows your typing.
