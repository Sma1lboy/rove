import { describe, expect, it, vi } from "vitest"
import { parseUpdateArgs, runUpdateSubcommand, updatePlan } from "../../src/cli/update.ts"
import { updaterShell } from "../../src/lib/updater-shell.ts"
import { PACKAGE_NAME, UPDATE_COMMAND, UPDATE_SCRIPT_URL, recommendedGlobalInstallCommand } from "../../src/version.ts"

describe("updatePlan", () => {
  it("delegates to the GitHub-hosted update script", () => {
    expect(updatePlan()).toEqual({
      command: updaterShell(),
      args: ["-c", UPDATE_COMMAND],
      display: UPDATE_COMMAND,
    })
    expect(UPDATE_COMMAND).toBe(`curl -fsSL ${UPDATE_SCRIPT_URL} | sh`)
    expect(recommendedGlobalInstallCommand(null)).toBe(`npm install -g ${PACKAGE_NAME}@latest`)
  })

  it("a channel rides into the script through the same slot a version does", () => {
    // npm makes no distinction between a version and a dist-tag in
    // `pkg@<arg>`, so the channel needs no separate flag downstream.
    expect(updatePlan("nightly")).toEqual({
      command: updaterShell(),
      args: ["-c", `${UPDATE_COMMAND} -s -- nightly`],
      display: `${UPDATE_COMMAND} -s -- nightly`,
    })
  })
})

describe("parseUpdateArgs", () => {
  it("parses dry-run (verb and --flag spellings)", () => {
    expect(parseUpdateArgs(["--dry-run"])).toEqual({
      help: false,
      dryRun: true,
      list: false,
      version: undefined,
    })
    expect(parseUpdateArgs(["dry-run"]).dryRun).toBe(true)
  })

  it("parses a pinned version (plain and prerelease)", () => {
    expect(parseUpdateArgs(["0.7.90"]).version).toBe("0.7.90")
    expect(parseUpdateArgs(["0.8.0-experimental.1"]).version).toBe("0.8.0-experimental.1")
    expect(parseUpdateArgs(["0.7.90", "--dry-run"])).toEqual({
      help: false,
      dryRun: true,
      list: false,
      version: "0.7.90",
    })
  })

  it("accepts a channel as a bare word or a --channel flag, in either spelling", () => {
    expect(parseUpdateArgs(["nightly"]).channel).toBe("nightly")
    expect(parseUpdateArgs(["--channel", "nightly"]).channel).toBe("nightly")
    expect(parseUpdateArgs(["--channel=nightly"]).channel).toBe("nightly")
    expect(parseUpdateArgs(["latest"]).channel).toBe("latest")
    // No channel named = stay on whichever one this build came from.
    expect(parseUpdateArgs([]).channel).toBeUndefined()
    expect(parseUpdateArgs(["0.7.90"]).channel).toBeUndefined()
  })

  it("refuses an unknown channel instead of passing it to npm as a 404 dist-tag", () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`)
    }) as never)
    try {
      expect(() => parseUpdateArgs(["--channel", "bleeding"])).toThrow("exit 2")
      const err = errSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(err).toContain('--channel expects one of latest, nightly (got "bleeding")')
      // A trailing --channel with no value is the same refusal, not a crash.
      errSpy.mockClear()
      expect(() => parseUpdateArgs(["--channel"])).toThrow("exit 2")
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("--channel expects one of")
    } finally {
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })

  it("an unknown argument prints the error + full usage to stderr and exits 2", () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`)
    }) as never)
    try {
      expect(() => parseUpdateArgs(["--fast"])).toThrow("exit 2")
      const err = errSpy.mock.calls.map((c) => String(c[0])).join("")
      // The instruction surface, not a bare one-liner: usage + script URL + fallback.
      expect(err).toContain('kobe update: unknown argument "--fast"')
      expect(err).toContain("Usage: kobe update [version|channel|list|dry-run]")
      expect(err).toContain(UPDATE_SCRIPT_URL)
      expect(err).toContain(recommendedGlobalInstallCommand())
    } finally {
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })
})

describe("runUpdateSubcommand", () => {
  it("prints the command without spawning in dry-run mode", async () => {
    const out: string[] = []
    const err: string[] = []
    const spawn = vi.fn()
    const exit = vi.fn((code: number) => {
      throw new Error(`unexpected exit ${code}`)
    })

    await runUpdateSubcommand(["--dry-run"], {
      spawn: spawn as never,
      stdout: {
        write: (s: string) => {
          out.push(s)
          return true
        },
      },
      stderr: {
        write: (s: string) => {
          err.push(s)
          return true
        },
      },
      exit: exit as never,
    })

    expect(spawn).not.toHaveBeenCalled()
    expect(err).toEqual([])
    expect(out.join("")).toContain(`running: ${UPDATE_COMMAND}`)
  })

  it("says the daemon and pty host are still on the old build after a successful install", async () => {
    // Installing files does not replace running processes. Both keep serving
    // the old build, and the pty host survives `daemon restart` by design —
    // the success path used to print nothing about either.
    const out: string[] = []
    await runUpdateSubcommand([], {
      spawn: (() => ({ status: 0 })) as never,
      stdout: {
        write: (s: string) => {
          out.push(s)
          return true
        },
      },
      stderr: { write: () => true },
      exit: (() => {
        throw new Error("exit")
      }) as never,
    }).catch(() => undefined)

    expect(out.join("")).toContain("daemon restart")
    expect(out.join("")).toContain("pty host")
  })

  it("exits with the update script status", async () => {
    const spawn = vi.fn(() => ({ status: 7 }))
    const exits: number[] = []

    await runUpdateSubcommand([], {
      spawn: spawn as never,
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: ((code: number) => {
        exits.push(code)
        throw new Error("exit")
      }) as never,
    }).catch((err) => {
      expect((err as Error).message).toBe("exit")
    })

    expect(spawn).toHaveBeenCalledWith(updaterShell(), ["-c", UPDATE_COMMAND], { stdio: "inherit" })
    expect(exits).toEqual([7])
  })

  it("a spawn failure (e.g. no POSIX shell) reports the cause and exits 1", async () => {
    const err: string[] = []
    const exits: number[] = []
    const spawn = vi.fn(() => ({ error: new Error("ENOENT") }))
    await runUpdateSubcommand([], {
      spawn: spawn as never,
      stdout: { write: () => true },
      stderr: {
        write: (s: string) => {
          err.push(s)
          return true
        },
      },
      exit: ((code: number) => {
        exits.push(code)
        throw new Error("exit")
      }) as never,
    }).catch((e) => {
      expect((e as Error).message).toBe("exit")
    })
    expect(err.join("")).toContain(`kobe update: failed to run ${updaterShell()}: ENOENT`)
    expect(exits).toEqual([1])
  })
})
