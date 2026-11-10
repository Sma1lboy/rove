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

## Download

| Platform | File |
|---|---|
| macOS, Apple silicon | [Rove-mac-arm64.dmg](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-mac-arm64.dmg) |
| macOS, Intel | [Rove-mac-x64.dmg](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-mac-x64.dmg) |
| Windows | [Rove-win-x64.exe](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-win-x64.exe) |
| Linux | [Rove-linux-x86_64.AppImage](https://github.com/Sma1lboy/rove/releases/download/desktop/Rove-linux-x86_64.AppImage) |

Install the Rove CLI first: the app starts the `rove` it finds on this machine. The macOS
build is signed with a Developer ID and notarized. The Windows installer is not signed, so
SmartScreen asks once: **More info › Run anyway**.

These files live on one release, `desktop`, that is updated in place. A push to `main`
that touches `packages/rove-desktop` replaces the Windows and Linux files from CI. The
macOS files are replaced by hand, on a Mac that holds the Developer ID certificate:

```sh
ASC_KEY_ID=… ASC_ISSUER_ID=… packages/rove-desktop/scripts/release-mac.sh
```

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
Nothing found → a dialog with the install line and a file picker.

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

## Security posture

The renderer is an ordinary page: no preload, no IPC channel, `contextIsolation`
and `sandbox` on, `nodeIntegration` off. Navigation is locked to the bridge's own
origin — anything else opens in the browser. Permissions are default-deny except
notifications and the clipboard, and only for that origin. The page's URL carries
the pairing token; the app never logs it and never writes it down.

## Chords

The app adds no Rove chords — the page's keybindings are the keybindings, and the
menu carries only the platform's own (⌘Q, ⌘W, ⌘R, ⌘±, ⌘M). Closing the window
quits the app, which stops the bridge it started; the daemon is shared with the
TUI and keeps running.
