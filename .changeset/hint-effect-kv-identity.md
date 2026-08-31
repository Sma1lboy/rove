---
"@sma1lboy/rove": patch
---

Fix the workspace crashing with "Maximum update depth exceeded" on boot.

The previous fix gave the status hint row's effect a dependency array, but `kv` was one of the dependencies. `KVProvider` rebuilds its context value from a `useMemo` keyed on the kv snapshot, so every `kv.set` anywhere in the app — tab adoption recording a task's tab list, a pane marking a hint used — hands the hook a brand-new `kv` object. That re-ran the effect on all of them, which is the same "runs on every render" the array was added to stop: `setSnapshot` re-renders the footer, the sidebar rows under it remount, `useBindings` bumps the stack version, the rows write kv again. Opening a workspace with a batch of tasks closed that loop and React tripped its update-depth guard before the pane finished painting.

The effect now reads the hints-enabled flag during render and depends on that boolean instead of the `kv` object, so an unrelated write no longer invalidates it.
