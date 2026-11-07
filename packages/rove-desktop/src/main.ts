/**
 * The desktop app: one window on the rove-web client, driven by the Rove the owner already has
 * installed (`bridge.ts` spawns `rove --web` on loopback). No client code lives here — the page,
 * the daemon and the terminal are the ones the TUI and the phones use.
 *
 * Renderer stays a plain page: no preload, no IPC, `contextIsolation` on, navigation locked to the
 * bridge's own origin, everything else handed to the browser.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app, dialog, screen, session, shell } from "electron"
import { type Started, findRove, redact, rememberRove, start } from "./bridge"

const APP_NAME = "Rove"
/** The page's own paper colour, so the first frame is not a white flash. */
const PAPER = "#141413"
const DOCS_URL = "https://docs.rove.run"

/** Boot-time breadcrumbs on stderr: a Finder launch has no terminal, so this is for `bun run start` and bug reports. */
const log = (message: string): void => console.error(`[rove-desktop] ${message}`)

let bridge: Started | null = null
let win: BrowserWindow | null = null
let quitting = false

const binFile = () => join(app.getPath("userData"), "rove-binary.txt")
const stateFile = () => join(app.getPath("userData"), "window.json")

interface Bounds {
  readonly x?: number
  readonly y?: number
  readonly width: number
  readonly height: number
  readonly maximized: boolean
}

/** The window the owner left, unless its display is gone (a docked laptop, a closed lid). */
function savedBounds(): Bounds {
  try {
    const saved = JSON.parse(readFileSync(stateFile(), "utf8")) as Partial<Bounds>
    const width = Math.max(900, Math.round(saved.width ?? 1440))
    const height = Math.max(600, Math.round(saved.height ?? 900))
    const visible =
      typeof saved.x === "number" &&
      typeof saved.y === "number" &&
      screen
        .getAllDisplays()
        .some(
          ({ workArea: a }) =>
            saved.x! >= a.x - 40 && saved.x! < a.x + a.width && saved.y! >= a.y - 40 && saved.y! < a.y + a.height,
        )
    return { ...(visible ? { x: saved.x, y: saved.y } : {}), width, height, maximized: saved.maximized === true }
  } catch {
    return { width: 1440, height: 900, maximized: false }
  }
}

function rememberBounds(window: BrowserWindow): void {
  const write = () => {
    const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
    const next: Bounds = { ...bounds, maximized: window.isMaximized() }
    try {
      writeFileSync(stateFile(), `${JSON.stringify(next)}\n`, "utf8")
    } catch {
      // A full disk must not take the window down; the next launch just uses the defaults.
    }
  }
  window.on("resized", write)
  window.on("moved", write)
  window.on("maximize", write)
  window.on("unmaximize", write)
}

/** Only the bridge's own origin may ask for anything; everything else is a browser's job. */
function lockDown(origin: string): void {
  const ours = (url: string | undefined): boolean => {
    if (!url) return false
    try {
      return new URL(url).origin === origin
    } catch {
      return false
    }
  }
  // Notifications and the clipboard (image paste) are the page's; the rest is denied.
  const allowed = new Set(["notifications", "clipboard-read", "clipboard-sanitized-write"])
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowed.has(permission) && ours(details.requestingUrl))
  })
  // `requestingOrigin` arrives as a URL (`http://127.0.0.1:port/`), not a bare origin: compare parsed.
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed.has(permission) && ours(requestingOrigin)
  })
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (!ours(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
  })
}

function createWindow(started: Started): void {
  const bounds = savedBounds()
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: PAPER,
    show: false,
    // The page draws its own chrome edge to edge; keep the system title bar for a native feel and a
    // drag handle above the rail.
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  })
  if (bounds.maximized) win.maximize()
  lockDown(started.origin)
  win.once("ready-to-show", () => win?.show())
  // A page that never finishes loading must not stay an invisible process: show it anyway and let
  // the page's own connection banner say what is wrong.
  const fallback = setTimeout(() => win?.show(), 5_000)
  win.once("closed", () => clearTimeout(fallback))
  win.webContents.on("did-fail-load", (_event, code, description) => log(`page failed to load: ${code} ${description}`))
  if (process.env.ROVE_DESKTOP_DEBUG) {
    win.webContents.on("console-message", (event) => log(`page: ${event.message}`))
  }
  smokeTest(win)
  // Close means quit: the bridge is this app's child, and a hidden window with a live bridge is a
  // process the owner cannot see. (The daemon itself is shared with the TUI and outlives us.)
  win.on("closed", () => {
    win = null
    if (!quitting) app.quit()
  })

  /**
   * `ROVE_DESKTOP_SMOKE=<png>`: load the page, save what it drew, print the facts a person would check,
   * and quit. `ROVE_DESKTOP_SMOKE_TASK=<n>` opens the nth rail row first, so the capture shows a real
   * terminal painting rather than the empty workspace. The honest test of this shell — real window,
   * real page, real daemon — without a screen capture that depends on which space is in front.
   */
  function smokeTest(window: BrowserWindow): void {
    const target = process.env.ROVE_DESKTOP_SMOKE
    if (!target) return
    const task = Number(process.env.ROVE_DESKTOP_SMOKE_TASK ?? "")
    window.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        const open = Number.isInteger(task) && task > 0
        void window.webContents
          .executeJavaScript(
            open
              ? `(() => {
                  const rows = [...document.querySelectorAll("[data-rail-body] button")];
                  rows[${task - 1}]?.click();
                  return "clicked ${task}";
                })()`
              : `"no task"`,
          )
          .then(() => new Promise((resolve) => setTimeout(resolve, open ? 9_000 : 0)))
          .then(() =>
            window.webContents.executeJavaScript(
              `JSON.stringify({
            title: document.title,
            rail: document.querySelectorAll("[data-rail-body] button").length,
            terminals: document.querySelectorAll(".xterm").length,
            canvases: document.querySelectorAll(".xterm canvas").length,
            rows: document.querySelectorAll(".xterm-rows div").length,
            dpr: window.devicePixelRatio,
            text: (document.body.innerText || "").slice(0, 160),
          })`,
            ),
          )
          .then(async (facts: string) => {
            const image = await window.webContents.capturePage()
            writeFileSync(target, image.toPNG())
            log(`smoke: ${facts}`)
            log(`smoke: wrote ${target}`)
          })
          .catch((err: unknown) => log(`smoke failed: ${redact(err instanceof Error ? err.message : String(err))}`))
          .finally(() => app.quit())
      }, 6_000)
    })
  }

  rememberBounds(win)
  void win.loadURL(started.url)
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === started.origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

