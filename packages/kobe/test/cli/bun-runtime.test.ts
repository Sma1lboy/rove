/**
 * The published bins start under whichever runtime the installer chose
 * (Bun for `bun install -g`, node for `npm i -g` / `npx`), so the launcher's
 * Bun discovery is what keeps a Bun-less machine from getting
 * `env: bun: No such file or directory` — and its version floor is what keeps
 * a too-OLD Bun from installing cleanly and then running a Rove whose terminal
 * tabs silently never paint. Pure functions here; the launcher itself is a
 * 70-line shell around them.
 */

import { describe, expect, it } from "vitest"
import {
  BUN_OVERRIDE_ENV,
  MIN_BUN_VERSION,
  SKIP_VERSION_CHECK_ENV,
  bunCandidates,
  bunInstallerCommand,
  canOfferBunInstall,
  exitCodeOf,
  installBun,
  launcherDirOf,
  launcherNameOf,
  missingBunMessage,
  relaunchWithBun,
  resolveBunBinary,
  resolveUsableBun,
  staleBunMessage,
  unusableBunMessage,
} from "../../src/cli/bun-runtime.ts"

const posix = { platform: "linux" as const, home: "/home/dev", env: { PATH: "/usr/bin:/opt/bin" } }

describe("bunCandidates", () => {
  it("puts an explicit override ahead of everything else", () => {
    const candidates = bunCandidates({ ...posix, env: { ...posix.env, [BUN_OVERRIDE_ENV]: "/custom/bun" } })

    expect(candidates[0]).toBe("/custom/bun")
    expect(candidates).toContain("/usr/bin/bun")
  })

  it("scans PATH, then BUN_INSTALL, then the default ~/.bun prefix", () => {
    const candidates = bunCandidates({ ...posix, env: { ...posix.env, BUN_INSTALL: "/opt/bun-install" } })

    expect(candidates).toEqual(["/usr/bin/bun", "/opt/bin/bun", "/opt/bun-install/bin/bun", "/home/dev/.bun/bin/bun"])
  })

  it("probes a `bun` npm package beside the install, which is never on PATH", () => {
    const candidates = bunCandidates({ ...posix, launcherDir: "/lib/node_modules/@sma1lboy/rove/dist/cli" })

    expect(candidates).toContain("/lib/node_modules/@sma1lboy/rove/node_modules/bun/bin/bun")
    expect(candidates).toContain("/lib/node_modules/@sma1lboy/bun/bin/bun")
  })

  it("looks for bun.exe on Windows and accepts USERPROFILE as the home", () => {
    const candidates = bunCandidates({ platform: "win32", env: { Path: "C:\\tools", USERPROFILE: "C:\\Users\\dev" } })

    expect(candidates.every((candidate) => candidate.endsWith("bun.exe"))).toBe(true)
  })
})

describe("resolveBunBinary", () => {
  it("returns the first executable candidate", () => {
    const found = resolveBunBinary({ ...posix, isExecutable: (path) => path === "/opt/bin/bun" })

    expect(found).toBe("/opt/bin/bun")
  })

  it("returns null when no candidate exists", () => {
    expect(resolveBunBinary({ ...posix, isExecutable: () => false })).toBeNull()
  })
})

