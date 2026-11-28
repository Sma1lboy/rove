# Desktop app

Rove in its own window: the rove-web client, the same daemon, the same tasks and
terminal sessions as the TUI. Nothing is reimplemented — the app starts the Rove
you already have installed (`rove --web --no-qr`) on a loopback port and loads
the page it prints.

The point of the wrapper is what a browser tab cannot give:

- **One window, own icon, no URL bar** — it reads as an app, not a tab you can
  lose.
- **It outlives the tab budget** — a browser that sleeps or kills a background
  tab takes your terminals with it; this window does not.
- **Native notifications** for the same events the page already announces.
- **Its own clipboard and focus**, so pasting images into a terminal does not
  compete with the rest of the browser.

What it deliberately does not do: it does not bundle the Rove CLI or the daemon.
The app is a shell — the Rove it drives is the one your TUI and phones drive, so
upgrading Rove upgrades the app's backend, and a task started here is in the TUI
the moment you switch.

## First launch

On a computer with no Rove, the app opens a small window with one button, **Install Rove**.
It runs the official installer (`curl -fsSL https://rove.run/install.sh | sh`; on Windows
`npm install -g bun @sma1lboy/rove`), shows what the installer prints, and opens Rove by
itself when it is done. A failed install keeps its output on screen with **Try again**. If
Rove is installed somewhere the app does not look, **choose the rove program…** points the
app at it.

With no session yet, the page then lists what a first task needs and fixes each one in place:

| Check | Fix on the page |
|---|---|
| A coding agent is installed | **Set up an agent** opens Settings › Engines, which lists each agent's program |
| An agent is signed in | **Sign in to …** opens a terminal running that agent's CLI, which asks for the login |
| A project is picked | **Pick a project** opens New session on its project menu |

The same checklist shows in a browser on `rove --web`.

## Download

| Platform | File |
|---|---|
| macOS, Apple silicon | [Rove-mac-arm64.dmg](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-mac-arm64.dmg) |
| macOS, Intel | [Rove-mac-x64.dmg](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-mac-x64.dmg) |
| Windows | [Rove-win-x64.exe](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-win-x64.exe) |
| Linux | [Rove-linux-x86_64.AppImage](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-linux-x86_64.AppImage) |

The app starts the `rove` it finds on this machine and offers to install it when there is none. The macOS
build, the dmg and the app in it, is signed with a Developer ID and notarized. The Windows installer is not signed, so
SmartScreen asks once: **More info › Run anyway**.

These files live on one release, `desktop`, that is updated in place. A push to `main`
that touches `packages/rove-desktop` replaces the Windows and Linux files from CI. The
macOS files are replaced by the **Desktop macOS release** workflow, started by hand from the
Actions tab (`gh workflow run desktop-mac.yml`). It runs from `main` in the `release-mac`
environment, which holds the Developer ID certificate and App Store Connect key as secrets and
waits for the owner's approval before it starts.

On a Mac that holds the certificate, the same script runs locally:

```sh
ASC_KEY_ID=… ASC_ISSUER_ID=… packages/rove-desktop/scripts/release-mac.sh
```

The script signs, notarizes and staples the app, then does the same to each dmg, and checks
both with Gatekeeper before it uploads. `--no-upload` stops after the checks.

## Build it

```sh
cd packages/rove-desktop
bun run build      # bundles the main process to dist/
bun run start      # build, then open it
bun run dist       # macOS .app + dmg under release/
bun run dist:linux # AppImage
bun run dist:win   # NSIS installer
```

