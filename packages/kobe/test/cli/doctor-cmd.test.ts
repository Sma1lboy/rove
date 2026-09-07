import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CURRENT_VERSION } from "../../src/version.ts"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  close: vi.fn(),
  inspectLegacyTmux: vi.fn(),
  kobeSkillState: vi.fn(),
  detectEngineStatuses: vi.fn(),
  listPresetIds: vi.fn(),
}))

// The engines block must be a LOOP over the registered engines, not a fixed
// set of rows. Stubbing the probe (real ones read this machine's PATH and
// credential files) keeps the assertions about composition: every id the
// registry lists gets a row, in that order, with its own account shape.
vi.mock("../../src/engine/engine-status.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/engine-status.ts")>()
  return { ...actual, detectEngineStatuses: mocks.detectEngineStatuses }
})

vi.mock("../../src/engine/engine-presets.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/engine-presets.ts")>()
  return { ...actual, listPresetIds: mocks.listPresetIds }
})

vi.mock("@sma1lboy/kobe-daemon/client", () => ({
  KobeDaemonClient: vi.fn().mockImplementation(() => ({
    request: mocks.request,
    close: mocks.close,
  })),
}))

vi.mock("../../src/lib/skill-install.ts", () => ({
  skillInstallCommand: () => "kobe skill install",
  kobeSkillState: mocks.kobeSkillState,
}))

vi.mock("../../src/cli/legacy-tmux.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/legacy-tmux.ts")>()
  return { ...actual, inspectLegacyTmux: mocks.inspectLegacyTmux }
})

import { runDoctorSubcommand } from "../../src/cli/doctor-cmd.ts"

let home: string
let originalHome: string | undefined
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  originalHome = process.env.KOBE_HOME_DIR
  home = mkdtempSync(join(tmpdir(), "kobe-doctor-"))
  process.env.KOBE_HOME_DIR = home
  mkdirSync(join(home, ".kobe"), { recursive: true })
  mocks.request.mockReset()
  mocks.close.mockReset()
  mocks.inspectLegacyTmux.mockReset().mockResolvedValue({
    available: true,
    version: "tmux 3.6b",
    sessions: [],
    panePids: [],
    processes: [],
    error: null,
  })
  mocks.kobeSkillState.mockReset().mockReturnValue({
    installed: true,
    installedVersion: 3,
    currentVersion: 3,
    stale: false,
    legacyCopies: [],
  })
  mocks.listPresetIds.mockReset().mockReturnValue(["claude", "codex", "copilot", "kimi"])
  mocks.detectEngineStatuses.mockReset().mockImplementation(async (vendors: readonly string[]) =>
    vendors.map((vendor) => ({
      vendor,
      binary: { found: true, path: `/bin/${vendor}` },
      account: { kind: "none" } as const,
    })),
  )
  vi.stubGlobal("Bun", { version: "0.0.0-test" })
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
})

afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
  logSpy.mockRestore()
  vi.unstubAllGlobals()
})

function output(): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join("\n")
}

