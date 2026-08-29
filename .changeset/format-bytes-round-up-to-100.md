---
"@sma1lboy/kobe": patch
---

Fix byte sizes just under 100 rendering as "100.0 KB" instead of "100 KB". `formatBytes` chose integer-vs-decimal precision from the raw quotient, but a value in the [99.95, 100) range prints as "100.0" once `toFixed(1)` rounds it up — a three-digit magnitude carrying a decimal, the exact shape the "drop the decimal at 100" branch exists to prevent. Precision is now decided from the string that actually renders, so the file-preview pane and `kobe doctor` show "100 KB"/"100 MB" at that boundary while still rounding the raw value once (no double rounding at unit edges).