`bun install` at the repo root downloads the Electron runtime
(`scripts/setup-electron.mjs`; Bun does not run Electron's own postinstall).

A build you package yourself with `bun run dist` is ad-hoc signed, not notarized: macOS
quarantines a copy of it that was downloaded, so either right-click the app and choose
**Open**, or

```sh
xattr -d com.apple.quarantine /Applications/Rove.app
```

The `Desktop` workflow packages the Linux and Windows builds, opens each packaged
app against a bridge on the runner, and on `main` uploads them to the `desktop` release. On Windows the app looks for `rove.exe` or
`rove.cmd` on `PATH`, in `%APPDATA%\npm` and in `~\.bun\bin`.

## Finding Rove

A macOS app launched from Finder starts with `/usr/bin:/bin`, not your shell's
`PATH`, so the app looks for `rove` in this order: a program you picked by hand
(**Rove › Set Rove program…**, saved in the app's user data), `ROVE_DESKTOP_BIN`,
this process's `PATH`, the usual install places (Homebrew, `~/.bun/bin`,
`~/.local/bin`, nvm, Volta, asdf), and finally `zsh -lc 'command -v rove'`.
Nothing found → the install window (see First launch). `ROVE_DESKTOP_INSTALL_CMD` replaces
the installer command, for testing that window without installing anything.

## Previewing against someone else's bridge

`ROVE_DESKTOP_URL` skips starting a bridge and loads that URL instead — useful
against the rove-web tunnel or a second machine:

```sh
ROVE_DESKTOP_URL=http://127.0.0.1:7890/#token=… bun run start
```

## Proving it works without a screen capture

```sh
ROVE_DESKTOP_SMOKE=/tmp/rove.png bun run start
```

The app loads the page, writes what it drew to that PNG, prints a one-line
summary (title, rail rows, terminal canvases), and quits. Which desktop space a
screen capture lands on is not something a script can count on.

## The log file

**Help › Show log file** opens `desktop.log` (macOS `~/Library/Logs/Rove/`, Linux and
Windows the app's user-data folder). It keeps the app's start, the `rove` it found,
bridge starts, exits and restarts, and once a minute the memory each of its
processes is charged with, in MB (`tab` is the page's renderer):

```
2026-11-07T21:56:11.482Z mem total=496MB main(92397)=39 gpu(92434)=260 utility(92435)=9 tab(92470)=119 bridge(92465)=69
```

On macOS that is the footprint (what Activity Monitor and the out-of-memory dialog
count, swapped and compressed pages included), on Linux resident plus swap, on
Windows Electron's working set without the bridge. A process past 2 GB gets its own
`WARN` line. The file rolls to `desktop.log.1` at 5 MB. Bridge tokens never reach it.

## Native side-panel browser and `rove api web`

Inside the desktop app, the side-panel Browser upgrades automatically from an `<iframe>` to a native Electron `WebContentsView`:

- **No iframe blocking** — sites sending `X-Frame-Options` or `CSP frame-ancestors` (as well as plain `http://` pages) render normally; only Rove's own bridge origin is refused.
- **Real Chromium navigation** — Back and Forward drive `WebContents.navigationHistory` across cross-origin links and redirects, syncing the address bar and tab label.
- **Persistent session** — browser tabs share the isolated `persist:rove-browser` partition, keeping logins and cookies across restarts without touching Rove's own bridge session.
- **Local agent automation and handoff** — the app serves an owner-only local IPC socket (`~/.rove/desktop-browser.sock`, or a named pipe on Windows; override via `ROVE_DESKTOP_BROWSER_SOCKET_PATH`) for `rove api web <tab|nav|snap|batch|eval|fetch|handoff>`. Agents in the same workspace can take compact accessibility snapshots (`snap --interactive --root @eN`), navigate, evaluate JS, run multi-step batches, fetch using the live session's cookies, and hand a live logged-in tab back and forth with the human (`tab handoff <id>` or the toolbar's **Hand to agent** / **Agent · Take control** button).

In browser-only `rove --web` mode (outside Electron), the side panel falls back gracefully to the existing `<iframe>` view and frame probe.

## Security posture

The renderer keeps `contextIsolation` and `sandbox` on with `nodeIntegration` off. Navigation on the main window is locked to the bridge's own origin — anything else opens in the system browser. A minimal sandboxed preload (`dist/preload.js`) exposes only the side-panel browser control methods to the main window, and every main-process IPC handler verifies that `senderFrame.url` matches the active local bridge origin. Embedded `WebContentsView` tabs run with no preload in the separate `persist:rove-browser` partition with restricted permissions. Permissions on the default session are default-deny except notifications and the clipboard, and only for the bridge origin. The page's URL carries the pairing token; the app never logs it and never writes it down. The local browser IPC socket is created `0600` inside `~/.rove`.

## Chords

The app adds no Rove chords — the page's keybindings are the keybindings, and the
menu carries only the platform's own (⌘Q, ⌘W, ⌘R, ⌘±, ⌘M). On macOS, ⌘W or the
red button closes the window only: the app stays in the Dock with its bridge
running, and a Dock click brings the window back. ⌘Q quits and stops the bridge
it started. On Windows and Linux, closing the last window quits. The daemon is
shared with the TUI and keeps running either way.

## Native terminal preview on macOS

From a checkout on macOS 14 or later with Xcode 26 and Swift 6.2 or newer installed, run:

```sh
bun run build
bun --filter @sma1lboy/rove-desktop native:preview
```

The preview opens the workspace in WebKit. The system window controls, sidebar toggle and workspace history sit together above the task list. Each terminal is a native libghostty surface, embedded through the pinned GhosttyTerminal Swift package. Ghostty renders the live PTY output with Metal and handles typing, composition, selection and scrolling. Selecting a task replays and attaches to its existing shell or engine process. The terminal follows the Rove workspace theme. Ghostty measures its scrollback budget in bytes, so the preview allocates 1 KiB per configured scrollback row. Closing the preview detaches the window and stops the bridge it started.

To use a particular local or sandbox bridge, set `ROVE_DESKTOP_URL` to its loopback pairing URL before starting the preview. The packaged desktop downloads continue to use Electron.