describe("runDoctorSubcommand", () => {
  it("reports daemon, Hosted PTY, and installed tmux health", async () => {
    mocks.request.mockImplementation(async (name: string) => {
      if (name === "daemon.status") {
        return { daemonPid: 42, uptimeMs: 65_000, taskCount: 2, attachedClients: 1 }
      }
      if (name === "pty.list") {
        return {
          sessions: [
            { key: "task-a::tab-1", alive: true, parked: false },
            { key: "task-b::tab-1", alive: false, parked: true },
          ],
          pid: 99,
          rssBytes: 12 * 1024 * 1024,
          stats: {
            ringBytes: 128 * 1024,
            ringCapacityBytes: 1024 * 1024,
            parkedSessions: 1,
            parkedScreenBytes: 100 * 1024,
            parkRestoreDeltas: 7,
            parkRestoreFallbacks: 2,
          },
        }
      }
      throw new Error(`unexpected request ${name}`)
    })

    await runDoctorSubcommand([])

    expect(output()).toContain("daemon:  ✓ running (pid 42, up 1m 5s, 2 task(s), 1 client(s))")
    expect(output()).toContain("pty host: ✓ running (2 session(s), 1 live, 1 parked)")
    // Sizes render through the shared lib/format-bytes.ts (≥100 drops the decimal).
    expect(output()).toContain("pid 99, 12.0 MB RSS")
    expect(output()).toContain("ring: 128 KB / 1.0 MB")
    expect(output()).toContain("parked screens: 100 KB")
    expect(output()).toContain("park wakes: 7 delta, 2 full replay fallback")
    expect(output()).toContain("legacy tmux: tmux 3.6b — no sessions on `kobe`")
    // No `version` in the reply: an older host, which is itself the finding.
    expect(output()).toContain("build: unknown — this host predates the version check")
  })

  it("flags a pty host serving an older build than the CLI, and points at reset", async () => {
    // The host is the one process `daemon restart` never replaces — that is
    // its purpose — so an install upgraded underneath it keeps running old
    // code for as long as sessions live. Doctor could not see this at all.
    mocks.request.mockImplementation(async (name: string) => {
      if (name === "daemon.status") return { daemonPid: 42, kobeVersion: CURRENT_VERSION }
      if (name === "pty.list") return { sessions: [], version: "0.0.1-ancient" }
      throw new Error(`unexpected request ${name}`)
    })

    await runDoctorSubcommand([])

    expect(output()).toContain(`⚠ stale build: pty host is v0.0.1-ancient, you launched v${CURRENT_VERSION}`)
    expect(output()).toContain("reset")
  })

  it("says nothing alarming when the pty host is on the same build as the CLI", async () => {
    mocks.request.mockImplementation(async (name: string) => {
      if (name === "daemon.status") return { daemonPid: 42, kobeVersion: CURRENT_VERSION }
      if (name === "pty.list") return { sessions: [], version: CURRENT_VERSION }
      throw new Error(`unexpected request ${name}`)
    })

    await runDoctorSubcommand([])

    expect(output()).toContain(`build: v${CURRENT_VERSION}`)
    expect(output()).not.toContain("stale build: pty host")
  })

  it("prints the whole terminal section, multiplexer and kitty probe included", async () => {
    // Regression guard: this section collapses to a single env line if it is
    // treated as tmux-runtime output. Multiplexer NESTING and the kitty probe
    // are not about Rove hosting tmux, and the consequence of losing them is
    // real: docs/KEYBINDINGS.md says both split chords need the kitty
    // protocol, so without the probe doctor cannot answer a "split doesn't
    // work" report at all.
    mocks.request.mockResolvedValue(null)
    await runDoctorSubcommand([])
    const text = output()
    expect(text).toContain("terminal: TERM=")
    expect(text).toContain("running inside a multiplexer:")
    expect(text).toContain("kitty keyboard protocol:")
  })

  it("reports legacy process counts and RSS from a single inspect pass", async () => {
    mocks.request.mockRejectedValue(new Error("not running"))
    mocks.inspectLegacyTmux.mockResolvedValue({
      available: true,
      version: "tmux 3.6b",
      sessions: ["kobe-a"],
      panePids: [501],
      processes: [
        { pid: 501, pgid: 501, rssKb: 4096, command: "bun" },
        { pid: 510, pgid: 501, rssKb: 2048, command: "claude" },
      ],
      error: null,
    })

    await runDoctorSubcommand([])

    expect(output()).toContain("legacy tmux: ⚠ tmux 3.6b — 1 pre-v0.8 session(s)")
    expect(output()).toContain("2 process(es) across 1 pane(s), 6.0 MB RSS total")
    expect(output()).toContain("bun: 1 proc, 4.0 MB")
    expect(output()).toContain("claude: 1 proc, 2.0 MB")
    expect(mocks.inspectLegacyTmux).toHaveBeenCalledTimes(1)
  })

  it("help describes a read-only daemon, Hosted PTY, engines, git, and legacy tmux diagnosis", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    await runDoctorSubcommand(["--help"])
    expect(writeSpy.mock.calls.join("")).toContain("daemon / Hosted PTY / engines / git / legacy tmux / state")
    expect(writeSpy.mock.calls.join("")).toContain("--report")
    expect(mocks.request).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })

  it("failing checks add a --fix hint to the plain run", async () => {
    mocks.request.mockRejectedValue(new Error("not running"))

    await runDoctorSubcommand([])

    expect(output()).toContain("doctor --fix")
  })

  it("--fix without a TTY prints the per-fix plan and executes nothing", async () => {
    mocks.request.mockRejectedValue(new Error("not running"))

    await runDoctorSubcommand(["--fix"])

    // Runnable fix shown with its exact command…
    expect(output()).toContain("will run:")
    expect(output()).toContain("daemon restart")
    // …and a cold home proposes NO `reset`. Nothing here is broken: the PTY
    // host is started on demand by the first task tab, so "no pidfile, no
    // socket" is the normal state of a brand-new install. Doctor used to
    // prescribe `reset` — which it describes in the same breath as not
    // undoable and as killing every live session — to a user with nothing
    // wrong and nothing to lose yet.
    expect(output()).not.toContain("rove reset")
    expect(output()).not.toContain("kobe reset")
    expect(output()).toContain("starts on demand")
    // …and nothing ran (no TTY → no confirmations → no executions).
    expect(output()).toContain("nothing was executed")
    expect(output()).not.toContain("✓ done")
  })

  it("still proposes reset for a WEDGED pty host (live pid, dead socket)", async () => {
    // The positive control for the cold case above: same unreachable socket,
    // but a pidfile whose process is alive. That IS broken, and `reset` is
    // the documented remedy.
    mocks.request.mockRejectedValue(new Error("not running"))
    const { defaultPtyHostPidPath } = await import("@sma1lboy/kobe-daemon/daemon/paths")
    const pidPath = defaultPtyHostPidPath()
    mkdirSync(join(pidPath, ".."), { recursive: true })
    writeFileSync(pidPath, String(process.pid))

    await runDoctorSubcommand(["--fix"])

    expect(output()).toContain("WEDGED")
    expect(output()).toMatch(/(rove|kobe) reset/)
    expect(output()).not.toContain("starts on demand")
    // The label must name the condition that actually fired. "unreachable or
    // not running" read as true either way, including in the cold case above
    // where doctor now (correctly) proposes nothing at all.
    expect(output()).toContain("the PTY host process is alive but its socket is unreachable (wedged)")
  })

  // The cwd is mocked to a DIFFERENT directory than the home on purpose: the
  // bundle landing in the user's repo (untracked, gitignored nowhere, full of
  // logs and env) is the regression, so "not in the cwd" is half the contract
  // and asserting only the home path would pass with both writes happening.
  it("--report writes the bundle under the Rove home, never the cwd", async () => {
    mocks.request.mockRejectedValue(new Error("not running"))
    const cwd = mkdtempSync(join(tmpdir(), "rove-doctor-cwd-"))
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd)

    await runDoctorSubcommand(["--report"])

    const reportPath = join(home, ".rove", "rove-doctor-report.txt")
    expect(output()).toContain(`report written: ${reportPath}`)
    expect(existsSync(join(cwd, "rove-doctor-report.txt"))).toBe(false)
    const bundle = readFileSync(reportPath, "utf8")
    expect(bundle).toContain("# Rove doctor report")
    expect(bundle).toContain("## diagnosis")
    cwdSpy.mockRestore()
  })
})

