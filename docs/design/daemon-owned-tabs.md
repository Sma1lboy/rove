# Daemon-owned terminal tabs

Status: shipped (replaces the per-client writes and the `terminalTab.peerSync`
relay of #1352).

## Problem

A task's terminal tabs (`TabsState`, `tui/workspace/terminal-tab-shapes.ts`)
were written by every process that touched them: each TUI (its in-memory
`tabsByTask` copy, flushed whole to the `terminalTabs.<taskId>` key of
state.json), the CLI verbs (`tab-new`, `tab-close`, `tab-split`, renames, a
locked read-modify-write of the same key), the bridge (tab reorder) and the
daemon when it ran a verb in-process. Each held its own copy and wrote all of
it, and each minted tab ids from its own `nextOrdinal`. With two clients on one
task that produced:

- a tab one TUI closed lingering in the other, and coming back on disk (and
  respawning a new engine) on the other's next write;
- a tab one client opened reaching the others only through the 2 s orphan
  poll, which adopted it with the wrong shape;
- two clients opening a tab at the same moment minting the same `tab-N`: two
  key presses, one tab, and a different order in each client.

## Rule

The daemon owns any state that several clients see. Clients send it
operations and render what it broadcasts; none writes the state itself.

## Design

- **Store** (`rove-daemon/src/daemon/tabs-store.ts`): the one writer of every
  task's tabs. Operations arrive over `tabs.apply` and are applied in order
  (one process, one thread). Every change bumps a store-wide revision and
  publishes the task's whole state on `tabs.changed`. Persistence is injected
  by rove (`state/tabs-persistence.ts`): the same `terminalTabs.<taskId>` keys
  of state.json, written debounced, so readers that parse state.json (CLI
  `get-task`, the bridge's tab feed, `inspect`) keep working. Records of tasks
  that no longer exist are swept at start; a task delete drops its record.
- **Operations** (`tabs-ops.ts`, pure, shared with the TUI): `seed` (only when
  no record exists), `open`, `patch` (named fields of a live row), `close`,
  `order`, `focus`, `meta`, `forget`. `diffTabs(before, after)` turns what a
  reducer produced into these, so the TUI keeps its reducers.
- **Ids from one counter.** `open` without an id mints `tab-N` from the
  store's counter. A client that must not wait (ctrl+t paints at once) holds
  ordinals the store reserved for it (`tabs.reserve`, a few at a time, refilled
  as they are spent, the unused tail given back with `tabs.release`). Reserved
  ranges are disjoint, so no two clients mint the same id.
- **Tombstones.** A closed id is remembered per task; `open` refuses it. A
  stale copy, or the orphan poll seeing a session that is still exiting,
  cannot bring a closed tab back.
- **Per-client state stays per client.** Which tab a client is looking at is
  its own; the store keeps the last focused one (`focus`) only as the start
  point for a fresh client or a restart.

## TUI

`tui-react/workspace/tabs-sync.ts` holds, per task, the last state the daemon
confirmed (highest revision wins: from `tabs.list`, a reply, or `tabs.changed`)
and this TUI's operations still in flight. It shows the in-flight operations
folded over the confirmed state, so a local change paints at once and the
daemon's version replaces it when it answers. Every writer (`TerminalTabs`'
`update`, the background writers for unmounted tasks, kanban's background
engine tab, the scratch fold) commits through it. A commit diffs against the
state the reducer started from, not the newest view, so a tab another client
added in the meantime is never read as closed. `tabsByTask` / `tabsRevision`
live here and are published only from the daemon-backed view. kv-core refuses
any local write of a `terminalTabs.*` key.

On attach (and after every reconnect) the TUI reloads all tasks' tabs with
`tabs.list`, since `tabs.changed` sent while the socket was down never arrived.

## CLI and bridge

Verbs that change tabs call `tabs.apply` (and `tabs.get` to read the current
state) instead of locking and rewriting state.json. `terminalTab.close` still
asks a mounted TUI to run its close flow (kill the PTY, plugin events); the
state change itself is the daemon's.

## Not covered

- `splitTree.activeLeafId` (which split pane is focused) is stored inside the
  shared row, so it is shared between clients. It is per-viewer in spirit;
  moving it out is a separate change.
- The bridge's tab feed still polls state.json rather than following
  `tabs.changed`.
