---
"@sma1lboy/rove": patch
---

Consolidate duplicated logic across `tui/` and `tui-react/`.

- Replace the near-duplicate `formatAgo` in `settings-dialog/plugins-core.ts` with the existing `relativeAgeMs` from `tui/history/message-core`.
- Remove `openExternalUrl` from `update-page.tsx`; route release-page opens through `lib/open-external.ts`.
- Introduce `lib/spawn-detached.ts` and use it in `lib/open-external.ts`, `tui/panes/filetree/open-external.ts`, and the two plugin fire paths in `tui-react/workspace/`.
