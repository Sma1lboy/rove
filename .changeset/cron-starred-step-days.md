---
"@sma1lboy/rove": patch
---

Routine schedules that step one day field from `*` while naming the other now fire only on days that match both, as in standard cron: `0 9 */2 * MON` runs on Mondays that fall on an odd date instead of on every odd date plus every Monday.
