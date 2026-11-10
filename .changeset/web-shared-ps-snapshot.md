---
"@sma1lboy/rove": patch
---

Opening the web page no longer stalls every other browser on the same host. Reading a task's tabs ran one `ps` per task, about 200 ms each on a machine with a thousand processes; a page load with 56 tasks ran 56 at once and held the bridge for up to 190 ms at a stretch. Reads that overlap now share one `ps`, so the same load holds it for 3 ms.
