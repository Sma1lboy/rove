/**
 * Unit tests for daemon socket / pid path resolution.
 *
 * Load-bearing rule: an explicit `KOBE_HOME_DIR` (env var or argument)
 * MUST win over `XDG_RUNTIME_DIR`. Linux desktops set the runtime dir
 * unconditionally, so a resolver that places the socket there regardless
 * makes `dev:sandbox` / any isolated-state daemon share a socket with the
 * production daemon. Same socket = collisions + cross-contamination.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultAttentionInboxPath } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import { defaultAutomationsPath } from "@sma1lboy/kobe-daemon/daemon/automations-store"
import { linkLegacyRuntimePath } from "@sma1lboy/kobe-daemon/daemon/compat-link"
import { defaultIssuesStorePath } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { defaultKeybindingsPath } from "@sma1lboy/kobe-daemon/daemon/keybindings-watcher"
import { defaultNotesStorePath } from "@sma1lboy/kobe-daemon/daemon/notes-store"
import {
  defaultClientLogPath,
  defaultDaemonLogPath,
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  defaultPtyExitsPath,
  defaultPtyHostLogPath,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
  fitSocketPath,
  legacyDaemonSocketPath,
} from "@sma1lboy/kobe-daemon/daemon/paths"
import { migrateLegacyPtyHostData } from "@sma1lboy/kobe-daemon/daemon/pty-data-migration"
import { defaultUiPrefsStatePath } from "@sma1lboy/kobe-daemon/daemon/ui-prefs-watcher"
import { pluginConfigDir, pluginRegistryPath, pluginStateDir } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { roveStateDir } from "../../src/env.ts"

const PREV = {
  ROVE_HOME_DIR: process.env.ROVE_HOME_DIR,
  ROVE_DAEMON_SOCKET_PATH: process.env.ROVE_DAEMON_SOCKET_PATH,
  ROVE_DAEMON_PID_PATH: process.env.ROVE_DAEMON_PID_PATH,
  KOBE_HOME_DIR: process.env.KOBE_HOME_DIR,
  KOBE_DAEMON_SOCKET_PATH: process.env.KOBE_DAEMON_SOCKET_PATH,
  KOBE_DAEMON_PID_PATH: process.env.KOBE_DAEMON_PID_PATH,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
}

beforeEach(() => {
  Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  Reflect.deleteProperty(process.env, "ROVE_DAEMON_SOCKET_PATH")
  Reflect.deleteProperty(process.env, "ROVE_DAEMON_PID_PATH")
  Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  Reflect.deleteProperty(process.env, "KOBE_DAEMON_SOCKET_PATH")
  Reflect.deleteProperty(process.env, "KOBE_DAEMON_PID_PATH")
  Reflect.deleteProperty(process.env, "XDG_RUNTIME_DIR")
})

afterEach(() => {
  if (PREV.ROVE_HOME_DIR === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = PREV.ROVE_HOME_DIR
  if (PREV.ROVE_DAEMON_SOCKET_PATH === undefined) Reflect.deleteProperty(process.env, "ROVE_DAEMON_SOCKET_PATH")
  else process.env.ROVE_DAEMON_SOCKET_PATH = PREV.ROVE_DAEMON_SOCKET_PATH
  if (PREV.ROVE_DAEMON_PID_PATH === undefined) Reflect.deleteProperty(process.env, "ROVE_DAEMON_PID_PATH")
  else process.env.ROVE_DAEMON_PID_PATH = PREV.ROVE_DAEMON_PID_PATH
  if (PREV.KOBE_HOME_DIR === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = PREV.KOBE_HOME_DIR
  if (PREV.KOBE_DAEMON_SOCKET_PATH === undefined) Reflect.deleteProperty(process.env, "KOBE_DAEMON_SOCKET_PATH")
  else process.env.KOBE_DAEMON_SOCKET_PATH = PREV.KOBE_DAEMON_SOCKET_PATH
  if (PREV.KOBE_DAEMON_PID_PATH === undefined) Reflect.deleteProperty(process.env, "KOBE_DAEMON_PID_PATH")
  else process.env.KOBE_DAEMON_PID_PATH = PREV.KOBE_DAEMON_PID_PATH
  if (PREV.XDG_RUNTIME_DIR === undefined) Reflect.deleteProperty(process.env, "XDG_RUNTIME_DIR")
  else process.env.XDG_RUNTIME_DIR = PREV.XDG_RUNTIME_DIR
})

describe("defaultDaemonSocketPath", () => {
  test("KOBE_DAEMON_SOCKET_PATH override wins over every derived path", () => {
    process.env.KOBE_HOME_DIR = "/tmp/from-env"
    process.env.XDG_RUNTIME_DIR = "/run/user/1000"
    process.env.KOBE_DAEMON_SOCKET_PATH = "/tmp/kobe-owned.sock"
    expect(defaultDaemonSocketPath()).toBe("/tmp/kobe-owned.sock")
  })

  test("caller-supplied homeDir argument wins over XDG_RUNTIME_DIR", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000"
    expect(defaultDaemonSocketPath("/tmp/sandbox-home")).toBe("/tmp/sandbox-home/.rove/daemon.sock")
  })

  test("explicit KOBE_HOME_DIR env var wins over XDG_RUNTIME_DIR", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000"
    process.env.KOBE_HOME_DIR = "/tmp/from-env"
    expect(defaultDaemonSocketPath()).toBe("/tmp/from-env/.rove/daemon.sock")
  })

  test("falls back to XDG_RUNTIME_DIR when no home override is set", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000"
    expect(defaultDaemonSocketPath()).toBe("/run/user/1000/kobe.sock")
  })
})

describe("defaultDaemonPidPath", () => {
  test("uses KOBE_HOME_DIR when set (XDG never relevant for pidfile)", () => {
    process.env.KOBE_HOME_DIR = "/tmp/from-env"
    expect(defaultDaemonPidPath()).toBe("/tmp/from-env/.rove/daemon.pid")
  })
})

describe("ROVE_HOME_DIR compatibility state matrix", () => {
  /**
   * Every path a running install writes to, asserted as an exact string under
   * an isolated home. This is the guard against a store that resolves its own
   * path and lands outside the home — the failure mode that let `tasks.json`
   * escape: a store whose path is not listed here is not covered by anything,
   * because the escape is invisible until someone's sandbox run scribbles on
   * their real `~/.rove`. ADD AN ENTRY when you add a persisted path.
   *
   * `taskIndex` reaches through the kobe package's `roveStateDir()` rather
   * than a kobe-daemon `default*Path` — which is exactly why it was missing,
   * and why it is spelled out here instead of left to the daemon-side group.
   */
  test("every path is canonical once nothing legacy is live", () => {
    process.env.KOBE_HOME_DIR = "/tmp/legacy-home"
    process.env.ROVE_HOME_DIR = "/tmp/rove-home"

    expect({
      attention: defaultAttentionInboxPath(),
      taskIndex: join(roveStateDir(), "tasks.json"),
      automations: defaultAutomationsPath(),
      clientLog: defaultClientLogPath(),
      daemonLog: defaultDaemonLogPath(),
      daemonPid: defaultDaemonPidPath(),
      daemonSocket: defaultDaemonSocketPath(),
      issues: defaultIssuesStorePath(),
      keybindings: defaultKeybindingsPath(),
      notes: defaultNotesStorePath(),
      pluginConfig: pluginConfigDir("demo"),
      pluginRegistry: pluginRegistryPath(),
      pluginState: pluginStateDir("demo"),
      ptyExits: defaultPtyExitsPath(),
      ptyLog: defaultPtyHostLogPath(),
      ptyPid: defaultPtyHostPidPath(),
      ptySocket: defaultPtyHostSocketPath(),
      uiPrefs: defaultUiPrefsStatePath(),
    }).toEqual({
      attention: "/tmp/rove-home/.rove/attention-inbox.json",
      taskIndex: "/tmp/rove-home/.rove/tasks.json",
      automations: "/tmp/rove-home/.rove/automations.json",
      clientLog: "/tmp/rove-home/.rove/client.log",
      daemonLog: "/tmp/rove-home/.rove/daemon.log",
      daemonPid: "/tmp/rove-home/.rove/daemon.pid",
      daemonSocket: "/tmp/rove-home/.rove/daemon.sock",
      issues: "/tmp/rove-home/.rove/issues.json",
      keybindings: "/tmp/rove-home/.rove/settings/keybindings.yaml",
      notes: "/tmp/rove-home/.rove/notes.json",
      pluginConfig: "/tmp/rove-home/.rove/plugins/demo/config",
      pluginRegistry: "/tmp/rove-home/.rove/plugins.json",
      pluginState: "/tmp/rove-home/.rove/plugins/demo/state",
      ptyExits: "/tmp/rove-home/.rove/pty-exits.json",
      ptyLog: "/tmp/rove-home/.rove/pty.log",
      ptyPid: "/tmp/rove-home/.rove/pty.pid",
      ptySocket: "/tmp/rove-home/.rove/pty.sock",
      uiPrefs: "/tmp/rove-home/.config/rove/state.json",
    })
  })
})

