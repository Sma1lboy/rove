---
"@sma1lboy/rove": patch
---

Housekeeping with no behaviour change: eight npm packages left behind when the board's drag-and-drop and the TanStack devtools panels were removed are gone from `kobe-web`, along with the unused `kobe-web` workspace devDependency and `lucide-react` in `kobe-docs`. The four `@deprecated` internal compatibility aliases (`kobeCliInvocation`, `kobeStateDir`, `kobeSettingsDir`, `createExternalStore`) are deleted and their ~90 call sites now name the survivors directly. The five per-pane React mock hosts and eight duplicate dev scripts — one of which pointed at a file that no longer existed — are removed; `dev:mock` and `src/tui-react/mock/host.tsx` stay.
