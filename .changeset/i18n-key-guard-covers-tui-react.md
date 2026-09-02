---
"@sma1lboy/rove": patch
---

The Kanban card's activity badge showed the raw key `tasks.status.working` instead of "working" while a linked task's engine was mid-turn, crowding the card's created date off the row. The badge now points at `tasks.activity.working`, which exists in both locales, and the pages that showed `common.loading` while their data loaded render a real string too. The CI guard that catches an i18n key missing from every catalog only walked `src/tui`, so the whole React UI could ship keys with no catalog entry — it now scans `src/tui-react` as well, and reads `labelKey:` lookup tables, which is how the Kanban badge slipped past a literal-only scan.