describe("fitSocketPath — sun_path length fallback", () => {
  // The kernel's struct sockaddr_un.sun_path is 104 bytes on macOS,
  // 108 on Linux. Worktree-based dev:sandbox paths can easily blow
  // past that; without the fallback `listen()` fails silently.

  test("falls back to $TMPDIR/kobe-<homeTag>-<role>.sock when natural path is too long", () => {
    const longHome = "/Users/me/i/kobe/.claude/worktrees/01KRAHRS48X42YK9TRJ2VE5X1F/packages/kobe/.dev-sandbox/home"
    const natural = `${longHome}/.rove/daemon.sock`
    const fitted = fitSocketPath(natural, longHome, "daemon")
    expect(fitted).not.toBe(natural)
    expect(fitted.length).toBeLessThanOrEqual(100)
    expect(fitted.startsWith(tmpdir())).toBe(true)
    expect(fitted).toMatch(/kobe-[0-9a-f]{8}-daemon\.sock$/)
  })

  test("daemon socket falls back automatically through defaultDaemonSocketPath", () => {
    const longHome = "/Users/me/i/kobe/.claude/worktrees/01KRAHRS48X42YK9TRJ2VE5X1F/packages/kobe/.dev-sandbox/home"
    const result = defaultDaemonSocketPath(longHome)
    expect(result.startsWith(tmpdir())).toBe(true)
    expect(result.length).toBeLessThanOrEqual(100)
  })
})

