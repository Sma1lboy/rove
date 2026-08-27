---
"@sma1lboy/rove": patch
---

Remove three daemon exports that had no production consumers (issues #46/#48): the `web-rpc-allowlist.ts` shim (web-server derives the same set from the handler registry directly), the unused `matchRepoByCwd` helper in `cwd-task.ts`, and the transitional `server-types.ts` re-export left over from a completed rename. The tests that only exercised these were removed with them; the web-exposure contract test still pins the browser-reachable RPC surface exactly.