describe("resolveUsableBun", () => {
  const all = { ...posix, isExecutable: () => true }

  it("skips a Bun below the floor and uses a newer one further down the list", () => {
    const found = resolveUsableBun({
      ...all,
      bunVersionOf: (path) => (path === "/usr/bin/bun" ? "1.2.21" : "1.3.14"),
    })

    expect(found.bun).toBe("/opt/bin/bun")
    expect(found.stale).toEqual({ path: "/usr/bin/bun", version: "1.2.21" })
  })

  it("reports the first stale Bun when every candidate is too old", () => {
    const found = resolveUsableBun({ ...all, bunVersionOf: () => "1.2.21" })

    expect(found.bun).toBeNull()
    expect(found.stale).toEqual({ path: "/usr/bin/bun", version: "1.2.21" })
  })

  it("accepts a Bun that runs but prints nothing rather than refusing to start", () => {
    const found = resolveUsableBun({ ...all, bunVersionOf: () => "" })

    expect(found.bun).toBe("/usr/bin/bun")
    expect(found.stale).toBeNull()
  })

  it("takes the first executable candidate when the check is opted out", () => {
    const probes: string[] = []
    const found = resolveUsableBun({
      ...all,
      env: { ...posix.env, [SKIP_VERSION_CHECK_ENV]: "1" },
      bunVersionOf: (path) => {
        probes.push(path)
        return "1.2.21"
      },
    })

    expect(found.bun).toBe("/usr/bin/bun")
    expect(probes).toEqual([])
  })

  it("has nothing to report when there is no Bun at all", () => {
    expect(resolveUsableBun({ ...posix, isExecutable: () => false })).toEqual({
      bun: null,
      stale: null,
      unusable: null,
    })
  })

  // A candidate that will not run is one the relaunch could not have run
  // either — same spawnSync — so skipping it only ever helps. Before this,
  // the launcher re-exec'd into a stray text file / a crasher / a hang and
  // produced that binary's garbage, or wedged (env matrix cases 15-17).
  it("skips a Bun that cannot be run and uses the next candidate", () => {
    const found = resolveUsableBun({
      ...all,
      bunVersionOf: (path) => (path === "/usr/bin/bun" ? null : "1.3.14"),
    })

    expect(found.bun).toBe("/opt/bin/bun")
    expect(found.unusable).toBe("/usr/bin/bun")
  })

  it("reports the unrunnable Bun when it is the only one", () => {
    const found = resolveUsableBun({ ...all, bunVersionOf: () => null })

    expect(found).toEqual({ bun: null, stale: null, unusable: "/usr/bin/bun" })
  })

  // The opposite call: it RAN, we just did not recognise what it printed.
  // Refusing that would brick everyone the day Bun changes its version string.
  it("uses a Bun that runs but prints an unrecognisable version", () => {
    const found = resolveUsableBun({ ...all, bunVersionOf: () => "bun-but-weird" })

    expect(found.bun).toBe("/usr/bin/bun")
    expect(found.unusable).toBeNull()
  })
})

describe("staleBunMessage", () => {
  it("names the offending binary, its version, and the floor", () => {
    const message = staleBunMessage("/usr/bin/bun", "1.2.21", "rove")

    expect(message).toContain("/usr/bin/bun")
    expect(message).toContain("1.2.21")
    expect(message).toContain(MIN_BUN_VERSION)
  })

  it("offers an upgrade route per package manager, plus both escape hatches", () => {
    const message = staleBunMessage("/opt/homebrew/bin/bun", "1.2.21", "rove")

    expect(message).toContain("bun upgrade")
    expect(message).toContain("brew upgrade bun")
    expect(message).toContain("npm install -g bun@latest")
    expect(message).toContain(BUN_OVERRIDE_ENV)
    expect(message).toContain(SKIP_VERSION_CHECK_ENV)
  })
})

describe("unusableBunMessage", () => {
  it("says the binary is there but does not run, not that Bun is missing", () => {
    const message = unusableBunMessage("/usr/bin/bun", "rove")

    expect(message).toContain("/usr/bin/bun")
    expect(message).toContain("could not be run")
    expect(message).not.toContain("no Bun was found")
    expect(message).toContain(BUN_OVERRIDE_ENV)
  })
})

describe("launcher identity", () => {
  it("derives the invoked CLI name from the launcher file", () => {
    expect(launcherNameOf("file:///lib/rove/dist/cli/rove.js")).toBe("rove")
    expect(launcherNameOf("file:///lib/rove/dist/cli/kobe.mjs")).toBe("kobe")
    expect(launcherDirOf("file:///lib/rove/dist/cli/rove.js")).toBe("/lib/rove/dist/cli")
  })
})

