---
"@sma1lboy/rove": patch
---

Consolidate SidebarTree keybindings into one registration.

`SidebarTree.tsx` had grown six separate `useBindings` calls (main navigation,
move-mode escape, search mode, menu navigation, menu escape, jump). The
overlapping `enabled` flags and stack order made the real mode priority hard to
see, and the shared keys (`escape`, `enter`, `down`/`up`) were duplicated across
the bindings array. The same chords are now registered once through a dedicated
`useTreeBindings` hook that routes each press through explicit mode guards
(menu > search > move > main), keeping behavior identical while removing the
spaghetti growth.
