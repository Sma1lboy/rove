/**
 * The window shown when no `rove` is on this machine: one button runs the official installer and
 * shows what it prints; once `rove` is found the app carries on by itself.
 *
 * Like the main window it has no preload and no IPC: the page asks for something by following a
 * `rove-setup:` link, and the main process answers by calling the page's `show()`.
 */

import { spawn } from "node:child_process"
import { BrowserWindow } from "electron"

/** `ROVE_DESKTOP_INSTALL_CMD` swaps the installer for a test's own. */
const installCommand = (): string =>
  process.env.ROVE_DESKTOP_INSTALL_CMD?.trim() ||
  (process.platform === "win32" ? "npm install -g bun @sma1lboy/rove" : "curl -fsSL https://rove.run/install.sh | sh")

const PAGE = `<!doctype html><meta charset="utf-8"><title>Rove</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 44px 32px 24px; background: #141413; color: #ece9e1; -webkit-user-select: none;
    font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; display: flex; flex-direction: column; gap: 12px;
    height: 100vh; box-sizing: border-box; -webkit-app-region: drag; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; }
  p { margin: 0; color: #a8a499; }
  .row { display: flex; align-items: center; gap: 16px; margin-top: 4px; -webkit-app-region: no-drag; }
  a { color: #a8a499; font-size: 13px; }
  a.primary { background: #cc785c; color: #141413; font-weight: 600; text-decoration: none; border-radius: 4px;
    padding: 7px 16px; }
  body[data-phase=busy] .row, body[data-phase=done] .row { opacity: .5; pointer-events: none; }
  #state { min-height: 21px; }
  body[data-phase=failed] #state { color: #e0715f; }
  pre { flex: 1; min-height: 0; margin: 0; padding: 10px 12px; overflow: auto; border-radius: 4px; background: #1d1c1a;
    color: #a8a499; font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap;
    overflow-wrap: anywhere; -webkit-user-select: text; -webkit-app-region: no-drag; }
  pre:empty { visibility: hidden; }
</style>
<body data-phase="idle">
  <h1>Install Rove to get started</h1>
  <p>This app is a window on the Rove command-line program, and this computer does not have it yet.
    Installing takes about a minute and also sets up Bun, the runtime Rove uses.</p>
  <div class="row">
    <a class="primary" id="install" href="rove-setup:install">Install Rove</a>
    <a href="rove-setup:choose">I already have it: choose the rove program…</a>
  </div>
  <p id="state" role="status"></p>
  <pre id="log"></pre>
<script>
  function show(s) {
    document.body.dataset.phase = s.phase
    state.textContent = s.status
    install.textContent = s.phase === "failed" ? "Try again" : "Install Rove"
    if (s.line !== undefined) { log.textContent += s.line; log.scrollTop = log.scrollHeight }
  }
</script>`

/** Colours and cursor moves an installer prints for a terminal; a carriage-return redraw becomes a new line. */
function plain(chunk: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes is the point
  return chunk.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r\n?/g, "\n")
}

export interface Setup {
  /** The `rove` to start, or null when the window was closed without one. */
  readonly bin: Promise<string | null>
  /** Shut the window once the main one is up (closing the last window quits the app). */
  close(): void
}

export function openSetup(deps: {
  find: () => string | null
  choose: () => Promise<string | null>
  log: (message: string) => void
}): Setup {
  const { promise, resolve } = Promise.withResolvers<string | null>()
  const win = new BrowserWindow({
    width: 620,
    height: 480,
    resizable: false,
    title: "Rove",
    backgroundColor: "#141413",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.on("closed", () => resolve(null))

  const show = (phase: "idle" | "busy" | "failed" | "done", status: string, line?: string) => {
    if (win.isDestroyed()) return
    void win.webContents.executeJavaScript(`show(${JSON.stringify({ phase, status, line })})`).catch(() => {})
  }
  const found = (bin: string) => {
    show("done", "Rove is installed. Starting it…")
    resolve(bin)
  }

  let busy = false
  const install = () => {
    if (busy) return
    busy = true
    const command = installCommand()
    deps.log(`install: ${command}`)
    show("busy", "Installing Rove…", `$ ${command}\n`)
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] })
    const print = (chunk: string) => show("busy", "Installing Rove…", plain(chunk))
    child.stdout.setEncoding("utf8").on("data", print)
    child.stderr.setEncoding("utf8").on("data", print)
    const finish = (problem: string | null) => {
      if (!busy) return
      busy = false
      const bin = problem === null ? deps.find() : null
      deps.log(`install: ${problem ?? (bin ? `found ${bin}` : "finished, rove not found")}`)
      if (bin) return found(bin)
      show("failed", problem ?? "The installer finished, but the rove program is still not where the app looks for it.")
    }
    child.once("error", (err) => finish(`The installer could not start: ${err.message}`))
    child.once("close", (code) => finish(code === 0 ? null : `The installer stopped with an error (exit ${code}).`))
  }

  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault()
    if (url === "rove-setup:install") install()
    if (url === "rove-setup:choose") void deps.choose().then((bin) => bin && found(bin))
  })
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
  return { bin: promise, close: () => win.isDestroyed() || win.destroy() }
}
