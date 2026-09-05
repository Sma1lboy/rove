---
"@sma1lboy/rove": patch
---

Acquire exclusive daemon home ownership before migrations and core initialization, and keep it through shutdown and pending writes. Competing sockets can no longer start two writers for the same home; crashed owners release their lease automatically.

Clean up orphaned terminal sessions using their observed generation so delayed sweeps cannot kill a newly started session. Keep unknown host or session liveness distinct from confirmed absence, and never borrow a sibling session's completion marker.

Serialize settings read-modify-write transactions across processes, including corrupt-file recovery, so independent settings changes survive concurrent writers.