// Why: hardcoding three rows (claude/codex/copilot) with three hand-written
// label functions makes kimi INVISIBLE despite its real `detectKimiAccount`,
// and no contrib/custom engine can ever appear. The
// test that catches a regression is "every registered id gets a row", not
// "these four names are present".
describe("runDoctorSubcommand engines block", () => {
  beforeEach(() => {
    mocks.request.mockRejectedValue(new Error("not running"))
  })

  it("gives every registered engine a row, in registry order", async () => {
    mocks.listPresetIds.mockReturnValue(["claude", "codex", "copilot", "kimi", "my-agent"])
    await runDoctorSubcommand([])

    const rows = output()
      .split("\n")
      .filter((l) => /^ {2}\w[\w-]*\s+[✓✗]/.test(l))
    expect(rows.map((l) => l.trim().split(/\s+/)[0])).toEqual(["claude", "codex", "copilot", "kimi", "my-agent"])
    expect(mocks.detectEngineStatuses).toHaveBeenCalledWith(["claude", "codex", "copilot", "kimi", "my-agent"])
  })

  it("renders each account shape from the engine's own status", async () => {
    mocks.listPresetIds.mockReturnValue(["claude", "codex", "copilot", "kimi", "my-agent"])
    mocks.detectEngineStatuses.mockResolvedValue([
      { vendor: "claude", binary: { found: true, path: "/bin/claude" }, account: { kind: "oauth", email: "a@b.c" } },
      {
        vendor: "codex",
        binary: { found: true, path: "/bin/codex" },
        account: { kind: "chatgpt", email: "x@y.z", plan: "pro" },
      },
      { vendor: "copilot", binary: { found: false, error: "not found on PATH" }, account: { kind: "none" } },
      // kimi's JWT carries no email claim — "logged in" with no identity.
      { vendor: "kimi", binary: { found: true, path: "/bin/kimi" }, account: { kind: "oauth" } },
      // No detector: NOT the same claim as "not logged in".
      { vendor: "my-agent", binary: { found: true, path: "/bin/my-agent" }, account: null },
    ])
    await runDoctorSubcommand([])

    expect(output()).toContain("claude  ✓ /bin/claude — logged in (a@b.c)")
    expect(output()).toContain("codex   ✓ /bin/codex — logged in (x@y.z, pro)")
    expect(output()).toContain("copilot ✗ not found on PATH")
    expect(output()).toContain("kimi    ✓ /bin/kimi — logged in")
    expect(output()).toContain("my-agent ✓ /bin/my-agent — login not detectable")
  })

  it("surfaces an engine's account error without dropping its row", async () => {
    mocks.listPresetIds.mockReturnValue(["kimi"])
    mocks.detectEngineStatuses.mockResolvedValue([
      {
        vendor: "kimi",
        binary: { found: true, path: "/bin/kimi" },
        account: { kind: "none" },
        accountError: "parse /home/u/.kimi-code/credentials/kimi-code.json: bad json",
      },
    ])
    await runDoctorSubcommand([])

    expect(output()).toContain("kimi    ✓ /bin/kimi — no account")
    expect(output()).toContain("⚠ parse /home/u/.kimi-code/credentials/kimi-code.json: bad json")
  })

  it("counts ANY usable engine, not a hardcoded few", async () => {
    // Only kimi is installed and logged in. An `anyUsable` that ORs three
    // hardcoded vendors tells this user they have NO engine at all.
    // The verdict is only visible as a proposed fix, so count them: the
    // no-engine finding is present in one case and absent in the other.
    mocks.listPresetIds.mockReturnValue(["claude", "codex", "copilot", "kimi"])
    const missing = (vendor: string) => ({
      vendor,
      binary: { found: false, error: "not found on PATH" },
      account: { kind: "none" as const },
    })
    const kimiUsable = [
      missing("claude"),
      missing("codex"),
      missing("copilot"),
      { vendor: "kimi", binary: { found: true, path: "/bin/kimi" }, account: { kind: "oauth" as const } },
    ]
    mocks.detectEngineStatuses.mockResolvedValue(kimiUsable)
    await runDoctorSubcommand([])
    const withKimi = Number(/(\d+) finding/.exec(output())?.[1] ?? -1)

    logSpy.mockClear()
    mocks.detectEngineStatuses.mockResolvedValue([...kimiUsable.slice(0, 3), missing("kimi")])
    await runDoctorSubcommand([])
    const withNone = Number(/(\d+) finding/.exec(output())?.[1] ?? -1)

    expect(withKimi).toBeGreaterThanOrEqual(0)
    // Nothing usable adds exactly the no-engine finding on top.
    expect(withNone).toBe(withKimi + 1)
  })
})
