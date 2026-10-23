# Daemon-owned shared state

Status: shipped (`state` channel, daemon-owned machine hub).

## Rule

The daemon distributes every piece of state that more than one client shows.
A client never keeps a boot-time copy of shared state: it renders what the
daemon pushes and sends changes the daemon can see. Same rule as
[daemon-owned tabs](./daemon-owned-tabs.md).

## The `state` channel

Most shared settings live as keys of `state.json`. Every writer (CLI verbs,
the TUI's kv flush, the bridge, the daemon itself) already writes them with a
locked fresh-read merge of only the keys it changed (`state/store.ts`), so
writers do not lose each other's keys. What was missing was distribution: the
TUI's kv layer read the file once at start, so a change made from a shell,
the web or a phone stayed invisible until restart, and a TUI writing a whole
list key from its stale copy could erase it.

- `rove-daemon/src/daemon/state-watcher.ts` stat-polls the file and publishes
  it whole (minus `terminalTabs.*`, which the tab store publishes, and
  `lastActive.taskId`, which every task switch writes and only boot reads) on
  `state` after every change, whoever made it. The last value replays to a late
  subscriber.
- The TUI's kv core follows it (`kv-core.ts` `follow`, wired in `host-boot.tsx`
  `UiPrefsSync`): pushed keys replace the snapshot, this process's unflushed
  keys win until they land.
- Headless readers (CLI, bridge ops, the daemon) already read the file per
  call and need nothing.

## Inventory

Class (a) = shared, the daemon distributes it. Class (b) = legitimately per
client. "Before" is how a running client saw another process's change.

| State | Where | Before | Now | Class |
|---|---|---|---|---|
| Registered machines + live remote tasks | `machines` key; `MachineHub` in each TUI and bridge | read once at client start | daemon hub, `machines` channel | a |
| Saved repos, project rows | `savedRepos`; `kind:"main"` tasks | rail from daemon tasks; picker and bridge read per call | unchanged, already live | a |
| Repo settings, remote repos | `repoConfigs`, `remoteRepos`, `repoPrimary` | read per call | unchanged | a |
| A repo's last engine, default engine | `lastActiveVendor.*`, `defaultVendor` | read per call; Settings dialog seeded once | `state` push | a |
| Engine settings | `customEngineIds`, `disabledEngineIds`, `engineCommand/Name/Protocol.*`, `autoRouting.*` | TUI kv snapshot, whole-key writes from it | `state` push | a |
| Diff review notes | `diffComments.<taskId>` | TUI kv snapshot; TUI write erased notes the phone added | `state` push | a |
| Visual and notification prefs | `appearance.*`, `notifications.*`, `chat.tabStrip.*` | theme/mode/accent/locale live (`ui-prefs`), the rest kv snapshot | `state` push | a |
| Editor, worktree base, scrollback, live-session cap, experiments, release channel | `editor.*`, `worktree.*`, `terminal.*`, `engine.*`, `experimental.*`, `update.channel` | read per call; Settings view kv snapshot | `state` push | a |
| Pins, rail order, task status/labels, active task | task records | daemon RPCs (`task.*`) | unchanged | a |
| Terminal tabs | `terminalTabs.*` | daemon tab store | unchanged | a |
| Inbox items, gates, issues, routines | daemon stores | daemon RPCs + channels | unchanged | a |
| Keybindings | `settings/keybindings.yaml` | daemon `keybindings` ping | unchanged | a |
| Plugins | `plugins.json` | daemon plugin runtime watches it | unchanged | a |
| First-party mods installed | `builtin-mods.json` | read when the Plugins section opens | unchanged; gap noted | a |
| Inbox visit log (RECENT order) | TUI `inboxVisits`; web, iOS, Android each their own | per client | TUI copies follow changed remote visits, suppressing identical local-write echoes; web and phones keep their own | b for now |
| Rail sort, project filter | `activeSortMode`, `tasksPane.projectFilter`; web localStorage | seeded once per host | unchanged: following another session's sort is a product call (`use-sidebar-host-state.tsx`) | b |
| Rail fold/width, zen, split style, key hints, keys legend fold | `sidebar.*`, `zen.active`, `hints.*`; web localStorage | per window | the kv core keeps `sidebar.collapsed`, `sidebar.width`, `zen.active` per window when following | b |
| Web selection, rail width, collapsed projects; phone tab marks | browser localStorage, UserDefaults, SharedPreferences | per device | unchanged | b |
| Onboarding and version bookkeeping | `app.*`, welcome keys | per machine CLI | unchanged | b |
| Secrets, bridge auth | `secrets.json`, `~/.rove/bridge/` | local only | unchanged | b |

## Machines

The machine hub (`rove/src/machines/hub.ts`) runs in the daemon
(`daemon-hub.ts`, through the runtime adapter's `startMachineHub`). It follows
the registry on the `state` channel and publishes, whole, on `machines`: each
machine's connection state, its tasks stamped with their origin, and the engine
state, worktree changes and token chips its daemon pushes. Clients
(`machines/feed.ts`) merge that with their local tasks and hold no connection.
Remote verbs and terminals use the machine's local socket paths, which the
daemon's tunnel keeps up.

The hub runs only while some client subscribes to `machines`, and stops 15 s
after the last one leaves. A hub connects to another machine's daemon as a
`gui` (so that daemon stays up while someone looks) but without `machines` in
its channel filter, so two machines registered to each other never keep each
other's hubs, and daemons, up.

## Not covered

- A push that left the daemon just before this TUI flushed a key can show the
  older value for one push interval (~300 ms) until the push of the flush
  arrives.
- Writes still go to the file, not over an RPC: a CLI verb must keep working
  with no daemon running, and the file lock already serializes writers.
