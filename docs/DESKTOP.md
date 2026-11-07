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

## Build it

```sh
cd packages/rove-desktop
bun run build      # bundles the main process to dist/
bun run start      # build, then open it
bun run dist       # macOS .app + dmg under release/
```

`bun install` at the repo root downloads the Electron runtime
(`scripts/setup-electron.mjs`; Bun does not run Electron's own postinstall).

The packaged build is ad-hoc signed, not notarized: macOS quarantines a downloaded
copy, so either right-click the app and choose **Open**, or

```sh
xattr -d com.apple.quarantine /Applications/Rove.app
```

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