describe("install guidance", () => {
  it("offers the platform's own installer", () => {
    expect(bunInstallerCommand("darwin").join(" ")).toContain("https://bun.sh/install")
    expect(bunInstallerCommand("win32")[0]).toBe("powershell")
  })

  it("names every install route a user without Bun can take", () => {
    const message = missingBunMessage("rove", "linux")

    expect(message).toContain("curl -fsSL https://bun.sh/install | bash")
    expect(message).toContain("npm install -g bun")
    expect(message).toContain("install.sh")
    expect(message).toContain(BUN_OVERRIDE_ENV)
  })

  it("shows the PowerShell installer first on Windows", () => {
    expect(missingBunMessage("rove", "win32")).toContain("irm bun.sh/install.ps1")
  })

  it("uses the active CLI name by default", () => {
    const saved = process.env.ROVE_INVOKED_AS
    process.env.ROVE_INVOKED_AS = "rove"
    try {
      expect(missingBunMessage(undefined, "linux")).toContain("rove: Rove runs on the Bun runtime")
      expect(missingBunMessage(undefined, "linux")).not.toContain("kobe: Rove")
    } finally {
      // biome-ignore lint/performance/noDelete: env cleanup must fully unset when the var was unset before the test (assigning undefined leaves the string "undefined").
      if (saved === undefined) delete process.env.ROVE_INVOKED_AS
      else process.env.ROVE_INVOKED_AS = saved
    }
  })

  it("falls back to kobe when no invocation marker is set", () => {
    const saved = process.env.ROVE_INVOKED_AS
    // biome-ignore lint/performance/noDelete: env cleanup must fully unset when the var was unset before the test (assigning undefined leaves the string "undefined").
    delete process.env.ROVE_INVOKED_AS
    try {
      expect(missingBunMessage(undefined, "linux")).toContain("kobe: Rove runs on the Bun runtime")
    } finally {
      if (saved !== undefined) process.env.ROVE_INVOKED_AS = saved
    }
  })
})

describe("canOfferBunInstall", () => {
  const tty = { isTTY: true }

  it("asks only when a human is there to answer", () => {
    expect(canOfferBunInstall({}, tty, tty)).toBe(true)
    expect(canOfferBunInstall({}, { isTTY: false }, tty)).toBe(false)
    expect(canOfferBunInstall({}, tty, { isTTY: false })).toBe(false)
  })

  it("never prompts in CI or when the escape hatch is set", () => {
    expect(canOfferBunInstall({ CI: "true" }, tty, tty)).toBe(false)
    expect(canOfferBunInstall({ ROVE_NO_BUN_BOOTSTRAP: "1" }, tty, tty)).toBe(false)
  })
})

const spawnResult = (over: Record<string, unknown> = {}) =>
  ({ status: 0, signal: null, error: undefined, ...over }) as never

describe("installBun", () => {
  it("re-probes the well-known prefixes after the installer ran", () => {
    const calls: string[][] = []
    const found = installBun(
      { ...posix, isExecutable: (path) => path === "/home/dev/.bun/bin/bun", bunVersionOf: () => "1.3.14" },
      (cmd, args) => {
        calls.push([cmd, ...args])
        return spawnResult()
      },
    )

    expect(found).toBe("/home/dev/.bun/bin/bun")
    expect(calls[0]?.[0]).toBe("bash")
  })

  it("does not hand back the stale Bun the install was meant to escape", () => {
    const found = installBun(
      { ...posix, isExecutable: () => true, bunVersionOf: (path) => (path === "/usr/bin/bun" ? "1.2.21" : "1.3.14") },
      () => spawnResult(),
    )

    expect(found).toBe("/opt/bin/bun")
  })

  it("gives up when the installer fails", () => {
    expect(
      installBun({ ...posix, isExecutable: () => true, bunVersionOf: () => "1.3.14" }, () =>
        spawnResult({ status: 1 }),
      ),
    ).toBeNull()
  })
})

describe("relaunchWithBun", () => {
  it("hands the entry and argv to Bun with inherited stdio", () => {
    let seen: { cmd: string; args: readonly string[]; options: { stdio?: string } } | null = null
    const code = relaunchWithBun("/usr/bin/bun", "/dist/rove-run.js", ["api", "--pretty"], (cmd, args, options) => {
      seen = { cmd, args, options }
      return spawnResult({ status: 3 })
    })

    expect(code).toBe(3)
    expect(seen).toEqual({
      cmd: "/usr/bin/bun",
      args: ["/dist/rove-run.js", "api", "--pretty"],
      options: { stdio: "inherit" },
    })
  })

  it("reports a Bun that cannot be started instead of exiting 0", () => {
    expect(
      relaunchWithBun("/gone/bun", "/dist/rove-run.js", [], () => spawnResult({ error: new Error("ENOENT") })),
    ).toBe(1)
  })
})

describe("exitCodeOf", () => {
  it("passes a status through and maps a fatal signal the way a shell does", () => {
    expect(exitCodeOf({ status: 0, signal: null })).toBe(0)
    expect(exitCodeOf({ status: 2, signal: null })).toBe(2)
    expect(exitCodeOf({ status: null, signal: "SIGINT" })).toBe(130)
    expect(exitCodeOf({ status: null, signal: null })).toBe(1)
  })
})
