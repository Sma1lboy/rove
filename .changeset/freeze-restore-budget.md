---
"@sma1lboy/rove": patch
---

A pty-host boot no longer deletes the scrollback it decided not to restore

`loadFrozenSessions` kept the 64 newest frozen sessions and `rmSync`'d the rest.
The cap's comment called 64 "several times any realistic number of open terminal
tabs"; a machine measured while writing this held 108 records / 69MB, and every
record past 64 was from the previous day's work — so the next host boot would
have permanently deleted 44 tabs' scrollback. The count grows with tab churn
over a host's lifetime, not with how many tasks you have: one long-lived task
cycling `tab-60`, `tab-63`, `tab-68` gets there on its own.

The cap is now a restore budget in bytes (`FREEZE_RESTORE_MAX_BYTES`, 64MB),
and a record past it is left on disk rather than deleted. It is also applied
*before* reading, off each file's mtime, which is what the old comment claimed
("bounds the boot read at ~32MB") and did not do — the 64-record cap ran after
every file had already been read, so a 400-record directory read 262MB to keep
32MB of it. Measured on seeded directories at the same mean record size: 108
records deleted 44 and now deletes 0; 200 deleted 136 and now deletes 0; 400
deleted 336 and now deletes 0. Load time was 10/17/33/82ms across those four
sizes and is now flat at ~13ms.

Only the 14-day TTL deletes now, and it reaches records the budget never reads,
so the directory is still bounded. A boot that defers or expires anything says
so in `pty.log` — a store that quietly loses scrollback was the actual harm.