describe("live legacy runtime (the rename's one hazard)", () => {
  let home = ""

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-runtime-"))
    mkdirSync(join(home, ".kobe"), { recursive: true })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  test("a legacy socket whose process is ALIVE stays the address", () => {
    // Switching a running host's address would orphan every engine tab it owns.
    writeFileSync(join(home, ".kobe", "pty.sock"), "")
    writeFileSync(join(home, ".kobe", "pty.pid"), `${process.pid}\n`)
    expect(defaultPtyHostSocketPath(home)).toBe(join(home, ".kobe", "pty.sock"))
    expect(defaultPtyHostPidPath(home)).toBe(join(home, ".kobe", "pty.pid"))
  })

  test("a legacy socket left by a dead process is stepped over", () => {
    writeFileSync(join(home, ".kobe", "daemon.sock"), "")
    writeFileSync(join(home, ".kobe", "daemon.pid"), "2\n") // pid 2: never ours
    expect(defaultDaemonSocketPath(home)).toBe(join(home, ".rove", "daemon.sock"))
  })

  test("a canonical socket always wins, even next to a live legacy one", () => {
    mkdirSync(join(home, ".rove"), { recursive: true })
    writeFileSync(join(home, ".rove", "daemon.sock"), "")
    writeFileSync(join(home, ".kobe", "daemon.sock"), "")
    writeFileSync(join(home, ".kobe", "daemon.pid"), `${process.pid}\n`)
    expect(defaultDaemonSocketPath(home)).toBe(join(home, ".rove", "daemon.sock"))
  })

  test("host-owned data is canonical even while the legacy copy is still there", () => {
    // The PTY host MOVES these at boot (`migrateLegacyPtyHostData`), so the
    // resolver never points at `.kobe` — the old "whichever layout holds it"
    // rule made the legacy location permanent for any pre-rename home.
    writeFileSync(join(home, ".kobe", "pty-exits.json"), "{}")
    expect(defaultPtyExitsPath(home)).toBe(join(home, ".rove", "pty-exits.json"))
  })

  test("migrateLegacyPtyHostData moves the exit + freeze stores and links the old paths", () => {
    mkdirSync(join(home, ".kobe", "pty-sessions"), { recursive: true })
    writeFileSync(join(home, ".kobe", "pty-sessions", "a.json"), '{"key":"a"}')
    writeFileSync(join(home, ".kobe", "pty-exits.json"), '{"a":{}}')

    expect(migrateLegacyPtyHostData(home)).toEqual(["pty-exits.json", "pty-sessions"])
    expect(readFileSync(join(home, ".rove", "pty-exits.json"), "utf8")).toBe('{"a":{}}')
    expect(readFileSync(join(home, ".rove", "pty-sessions", "a.json"), "utf8")).toBe('{"key":"a"}')
    expect(lstatSync(join(home, ".kobe", "pty-sessions")).isSymbolicLink()).toBe(true)
    // Idempotent: a second boot must not move the symlink it just left behind.
    expect(migrateLegacyPtyHostData(home)).toEqual([])
    expect(readFileSync(join(home, ".kobe", "pty-exits.json"), "utf8")).toBe('{"a":{}}')
  })

  test("migrateLegacyPtyHostData keeps a canonical entry that already exists", () => {
    mkdirSync(join(home, ".rove"), { recursive: true })
    writeFileSync(join(home, ".rove", "pty-exits.json"), '{"canonical":{}}')
    writeFileSync(join(home, ".kobe", "pty-exits.json"), '{"legacy":{}}')

    expect(migrateLegacyPtyHostData(home)).toEqual([])
    expect(readFileSync(join(home, ".rove", "pty-exits.json"), "utf8")).toBe('{"canonical":{}}')
  })
})

