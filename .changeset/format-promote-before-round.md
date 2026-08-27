---
"@sma1lboy/rove": patch
---

Byte sizes and relative times each render through one shared helper now, instead of per-screen copies that had drifted apart. `rove doctor` no longer shows sizes just under a unit boundary as "1024.0 KB" — they roll over to "1.0 MB", and gigabyte-scale sizes finally say GB — and the web transcript's token counter promotes to "1.0m" the moment the k rendering would round up to "1000.0k".
