---
"@sma1lboy/rove": patch
---

Internal: narrow 146 module-private symbols from `export` to file scope and drop 50 barrel re-exports nobody imported, so `bun run knip` reports no unused exports or types. Genuinely dead code is detectable from now on instead of being buried in noise. `knip.json` now treats every test file as an entry point, which is what made the cross-file consumers visible — the previous `*.test.ts`-only pattern hid test helper modules and produced false "unused" reports.
