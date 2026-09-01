/**
 * Compare-and-swap on the config files Rove shares with the engine
 * (`~/.claude.json`, `~/.claude/settings.json`). The failure these guard is a
 * LOST UPDATE, not a corrupt file: someone else replaces the document between
 * our read and our write, and our stale merge silently drops their key.
 *
 * Both tests construct that interleaving for real by injecting a foreign write
 * at the exact moment our staging file lands — read → FOREIGN WRITE → rename,
 * which is what claude does when it saves while a Rove launch is mid-merge.
 * Delete the CAS re-read and both go red.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

// The modules under test bind `writeFileSync`/`writeFile` as named imports at
// load time, so a `vi.spyOn(fs, …)` after the fact never reaches them — the
// interleave has to be injected into the module itself.
const hook = vi.hoisted(() => ({ onStagingWrite: undefined as ((p: string) => void) | undefined }))

vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>()
  return {
    ...actual,
    default: actual,
    writeFileSync: (p: string, data: string) => {
      actual.writeFileSync(p, data)
      hook.onStagingWrite?.(String(p))
    },
  }
})

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>()
  return {
    ...actual,
    default: actual,
    writeFile: async (p: string, data: string) => {
      await actual.writeFile(p, data)
      hook.onStagingWrite?.(String(p))
    },
  }
})

const { trustClaudeWorktree } = await import("../../src/engine/claude-code-local/trust.ts")
const { updateSharedJson, updateSharedJsonSync } = await import("../../src/engine/shared-config-write.ts")

// Locks live under the resolved ~/.rove/; point them at a temp root so the
// suite never contends with a real Rove on this machine.
const lockHome = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-cas-lockhome-"))
process.env.ROVE_HOME_DIR = lockHome

const tempDirs: string[] = []

afterEach(() => {
  hook.onStagingWrite = undefined
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  fs.rmSync(lockHome, { recursive: true, force: true })
})

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-cas-"))
  tempDirs.push(home)
  return home
}

/** Fire `foreign` exactly once, when the staging file for `file` is written —
 *  i.e. after the writer read the document and before it renames. */
function interleaveOnStagingWrite(file: string, foreign: () => void): void {
  let fired = false
  hook.onStagingWrite = (p) => {
    if (fired || !p.startsWith(`${file}.rove-`)) return
    fired = true
    foreign()
  }
}

describe("trustClaudeWorktree under a concurrent writer", () => {
  it("keeps a permission claude granted mid-merge instead of writing a stale doc over it", () => {
    const home = tempHome()
    const file = path.join(home, ".claude.json")
    fs.writeFileSync(file, JSON.stringify({ projects: { "/repo": { allowedTools: ["Read"] } } }))

    // Claude itself saves while we're merging: it rewrites the whole document,
    // adding a permission the user just approved in another session.
    interleaveOnStagingWrite(file, () => {
      fs.writeFileSync(file, JSON.stringify({ projects: { "/repo": { allowedTools: ["Read", "Bash(git *)"] } } }))
    })

    trustClaudeWorktree("/wt/task-1", home)

    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as {
      projects: Record<string, { allowedTools?: string[]; hasTrustDialogAccepted?: boolean }>
    }
    // The retry re-read the winner's document, so BOTH survive.
    expect(doc.projects["/repo"].allowedTools).toEqual(["Read", "Bash(git *)"])
    expect(doc.projects["/wt/task-1"].hasTrustDialogAccepted).toBe(true)
  })
})

describe("updateSharedJson under a concurrent writer", () => {
  it("merges onto the winner's bytes rather than clobbering them", async () => {
    const home = tempHome()
    const file = path.join(home, "settings.json")
    fs.writeFileSync(file, JSON.stringify({ hooks: {} }))

    interleaveOnStagingWrite(file, () => {
      fs.writeFileSync(file, JSON.stringify({ hooks: {}, userSetting: "do not lose me" }))
    })

    await updateSharedJson(
      file,
      (raw) => (raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>)),
      (doc) => JSON.stringify({ ...doc, rove: true }),
    )

    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    expect(doc.userSetting).toBe("do not lose me")
    expect(doc.rove).toBe(true)
  })

  it("leaves no staging files behind", async () => {
    const home = tempHome()
    const file = path.join(home, "settings.json")
    await updateSharedJson(
      file,
      (raw) => (raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>)),
      (doc) => JSON.stringify({ ...doc, rove: true }),
    )
    expect(fs.readdirSync(home)).toEqual(["settings.json"])
  })
})

describe("staging path", () => {
  // Uniqueness is per CALL, not per process. The lock normally keeps two
  // writers from overlapping, so this is unreachable in a healthy run — but the
  // lock has takeover paths (stale steal, forceTakeover) where mutual exclusion
  // breaks, and that is exactly when a shared `<file>.tmp` lets writer B clobber
  // writer A's staging file and fail A's rename with ENOENT (issue #53, already
  // paid for once in orchestrator/index/store.ts). Asserted directly because a
  // race test would pass on a pid-only path.
  it("differs between two calls in the same process", () => {
    const home = tempHome()
    const file = path.join(home, "settings.json")
    const seen = new Set<string>()
    hook.onStagingWrite = (p) => {
      if (p.startsWith(`${file}.rove-`)) seen.add(p)
    }
    const write = (key: string) =>
      updateSharedJsonSync(
        file,
        (raw) => (raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>)),
        (doc) => JSON.stringify({ ...doc, [key]: true }),
      )
    write("a")
    write("b")
    expect(seen.size).toBe(2)
  })

  it("leaves no staging file behind once two writers are done", async () => {
    const home = tempHome()
    const file = path.join(home, "settings.json")
    const write = (key: string) =>
      updateSharedJson(
        file,
        (raw) => (raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>)),
        (doc) => JSON.stringify({ ...doc, [key]: true }),
      )
    await Promise.all([write("a"), write("b")])
    expect(fs.readdirSync(home)).toEqual(["settings.json"])
  })
})

describe("cross-process lock", () => {
  // The CAS covers the engine, which holds no lock. It does NOT cover two Rove
  // processes: check-then-rename is a TOCTOU, and both can pass the re-read.
  // A slow build() widens that window until it is deterministic — without the
  // lock, one writer's key is silently dropped.
  it("serializes two Rove writers so neither loses the other's key", async () => {
    const home = tempHome()
    const file = path.join(home, "settings.json")
    fs.writeFileSync(file, "{}")
    const write = (key: string) =>
      updateSharedJson(
        file,
        (raw) => (raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>)),
        (doc) => {
          const end = Date.now() + 20
          while (Date.now() < end) {
            /* hold the read open across the peer's whole critical section */
          }
          return JSON.stringify({ ...doc, [key]: true })
        },
      )
    await Promise.all([write("a"), write("b")])
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    expect(doc).toEqual({ a: true, b: true })
  })

  it("releases the lock so a later write is not blocked by the previous one", async () => {
    const home = tempHome()
    const file = path.join(home, "settings.json")
    const write = (key: string) =>
      updateSharedJson(
        file,
        (raw) => (raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>)),
        (doc) => JSON.stringify({ ...doc, [key]: true }),
      )
    await write("first")
    await write("second")
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ first: true, second: true })
  })
})
