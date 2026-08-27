---
"@sma1lboy/rove": patch
---

Fix three user-visible bugs that tests had pinned in place (issue #62): `describeCron` now pluralizes all seven weekdays correctly (TUE/WED/THU/SAT rendered as "Tuedays"/"Weddays"/"Thudays"/"Satdays") and no longer double-qualifies interval schedules as "every day every 15m"; the web markdown renderer no longer double-escapes image alt text, so screen readers announce the original text instead of literal entities; and web error toasts render plain-object rejections as JSON instead of "[object Object]".
