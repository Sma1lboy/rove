---
"@sma1lboy/rove": patch
---

refactor(tui-react): split host.tsx into cohesive seams

`host.tsx` was pinned at the 500-line file-size cap with zero headroom.
Extract three cohesive seams:

- `use-daemon-state.tsx` — all daemon signal subscriptions + derived
  engine overlays (`engineTabState`, `sidebarEngineState`).
- `use-editor-handles.tsx` — the three imperative TerminalTabs refs,
  the worktree identity guard, FileTree open actions, and Create-PR.
- `host-pages.tsx` — page-render decisions (`pageDeps`, full-window and
  content-page render calls, narrow-mode surface, settings standalone page).

Collapse `useWorkspaceKeybindings` deps around `HostPagesState` so the
host no longer threads ten individual page booleans.

No behavior change. `host.tsx` drops from 500 to 407 lines.
