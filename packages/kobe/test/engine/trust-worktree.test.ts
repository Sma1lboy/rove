/**
 * Vendor worktree pre-trust: each adapter writes its vendor's
 * first-run trust record for a Rove-created worktree — merge-preserving and
 * idempotent, because these stores belong to the user's real CLI installs.
 * Runs against temp HOME dirs; the real stores are never touched.
 */

import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { trustClaudeWorktree } from "../../src/engine/claude-code-local/trust.ts"
import { trustCodexWorktree } from "../../src/engine/codex-local/trust.ts"
import { trustCopilotWorktree } from "../../src/engine/copilot-local/trust.ts"
import { kimiTrustFilePath, trustKimiWorktree } from "../../src/engine/kimi-local/trust.ts"
// Static, and deliberately: `registry.ts` and `builtin-engines.ts` form an
// import cycle, and registry reads BUILTIN_ENGINES at module init. Entering
// that cycle through builtin-engines resolves it to undefined and throws;
// entering through registry initializes both. See the guard below.
import "../../src/engine/registry.ts"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-trust-"))
  tempDirs.push(home)
  return home
}

const WORKTREE = "/wt/rove-task-1"

describe("trustKimiWorktree", () => {
  it("writes the workspace-trust record named by sha256(path)[:12]", () => {
    const home = tempHome()
    trustKimiWorktree(WORKTREE, home)
    const hash = createHash("sha256").update(WORKTREE).digest("hex").slice(0, 12)
    const file = kimiTrustFilePath(WORKTREE, home)
    expect(file).toBe(path.join(home, ".kimi-code", "workspace-trust", `wd_rove-task-1_${hash}`))
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as { root: string; trustedAt: number }
    expect(record.root).toBe(WORKTREE)
    expect(typeof record.trustedAt).toBe("number")
  })

  // Kimi hashes the RESOLVED path and lowercases the basename — read off a
  // record kimi 0.40.1 wrote itself. A record keyed on the literal path
  // suppresses no dialog, which is the whole point of writing one.
  it("hashes the resolved path and lowercases the dirname segment", () => {
    const home = tempHome()
    const real = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "kobe-real-"))
    tempDirs.push(real)
    const target = path.join(real, "Task-A")
    fs.mkdirSync(target)
    const link = path.join(real, "link")
    fs.symlinkSync(real, link)
    const viaLink = path.join(link, "Task-A")

    const file = kimiTrustFilePath(viaLink, home)
    expect(path.basename(file)).toBe(`wd_task-a_${createHash("sha256").update(target).digest("hex").slice(0, 12)}`)
    // …and the same worktree reached the long way round lands on one record.
    expect(kimiTrustFilePath(target, home)).toBe(file)
    // The record's own `root` resolves too, so it is shaped like one kimi
    // writes rather than merely being FILED where kimi looks.
    trustKimiWorktree(viaLink, home)
    expect((JSON.parse(fs.readFileSync(file, "utf8")) as { root: string }).root).toBe(target)
  })

  it("is idempotent — an existing record is not rewritten", () => {
    const home = tempHome()
    trustKimiWorktree(WORKTREE, home)
    const file = kimiTrustFilePath(WORKTREE, home)
    fs.writeFileSync(file, JSON.stringify({ root: WORKTREE, trustedAt: 1 }))
    trustKimiWorktree(WORKTREE, home)
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ root: WORKTREE, trustedAt: 1 })
  })
})

describe("trustClaudeWorktree", () => {
  it("merges into an existing store, preserving other projects and keys", () => {
    const home = tempHome()
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        numStartups: 42,
        projects: {
          "/repo": { allowedTools: ["Bash(git *)"], hasTrustDialogAccepted: true },
          [WORKTREE]: { allowedTools: ["Read"] },
        },
      }),
    )
    trustClaudeWorktree(WORKTREE, home)
    const doc = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
    expect(doc.numStartups).toBe(42)
    expect(doc.projects["/repo"]).toEqual({ allowedTools: ["Bash(git *)"], hasTrustDialogAccepted: true })
    // The worktree's existing per-project state survives the trust merge.
    expect(doc.projects[WORKTREE]).toMatchObject({
      allowedTools: ["Read"],
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    })
  })

  it("creates a fresh store when none exists, and skips a second accept", () => {
    const home = tempHome()
    trustClaudeWorktree(WORKTREE, home)
    const file = path.join(home, ".claude.json")
    expect(JSON.parse(fs.readFileSync(file, "utf8")).projects[WORKTREE].hasTrustDialogAccepted).toBe(true)
    const before = fs.readFileSync(file, "utf8")
    trustClaudeWorktree(WORKTREE, home)
    expect(fs.readFileSync(file, "utf8")).toBe(before)
  })
})

