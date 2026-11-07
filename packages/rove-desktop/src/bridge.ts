/**
 * The bridge behind the window: the Rove the owner already has installed, serving the rove-web
 * client on loopback. The app never reimplements the client or the daemon — it starts
 * `rove --web --no-qr --port <free>` and loads the `open:` line it prints.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { constants, accessSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

const WINDOWS = process.platform === "win32"

/** npm and Bun install `rove.cmd`/`rove.exe` on Windows; elsewhere the file is `rove`. */
const NAMES = WINDOWS ? ["rove.exe", "rove.cmd"] : ["rove"]

/** Where an installer, Homebrew, Bun or a node version manager would have put `rove`. */
const KNOWN_DIRS = WINDOWS
  ? [join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm"), join(homedir(), ".bun", "bin")]
  : [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      join(homedir(), ".bun", "bin"),
      join(homedir(), ".local", "bin"),
      join(homedir(), ".npm-global", "bin"),
      join(homedir(), ".volta", "bin"),
      join(homedir(), ".asdf", "shims"),
    ]

/** `~/.nvm/versions/node/*\/bin` and friends: a global npm install lands inside a version's bin. */
function versionManagerDirs(): string[] {
  const out: string[] = []
  const nvm = join(homedir(), ".nvm", "versions", "node")
  try {
    for (const version of readdirSync(nvm)) out.push(join(nvm, version, "bin"))
  } catch {
    // No nvm here.
  }
  return out
}

export interface Started {
  /** The page's URL, token included. Never logged, never written down. */
  readonly url: string
  /** The bare origin, for navigation locks and "open in browser". */
  readonly origin: string
  stop(): void
  /** Called once if the bridge exits (crash, killed, or `stop()`); never for an attached URL. */
  onExit(fn: () => void): void
}

function isExecutable(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * A path saved by hand (Settings › Set Rove program…), then `ROVE_DESKTOP_BIN`, then this process's
 * own PATH (the app started from a terminal inherits the login PATH), then the usual install places,
 * then a login shell — a Finder-launched app starts with `/usr/bin:/bin`, so nvm and friends are only
 * findable that way.
 */
export function findRove(savedPathFile: string): string | null {
  const saved = readIfAny(savedPathFile)?.trim()
  if (saved && isExecutable(saved)) return saved
  const fromEnv = process.env.ROVE_DESKTOP_BIN?.trim()
  if (fromEnv && isExecutable(fromEnv)) return fromEnv
  const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...KNOWN_DIRS, ...versionManagerDirs()]
  for (const dir of new Set(dirs)) {
    for (const name of NAMES) {
      const candidate = join(dir, name)
      if (isExecutable(candidate)) return candidate
    }
  }
  return WINDOWS ? null : fromLoginShell()
}

/** `zsh -lc 'command -v rove'`: the PATH a person actually has, for an app launched from Finder. */
function fromLoginShell(): string | null {
  const shell = process.env.SHELL || "/bin/zsh"
  try {
    const found = spawnSync(shell, ["-lc", "command -v rove"], { encoding: "utf8", timeout: 5_000 })
    const path = found.stdout.trim().split("\n").pop()?.trim()
    return path && isExecutable(path) ? path : null
  } catch {
    return null
  }
}

/** Node refuses to run a `.cmd`/`.bat` without a shell; the quoted path survives spaces in it. */
function launch(bin: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"]
  if (WINDOWS && /\.(cmd|bat)$/i.test(bin)) return spawn(`"${bin}"`, args, { stdio, env, shell: true })
  return spawn(bin, args, { stdio, env })
}

export function rememberRove(savedPathFile: string, path: string): void {
  writeFileSync(savedPathFile, `${path}\n`, "utf8")
}

function readIfAny(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

/** A port the OS says is free right now; the bridge binds it a moment later (a loss here is retried). */
function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  const server = createServer()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    server.close(() => (port ? resolve(port) : reject(new Error("no free port"))))
  })
  return promise
}

/** `open: http://127.0.0.1:PORT/#token=…` — the one line this app needs. */
const OPEN_LINE = /^open: (http:\/\/\S+)$/

/** What may be shown to a person: a rove line with any token stripped. */
export function redact(text: string): string {
  return text.replace(/token=[^\s&"']+/g, "token=…")
}

/**
 * Start the bridge. `env.ROVE_DESKTOP_URL` skips this entirely (previewing against a bridge that
 * already runs, e.g. the rove-web tunnel on 7890).
 */
export async function start(opts: { bin: string; attempts?: number; port?: number }): Promise<Started> {
  const fixed = process.env.ROVE_DESKTOP_URL?.trim()
  if (fixed) return { url: fixed, origin: new URL(fixed).origin, stop: () => {}, onExit: () => {} }

  let lastError = ""
  for (let attempt = 0; attempt < (opts.attempts ?? 3); attempt++) {
    const port = opts.port ?? (await freePort())
    const child = launch(opts.bin, ["--web", "--no-qr", "--port", String(port)], {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    })
    try {
      const url = await openLine(child, port)
      return {
        url,
        origin: new URL(url).origin,
        stop: () => stop(child),
        onExit: (fn) => {
          if (child.exitCode !== null || child.signalCode !== null) fn()
          else child.once("exit", () => fn())
        },
      }
    } catch (err) {
      stop(child)
      lastError = err instanceof Error ? err.message : String(err)
      // Only a taken port is worth another try; anything else is the install talking.
      if (!/in use/i.test(lastError)) break
    }
  }
  throw new Error(lastError || "the bridge did not start")
}

function openLine(child: ChildProcess, port: number): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  let settled = false
  const done = (fn: () => void) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    fn()
  }
  const timer = setTimeout(
    () => done(() => reject(new Error(`no page from rove --web after 45s (port ${port})`))),
    45_000,
  )
  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    // Lines arrive in pieces; keep the tail that has no newline yet.
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const url = OPEN_LINE.exec(line.trim())?.[1]
      if (url) done(() => resolve(url))
    }
  })
  let stderr = ""
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4000)
  })
  child.once("error", (err) => done(() => reject(new Error(`could not run ${child.spawnfile}: ${err.message}`))))
  child.once("exit", (code, signal) => {
    const tail = redact(stderr).trim().split("\n").slice(-6).join("\n")
    done(() => reject(new Error(tail || `rove --web exited (${signal ?? `code ${code}`})`)))
  })
  return promise
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  // Windows has no signals, and the bridge may sit under a cmd shim: end the whole tree.
  if (WINDOWS && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
    return
  }
  child.kill("SIGTERM")
  // A wedged child would hold the port and keep the app's quit from finishing.
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }, 3_000).unref()
}
