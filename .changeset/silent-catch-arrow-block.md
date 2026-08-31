---
"@sma1lboy/rove": patch
---

Teach the silent-catch gate two shapes it was letting through: a promise `.catch` with a block body (`.catch((err) => { console.error(...) })`) and the log function handed over bare (`.catch(console.error)`). The block form was the notable miss — the existing check keyed on the `catch` keyword, so a `.catch` method call with a brace never matched, and opening a brace to hold one log line is the most natural way to write the defect.