describe("trustCodexWorktree", () => {
  it("appends a trusted project table without touching existing config", () => {
    const home = tempHome()
    const dir = path.join(home, ".codex")
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "config.toml")
    fs.writeFileSync(file, 'model = "gpt-5"\n\n[projects."/repo"]\ntrust_level = "trusted"\n')
    trustCodexWorktree(WORKTREE, home)
    const text = fs.readFileSync(file, "utf8")
    expect(text).toContain('model = "gpt-5"')
    expect(text).toContain(`[projects.${JSON.stringify(WORKTREE)}]\ntrust_level = "trusted"`)
  })

  it("creates the config when absent and never double-appends", () => {
    const home = tempHome()
    trustCodexWorktree(WORKTREE, home)
    trustCodexWorktree(WORKTREE, home)
    const text = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8")
    expect(text.split(`[projects.${JSON.stringify(WORKTREE)}]`)).toHaveLength(2)
  })

  it("leaves no lock file behind after a call", () => {
    const home = tempHome()
    trustCodexWorktree(WORKTREE, home)
    expect(fs.existsSync(path.join(home, ".codex", "config.toml.rove.lock"))).toBe(false)
  })

  it("repairs duplicate stanzas from a missed race — for any path, not just its own", () => {
    const home = tempHome()
    const dir = path.join(home, ".codex")
    fs.mkdirSync(dir, { recursive: true })
    const other = `[projects."/wt/other"]\n${'trust_level = "trusted"'}\n`
    // What a check-then-act race leaves behind: the same table appended
    // twice. TOML rejects the whole file on the duplicate key — this is
    // the machine-wide outage the self-heal must clear.
    fs.writeFileSync(path.join(dir, "config.toml"), `model = "gpt-5"\n\n${other}\n${other}`)
    trustCodexWorktree(WORKTREE, home)
    const text = fs.readFileSync(path.join(dir, "config.toml"), "utf8")
    expect(text.split(`[projects."/wt/other"]`)).toHaveLength(2)
    expect(text).toContain(`[projects.${JSON.stringify(WORKTREE)}]\ntrust_level = "trusted"`)
    expect(text).toContain('model = "gpt-5"')
    // Header lines only ever appear once per path now.
    const headers = text.split("\n").filter((l) => l.startsWith("[projects."))
    expect(new Set(headers).size).toBe(headers.length)
  })

  it("waits for a rival writer holding the lock instead of overwriting it", () => {
    const home = tempHome()
    const dir = path.join(home, ".codex")
    fs.mkdirSync(dir, { recursive: true })
    const lockFile = path.join(dir, "config.toml.rove.lock")
    // A rival writer (any process, not just Rove) holds the lock, writes
    // its stanza, then releases. The trust call must serialize AFTER it.
    const rival = spawn(
      process.execPath,
      [
        "-e",
        `const fs = require("node:fs");
         const lock = ${JSON.stringify(lockFile)};
         const fd = fs.openSync(lock, "wx");
         fs.writeFileSync(fd, String(process.pid));
         setTimeout(() => {
           fs.writeFileSync(${JSON.stringify(path.join(dir, "config.toml"))},
             '[projects."/wt/rival"]\\ntrust_level = "trusted"\\n');
           fs.closeSync(fd);
           fs.unlinkSync(lock);
         }, 300);`,
      ],
      { stdio: "ignore" },
    )
    try {
      // Wait until the rival actually holds the lock before entering.
      for (let i = 0; i < 200 && !fs.existsSync(lockFile); i++) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
      expect(fs.existsSync(lockFile)).toBe(true)
      trustCodexWorktree(WORKTREE, home)
      const text = fs.readFileSync(path.join(dir, "config.toml"), "utf8")
      // Both stanzas survive — without the lock this call reads the file
      // BEFORE the rival's write and the rival then clobbers it.
      expect(text).toContain('[projects."/wt/rival"]')
      expect(text).toContain(`[projects.${JSON.stringify(WORKTREE)}]`)
    } finally {
      rival.kill("SIGKILL")
    }
  })

  it("parallel spawns for the same worktree append exactly one stanza", async () => {
    const home = tempHome()
    const script = [
      `import { trustCodexWorktree } from ${JSON.stringify(new URL("../../src/engine/codex-local/trust.ts", import.meta.url).pathname)}`,
      "trustCodexWorktree(process.argv[1], process.argv[2])",
    ].join("\n")
    const children = Array.from({ length: 6 }, () => {
      const child = spawn("bun", ["-e", script, WORKTREE, home], { stdio: "ignore" })
      return new Promise<void>((resolve, reject) => {
        child.on("error", reject)
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))))
      })
    })
    await Promise.all(children)
    const text = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8")
    expect(text.split(`[projects.${JSON.stringify(WORKTREE)}]`)).toHaveLength(2)
    expect(fs.existsSync(path.join(home, ".codex", "config.toml.rove.lock"))).toBe(false)
  }, 30_000)
})

