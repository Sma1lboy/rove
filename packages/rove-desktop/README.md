# @sma1lboy/rove-desktop

The Rove desktop app: the rove-web client in its own window, driving the Rove installed on this
machine. Build, preview and security notes: [`docs/DESKTOP.md`](../../docs/DESKTOP.md).

```sh
bun run build   # bundle the main process
bun run start   # build, then open the app
bun run dist    # macOS .app + dmg under release/
```
