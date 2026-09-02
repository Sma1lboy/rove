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
import { kimiTrustFilePath, trustKimiWorktree } from "../../src/engine/kimi-local/trust.ts"

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
