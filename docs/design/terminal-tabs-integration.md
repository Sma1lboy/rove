# Why `TerminalTabs.tsx` is not split further

`packages/kobe/src/tui-react/workspace/TerminalTabs.tsx` sits at ~495 lines, close to the repo's file-size cap. It has been reviewed twice for further splitting; both reviews concluded that the remaining code is intrinsic integration glue and should stay where it is.

This document records that decision and the analysis behind it so the next reader does not repeat the same investigation.

## What is already extracted

The file is an integration layer. The substantial pieces are already in their own modules:

- **Sub-components**
  - `TerminalSplit` — splits one tab into multiple PTY leaves
  - `TabStrip` — the tab selector strip above the terminal
  - `PreviewScreen` — read-only diff/preview content tabs
- **Core state machine**
  - `terminal-tabs-core.ts` — pure tab CRUD, cycling, rehydration, spawn building
- **Lifecycle hooks**
  - `useTabClose`
  - `useTabDialogs`
  - `useTabHandoffs`
  - `useTabHydration`
  - `useTabNaming`
  - `useTabRequests`
  - `useTabTurnState`

That leaves `TerminalTabs.tsx` as the wiring layer: it owns the shared `TabsState`, the `update()` function, the latest-value refs (`propsRef`, `stateRef`, `updateRef`), and the render that assembles the sub-components above.

## Candidate seams and why they were rejected

### 1. Spawn resolution (`pinSession`, `engineTabSpawn`, `activeSpawn`, `resetToken`)

This looks like a real seam: "what command/input should the active tab spawn with" is a single concern.

However, extracting it would not create a clean boundary:

- `pinSession` is consumed by the close path (`useTabClose`) and by the `ctrl+t` new-tab binding.
- `engineTabSpawn` is consumed by the handoff path (`useTabHandoffs`) and must be wrapped in a ref so a mount-once effect can read the latest version.
- `activeSpawn` is consumed only at render time, but it reads `active`, `state`, and `props` together.

A `useTabSpawn` hook would return roughly: `pinSession`, `engineTabSpawnRef`, `activeSpawn`, `resetToken`, and `bumpResetToken`. The caller would still pass refs and callbacks for almost every dependency. The estimated saving is only ~30–40 lines, while the new module would be ~60–70 lines of similar glue.

### 2. Keybindings wiring

The `useBindings` blocks that wire `chat.tab.new`, `chat.tab.chooseEngine`, `chat.tab.close`, etc. could be moved to a `useTerminalTabsBindings` hook.

The problem is the parameter surface: it would need `state`, `update`, `requestNewChat`, `requestRename`, `tabClose.closeActive`, the preferred-vendor resolver, and several props. That is not a state boundary; it is just moving a parameter list into another file.

## What a clean seam looks like (contrast)

`host.tsx` was successfully split in PR #537 because it had three real state boundaries:

- `use-daemon-state.tsx` — daemon signal subscriptions and derived overlays
- `use-editor-handles.tsx` — imperative handles handed up by `TerminalTabs` and consumed by `FileTree`/keybindings
- `host-pages.tsx` — page-render decisions and layout state

Each extracted unit owned a coherent slice of state and the effects that served it. `TerminalTabs.tsx` no longer has a slice like that; the remaining code is the connection tissue between already-extracted slices.

## Conclusion

`TerminalTabs.tsx` is an integration component at its natural size. Further extraction would shuffle glue without reducing complexity. Keep it intact unless a future change introduces a new, coherent state boundary.

*Reviewed independently by two agents on 2026-08-25; both reached the same conclusion.*
