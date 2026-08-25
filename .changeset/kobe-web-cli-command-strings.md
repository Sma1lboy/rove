---
"@sma1lboy/rove": patch
---

Derive kobe-web's user-facing CLI command strings from the build-time product name instead of hard-coding "rove". Affected prompts and hints in `lib/issues.ts`, `lib/review.ts`, `lib/terminal.ts`, and `lib/web-transport.ts` now use `ROVE_PRODUCT_NAME` so the legacy `kobe` wrapper is no longer mis-named in generated instructions.
