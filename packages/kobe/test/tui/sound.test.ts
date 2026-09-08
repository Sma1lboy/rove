/**
 * Notification sound (`tui/lib/sound.ts`): player discovery on PATH, the
 * per-player argv table, and the never-throws contract. `pulse()` is
 * best-effort by design — the tests pin that a missing player is a silent
 * no-op (terminal BEL is the fallback), that the argv names the player found
 * on PATH, and that VOLUME reaches the file rather than the argv (four
 * players, Windows' among them, take no volume flag at all).
 *
 * The module caches the picked player + copied asset at module scope, so each
 * test re-imports a fresh module (vi.resetModules). Bun's runtime globals
 * (Bun.file / Bun.write / Bun.spawn) are absent under vitest's node env and
 * are faked per test.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

let pathDir: string
let prevPath: string | undefined

type FakeBun = {
  file: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  spawn: ReturnType<typeof vi.fn>
}

function fakeBun(overrides: Partial<FakeBun> = {}): FakeBun {
  const bun: FakeBun = {
    // ensureAsset: pretend the cached copy already exists so no real copy runs.
    file: vi.fn((p: string) => ({ exists: async () => true, path: p })),
    write: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ unref: vi.fn() })),
    ...overrides,
  }
  ;(globalThis as { Bun?: unknown }).Bun = bun
  return bun
}

async function freshPulse(): Promise<(volume?: number) => void> {
  vi.resetModules()
  const mod = await import("../../src/tui/lib/sound")
  return mod.pulse
}

/** Drain the ensureAsset().then(...) microtask chain pulse() fires into. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  pathDir = mkdtempSync(join(tmpdir(), "kobe-sound-path-"))
  prevPath = process.env.PATH
})

afterEach(() => {
  process.env.PATH = prevPath
  ;(globalThis as { Bun?: unknown }).Bun = undefined
  rmSync(pathDir, { recursive: true, force: true })
})

describe("pathDirs", () => {
  test("splits a Windows PATH on ';' without shattering drive-letter colons", async () => {
    vi.resetModules()
    const { pathDirs } = await import("../../src/tui/lib/sound")
    // The old hard-coded ':' split turned "C:\\Windows\\System32" into
    // ["C", "\\Windows\\System32"], so powershell.exe was never found.
    expect(pathDirs("C:\\Windows\\System32;C:\\Program Files\\PowerShell", ";")).toEqual([
      "C:\\Windows\\System32",
      "C:\\Program Files\\PowerShell",
    ])
  })

  test("splits a POSIX PATH on ':' and drops empty entries", async () => {
    vi.resetModules()
    const { pathDirs } = await import("../../src/tui/lib/sound")
    expect(pathDirs("/usr/local/bin:/usr/bin::/bin", ":")).toEqual(["/usr/local/bin", "/usr/bin", "/bin"])
  })
})

describe("pulse", () => {
  test("spawns the player found on PATH with the sound file (afplay: bare argv)", async () => {
    writeFileSync(join(pathDir, "afplay"), "#!/bin/sh\n")
    process.env.PATH = pathDir
    const bun = fakeBun()
    const pulse = await freshPulse()

    pulse(0.4)
    await settle()

    expect(bun.spawn).toHaveBeenCalledTimes(1)
    const [argv, opts] = bun.spawn.mock.calls[0] as [string[], Record<string, string>]
    expect(argv[0]).toBe("afplay")
    expect(argv[1]).toMatch(/kobe-sfx.*pulse@40\.wav$/)
    expect(opts).toMatchObject({ stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  })

  test("carries volume in the FILE, not the argv — no player gets a volume flag", async () => {
    // Windows only ever reaches the powershell.exe fallback, whose
    // Media.SoundPlayer has no volume API, so an argv volume was discarded
    // there: the chime rang at full system level and no setting could lower
    // it. Every player now receives an already-scaled file instead.
    writeFileSync(join(pathDir, "ffplay"), "#!/bin/sh\n")
    process.env.PATH = pathDir
    const bun = fakeBun()
    const pulse = await freshPulse()

    pulse(0.7)
    await settle()

    const [argv] = bun.spawn.mock.calls[0] as [string[]]
    expect(argv).toEqual(["ffplay", "-autoexit", "-nodisp", expect.stringMatching(/pulse@70\.wav$/)])
    expect(argv.join(" ")).not.toContain("volume=")
  })

  test("caches one asset per volume, so two levels never share a file", async () => {
    writeFileSync(join(pathDir, "afplay"), "")
    process.env.PATH = pathDir
    const bun = fakeBun()
    const pulse = await freshPulse()

    pulse(0.1)
    pulse(1)
    await settle()

    const files = bun.spawn.mock.calls.map((call) => (call as [string[]])[0][1])
    expect(files[0]).toMatch(/pulse@10\.wav$/)
    expect(files[1]).toMatch(/pulse@100\.wav$/)
  })

  test("volume 0 is silence, and spawns nothing at all", async () => {
    writeFileSync(join(pathDir, "afplay"), "")
    process.env.PATH = pathDir
    const bun = fakeBun()
    const pulse = await freshPulse()

    pulse(0)
    await settle()

    expect(bun.spawn).not.toHaveBeenCalled()
  })

  test("prefers the first PLAYERS entry present when several are installed", async () => {
    // ffplay precedes afplay in the PLAYERS priority list.
    writeFileSync(join(pathDir, "afplay"), "")
    writeFileSync(join(pathDir, "ffplay"), "")
    process.env.PATH = pathDir
    const bun = fakeBun()
    const pulse = await freshPulse()

    pulse(0.4)
    await settle()

    expect((bun.spawn.mock.calls[0] as [string[]])[0][0]).toBe("ffplay")
  })

  test("no player on PATH → silent no-op (terminal BEL is the fallback)", async () => {
    process.env.PATH = pathDir // empty dir
    const bun = fakeBun()
    const pulse = await freshPulse()

    pulse(0.4)
    await settle()

    expect(bun.spawn).not.toHaveBeenCalled()
  })

  test("a spawn failure is swallowed — pulse never throws", async () => {
    writeFileSync(join(pathDir, "afplay"), "")
    process.env.PATH = pathDir
    fakeBun({
      spawn: vi.fn(() => {
        throw new Error("spawn failed")
      }),
    })
    const pulse = await freshPulse()

    expect(() => pulse(0.4)).not.toThrow()
    await settle() // the rejection path must also stay contained
  })

  test("detaches the player so its lifetime never pins kobe at shutdown", async () => {
    writeFileSync(join(pathDir, "afplay"), "")
    process.env.PATH = pathDir
    const unref = vi.fn()
    const bun = fakeBun({ spawn: vi.fn(() => ({ unref })) })
    const pulse = await freshPulse()

    pulse(0.4)
    await settle()

    expect(bun.spawn).toHaveBeenCalledTimes(1)
    expect(unref).toHaveBeenCalledTimes(1)
  })
})
