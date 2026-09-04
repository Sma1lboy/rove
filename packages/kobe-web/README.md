# kobe-web

The `/harness` capture page: xterm.js over a PTY sidecar, running the **real**
OpenTUI. It is the one ground-truth surface for visual acceptance — screenshots
here are pixels the TUI actually drew, not a mock of it. See
[`docs/HARNESS.md`](../../docs/HARNESS.md).

This package used to be Rove's browser dashboard. That was removed: the TUI is
the product, and a second UI competing for the same surface cost more than it
returned. What remains exists to photograph the TUI.

## Two processes

`node-pty` doesn't work under Bun, so the page and the terminal are split:

- **Page** — React + TanStack Router, served by Vite (`:5173` by default).
  One route, `/harness`.
- **PTY sidecar** (`pty-server.mjs`) — a node process (`:5175`) running the
  TUI's PTY and serving its WebSocket.

A daemon is started too, because the TUI inside the PTY talks to one over its
unix socket — but nothing here serves daemon data to the browser.

## Develop

```bash
bun run dev            # both processes; opens http://localhost:5173/harness
bun run dev:sandbox    # same, pointed at a throwaway KOBE_HOME_DIR so the task
                       # index, daemon, and PTY host never touch real state
```

`bun run dev` connects to your production daemon and **production** `~/.rove`
data — the startup banner says which home it is wired to. Use `dev:sandbox`
when you don't want to mutate real tasks.

## Capture

```bash
bun run visual:serve                                    # warm servers + fixture
bun run visual:shot -- --out=/tmp/shot.png wait:1500    # one screenshot
bun run visual                                          # the Playwright suite
```

Set `KOBE_VISUAL_PORT_BASE` to run an isolated capture stack beside another.

## Test, lint, build

```bash
bun run test    # vitest — touches NO daemon; safe anytime
bun run check   # biome lint + format (gate this by exit code)
bun run build   # vite build → dist/
```

The repo-root `bun run lint` does NOT cover this package — run `bun run check`
here.