/** Shown instead of a blank window when the app cannot reach Rove at all. */
function explain(text: string, buttons: string[], message = "Rove could not start."): Promise<number> {
  const options = {
    type: "warning" as const,
    title: APP_NAME,
    message,
    detail: text,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  }
  return win
    ? dialog.showMessageBox(win, options).then((r) => r.response)
    : dialog.showMessageBox(options).then((r) => r.response)
}

/** A file picker for the `rove` binary; a Finder-launched app has no login PATH to search. */
async function chooseBinary(): Promise<string | null> {
  const picked = await dialog.showOpenDialog({
    title: "Choose the rove program",
    message: "Pick the rove executable (usually ~/.bun/bin/rove or /opt/homebrew/bin/rove)",
    properties: ["openFile", "showHiddenFiles"],
    buttonLabel: "Use this",
  })
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return null
  rememberRove(binFile(), path)
  return path
}

async function boot(): Promise<void> {
  let bin = findRove(binFile())
  log(bin ? `rove: ${bin}` : "rove: not found")
  if (!bin) {
    const choice = await explain(
      "The app drives the Rove you already have installed, and could not find it. Install it with\n\n  curl -fsSL https://rove.run/install.sh | sh\n\nor point this app at it.",
      ["Choose rove…", "Quit"],
    )
    if (choice !== 0) return app.quit()
    bin = await chooseBinary()
    if (!bin) return app.quit()
  }
  try {
    const started = Date.now()
    bridge = await start({ bin })
    log(`bridge up on ${bridge.origin} in ${Date.now() - started}ms`)
  } catch (err) {
    const detail = redact(err instanceof Error ? err.message : String(err))
    const choice = await explain(detail, ["Try again", "Choose rove…", "Quit"])
    if (choice === 0) return boot()
    if (choice === 1) {
      const picked = await chooseBinary()
      if (picked) return boot()
    }
    return app.quit()
  }
  keepUp(bin, bridge)
  createWindow(bridge)
  log("window created")
}

/**
 * A bridge that dies under an open window comes back on the same port, so the page's own reconnect
 * finds it and nothing reloads. Five tries with backoff, then the owner decides.
 */
function keepUp(bin: string, running: Started): void {
  running.onExit(async () => {
    if (quitting) return
    const port = Number(new URL(running.origin).port)
    log(`bridge exited; restarting on ${port}`)
    let lastError = ""
    for (const wait of [500, 1_000, 2_000, 4_000, 8_000]) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (quitting) return
      try {
        bridge = await start({ bin, port, attempts: 1 })
        log(`bridge back on ${bridge.origin}`)
        return keepUp(bin, bridge)
      } catch (err) {
        lastError = redact(err instanceof Error ? err.message : String(err))
      }
    }
    const choice = await explain(lastError, ["Restart", "Quit"], "The Rove bridge stopped and did not come back.")
    if (choice === 0) relaunch()
    else app.quit()
  })
}

function buildMenu(): void {
  const isMac = process.platform === "darwin"
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { label: "Set Rove program…", click: () => void chooseBinary().then((p) => p && relaunch()) },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { role: "close" as const },
        ...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" as const }, { role: "zoom" as const }, { role: "front" as const }],
    },
    {
      label: "Help",
      submenu: [
        { label: "Docs and shortcuts", click: () => void shell.openExternal(DOCS_URL) },
        {
          label: "Open in the browser",
          click: () => bridge && void shell.openExternal(bridge.url.split("#")[0] ?? bridge.origin),
        },
        ...(isMac ? [] : [{ type: "separator" as const }, { role: "about" as const }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** After pointing the app at another rove, start over rather than leave a half-configured window. */
function relaunch(): void {
  app.relaunch()
  app.exit(0)
}

// One window per install: a second launch focuses the first rather than starting a second bridge.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.setName(APP_NAME)
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() })
  app.whenReady().then(() => {
    buildMenu()
    void boot()
  })
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) void boot()
  })
  app.on("window-all-closed", () => app.quit())
  app.on("before-quit", () => {
    quitting = true
    bridge?.stop()
  })
}
