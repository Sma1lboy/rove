---
"@sma1lboy/rove": patch
---

Refactor plugin-cmd boundaries and remove another hard-coded CLI name.

- Move `resolveActiveTaskId` from `cli/api/runtime.ts` to `cli/daemon-session.ts` and have `plugin-cmd.ts` import it from the session layer instead of reaching across the API boundary.
- Extract `findByLongestPluginPrefix` to remove the duplicated dotted-plugin-id resolution logic in `invokeAction` and `resolvePaneQualified`.
- Default `missingBunMessage()` to `activeCliName()` instead of the hard-coded `"rove"`.