describe("trustCopilotWorktree", () => {
  const configOf = (home: string) => path.join(home, ".copilot", "config.json")

  it("appends to trustedFolders, preserving other keys and copilot's JSONC header", () => {
    const home = tempHome()
    fs.mkdirSync(path.join(home, ".copilot"), { recursive: true })
    // Byte-for-byte what Copilot CLI v1.0.82 writes: two `//` lines above the
    // body, which plain JSON.parse chokes on.
    fs.writeFileSync(
      configOf(home),
      `// User settings belong in settings.json.\n// This file is managed automatically.\n${JSON.stringify({ firstLaunchAt: "2026-01-01T00:00:00.000Z", trustedFolders: ["/repo"] }, null, 2)}`,
    )
    trustCopilotWorktree(WORKTREE, home)
    const raw = fs.readFileSync(configOf(home), "utf8")
    expect(raw.startsWith("// User settings belong in settings.json.")).toBe(true)
    const doc = JSON.parse(
      raw
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n"),
    )
    expect(doc.firstLaunchAt).toBe("2026-01-01T00:00:00.000Z")
    expect(doc.trustedFolders).toEqual(["/repo", WORKTREE])
  })

  it("creates the config when absent and never double-appends", () => {
    const home = tempHome()
    trustCopilotWorktree(WORKTREE, home)
    expect(JSON.parse(fs.readFileSync(configOf(home), "utf8")).trustedFolders).toEqual([WORKTREE])
    const before = fs.readFileSync(configOf(home), "utf8")
    trustCopilotWorktree(WORKTREE, home)
    expect(fs.readFileSync(configOf(home), "utf8")).toBe(before)
  })

  it("treats a corrupt config as empty rather than refusing to trust", () => {
    const home = tempHome()
    fs.mkdirSync(path.join(home, ".copilot"), { recursive: true })
    fs.writeFileSync(configOf(home), "{ not json")
    trustCopilotWorktree(WORKTREE, home)
    expect(JSON.parse(fs.readFileSync(configOf(home), "utf8")).trustedFolders).toEqual([WORKTREE])
  })
})

/**
 * The registry-level guard. Every builtin gates a never-seen directory behind a
 * first-run dialog a hosted session cannot answer, so an entry without
 * `trustWorktree` launches into that dialog and hangs — which looks like the
 * engine being slow, not like a missing hook. Copilot shipped that way.
 *
 * If a future engine genuinely has no trust gate, do not just delete its name
 * here: say WHY on the registry entry, then relax this with that reason. The
 * failure this catches is silence, not the absence itself.
 */
describe("BUILTIN_ENGINES trust coverage", () => {
  it("every builtin engine pre-trusts a Rove worktree", async () => {
    const { BUILTIN_ENGINES } = await import("../../src/engine/builtin-engines.ts")
    const missing = Object.entries(BUILTIN_ENGINES)
      .filter(([, entry]) => typeof entry.trustWorktree !== "function")
      .map(([vendor]) => vendor)
    expect(missing, `no trustWorktree hook: ${missing.join(", ")}`).toEqual([])
    // Guard the guard: an empty registry would satisfy the assertion above.
    expect(Object.keys(BUILTIN_ENGINES).sort()).toEqual(["claude", "codex", "copilot", "kimi"])
  })
})
