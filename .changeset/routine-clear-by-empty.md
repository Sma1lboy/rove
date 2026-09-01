---
"@sma1lboy/rove": patch
---

Fix `rove api routine-update --precheck ''` and `--base-branch ''` so they actually clear the field instead of silently leaving it in place. Both flags are documented as "'' clears it", and the daemon already treats an empty value as a clear, but the CLI folded the empty string into "not passed" and dropped it before it reached the daemon — so the old value stayed. Passing an empty value now sends an explicit clear.