describe("linkLegacyRuntimePath (the other direction)", () => {
  let home = ""

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-compat-"))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  test("points an EXISTING legacy dir at the canonical path", async () => {
    const canonical = join(home, ".rove", "daemon.sock")
    mkdirSync(join(home, ".rove"), { recursive: true })
    mkdirSync(join(home, ".kobe"), { recursive: true })
    writeFileSync(canonical, "")
    expect(await linkLegacyRuntimePath(canonical, legacyDaemonSocketPath(home))).toBe(true)
    expect(readlinkSync(join(home, ".kobe", "daemon.sock"))).toBe(canonical)
  })

  test("does not CREATE a legacy dir — a fresh install has no ~/.kobe to link into", async () => {
    // The link only helps a binary predating the rename, and such a binary
    // would have made `.kobe` itself. Creating it gave every new install a
    // directory full of dangling links after shutdown.
    const canonical = join(home, ".rove", "daemon.sock")
    mkdirSync(join(home, ".rove"), { recursive: true })
    writeFileSync(canonical, "")
    expect(await linkLegacyRuntimePath(canonical, legacyDaemonSocketPath(home))).toBe(false)
    expect(existsSync(join(home, ".kobe"))).toBe(false)
  })

  test("never clobbers a REAL file at the legacy path — that is another daemon's socket", async () => {
    mkdirSync(join(home, ".kobe"), { recursive: true })
    writeFileSync(join(home, ".kobe", "daemon.sock"), "someone else's")
    expect(await linkLegacyRuntimePath(join(home, ".rove", "daemon.sock"), legacyDaemonSocketPath(home))).toBe(false)
    expect(readFileSync(join(home, ".kobe", "daemon.sock"), "utf8")).toBe("someone else's")
  })

  test("replaces its own stale link from a previous boot", async () => {
    mkdirSync(join(home, ".kobe"), { recursive: true })
    symlinkSync(join(home, ".rove", "old.sock"), join(home, ".kobe", "daemon.sock"))
    const canonical = join(home, ".rove", "daemon.sock")
    expect(await linkLegacyRuntimePath(canonical, legacyDaemonSocketPath(home))).toBe(true)
    expect(readlinkSync(join(home, ".kobe", "daemon.sock"))).toBe(canonical)
  })
})
