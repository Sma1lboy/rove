/**
 * IBM Bob Shell as a built-in engine: the registry entry's launch contract
 * and the screen manifest's blocked states. Bob has no hooks and no readable
 * transcript, so the screen rules are its only activity signal — every
 * phrase here is a literal from the bobshell 2.0.4 bundle.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { BOB_SCREEN_MANIFEST } from "../../src/engine/bob-local/screen.ts"
import { bobTrustStorePath, trustBobWorktree } from "../../src/engine/bob-local/trust.ts"
import { engineEntry } from "../../src/engine/registry.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"
import { isBuiltinVendor } from "../../src/types/vendor.ts"

describe("bob registry entry", () => {
  it("is a built-in that launches `bob chat --trust` and pastes the first message", () => {
    expect(isBuiltinVendor("bob")).toBe(true)
    const bob = engineEntry("bob")
    expect(bob.builtin).toBe(true)
    expect(bob.displayName).toBe("IBM Bob")
    expect(bob.defaultCommand).toEqual(["bob", "chat", "--trust"])
    expect(bob.firstMessageDelivery).toBe("paste")
    expect(bob.detectAccount).toBeDefined()
    expect(bob.screenManifest).toBe(BOB_SCREEN_MANIFEST)
  })

  it("has no history, hooks, or turn markers yet — badge is screen-only", () => {
    const bob = engineEntry("bob")
    expect(bob.createHookAdapter().supportsHooks()).toBe(false)
    expect(bob.createTurnDetector().supportsCompletionMarkers()).toBe(false)
  })

  it("resumes a known task id with --resume and respects a user-supplied -r", () => {
    const id = engineEntry("bob").sessionIdentity
    if (!id?.resumeArgv) throw new Error("bob declares no session identity")
    expect(id.resumeArgv(["bob", "chat"], "task-1")).toEqual(["bob", "chat", "--resume", "task-1"])
    expect(id.sessionControlFlags).toEqual(["-r", "--resume"])
  })
})

describe("bob screen manifest", () => {
  const classify = (lines: readonly string[]) => classifyScreen(BOB_SCREEN_MANIFEST, lines.join("\n"))

  it("blocks on the folder-trust dialog", () => {
    expect(classify(["Do you trust this folder?", "  Trust this folder (rove)", "  Don't trust"])).toBe("blocked")
  })

  it("blocks on a tool-approval prompt", () => {
    expect(classify(["execute_command: ls -la", "> Approve Once", "  Reject", "  Approve for task"])).toBe("blocked")
  })

  it("blocks on the resume picker and the exit confirmation", () => {
    expect(classify(["Resume Task", "Enter to resume · Type to filter · Ctrl+X to delete · Esc to close"])).toBe(
      "blocked",
    )
    expect(classify(["Press Ctrl+C again to exit"])).toBe("blocked")
  })

  it("answers nothing for a plain resting prompt", () => {
    expect(classify(["> ", "You can use Ctrl+J to write a new line"])).toBeNull()
  })
})

describe("trustBobWorktree", () => {
  const homes: string[] = []
  afterEach(() => {
    for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true })
  })
  const home = () => {
    const h = mkdtempSync(path.join(tmpdir(), "rove-bob-home-"))
    homes.push(h)
    return h
  }
  const read = (h: string) => JSON.parse(readFileSync(bobTrustStorePath(h), "utf8"))

  it("creates ~/.bob/trustedFolders.json in bob's own shape", () => {
    const h = home()
    trustBobWorktree("/work/rove-abc", h)
    expect(read(h)).toEqual({ version: 1, folders: { "/work/rove-abc": "TRUST_FOLDER" } })
  })

  it("merges into an existing store and keeps other folders' entries", () => {
    const h = home()
    mkdirSync(path.join(h, ".bob"), { recursive: true })
    writeFileSync(bobTrustStorePath(h), JSON.stringify({ version: 1, folders: { "/other": "DONT_TRUST" } }))
    trustBobWorktree("/work/rove-abc", h)
    expect(read(h).folders).toEqual({ "/other": "DONT_TRUST", "/work/rove-abc": "TRUST_FOLDER" })
  })

  it("is idempotent and repairs a corrupt store instead of throwing", () => {
    const h = home()
    mkdirSync(path.join(h, ".bob"), { recursive: true })
    writeFileSync(bobTrustStorePath(h), "{not json")
    trustBobWorktree("/work/rove-abc", h)
    trustBobWorktree("/work/rove-abc", h)
    expect(read(h)).toEqual({ version: 1, folders: { "/work/rove-abc": "TRUST_FOLDER" } })
  })
})
