/**
 * Unit tests for the per-repo init resolution (state/repo-init.ts) and the
 * state.json override accessors (state/repos.ts).
 *
 * Priority is the load-bearing rule: in-repo `.rove/` files win, `.kobe/`
 * files remain fallbacks, and both beat the per-user state.json override,
 * resolved PER FIELD. Paths used here are plain tmpdirs (not git repos), so
 * `resolveRepoRoot` returns them verbatim — no git shelling, deterministic.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { resolveEngineLaunchInit, resolveRepoInit } from "../../src/state/repo-init.ts"
import { getRepoInitOverride, setRepoInitOverride } from "../../src/state/repos.ts"

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-repoinit-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = tmpHome
})

afterEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset when it was unset pre-test.
  if (originalHome === undefined) delete process.env.KOBE_HOME_DIR
  else process.env.KOBE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

function makeWorktree(files: Record<string, string> = {}): string {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-wt-"))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(wt, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, "utf8")
  }
  return wt
}

describe("repo init override (state.json)", () => {
  test("round-trips set → get", () => {
    setRepoInitOverride("/repo/x", { initScript: "pnpm i", initPrompt: "read CLAUDE.md" })
    expect(getRepoInitOverride("/repo/x")).toEqual({ initScript: "pnpm i", initPrompt: "read CLAUDE.md" })
  })

  test("patches one field without dropping the other", () => {
    setRepoInitOverride("/repo/x", { initScript: "a", initPrompt: "b" })
    setRepoInitOverride("/repo/x", { initPrompt: "b2" })
    expect(getRepoInitOverride("/repo/x")).toEqual({ initScript: "a", initPrompt: "b2" })
  })

  test("empty string clears a field; clearing both drops the entry", () => {
    setRepoInitOverride("/repo/x", { initScript: "a", initPrompt: "b" })
    setRepoInitOverride("/repo/x", { initScript: "" })
    expect(getRepoInitOverride("/repo/x")).toEqual({ initPrompt: "b" })
    setRepoInitOverride("/repo/x", { initPrompt: "" })
    expect(getRepoInitOverride("/repo/x")).toEqual({})
  })

  test("absent repo → empty override", () => {
    expect(getRepoInitOverride("/never/set")).toEqual({})
  })
})

describe("resolveRepoInit (files win over override, per field)", () => {
  test("no files, no override → nothing", () => {
    const wt = makeWorktree()
    expect(resolveRepoInit(wt, wt)).toEqual({})
  })

  test("override is the fallback when the repo ships no convention files", () => {
    const wt = makeWorktree()
    setRepoInitOverride(wt, { initScript: "make setup", initPrompt: "hi" })
    expect(resolveRepoInit(wt, wt)).toEqual({ initScript: "make setup", initPrompt: "hi" })
  })

  test("repo .kobe/init.sh + init-prompt.md WIN over the override", () => {
    const wt = makeWorktree({
      ".kobe/init.sh": "echo hi",
      ".kobe/init-prompt.md": "start by reading the docs",
    })
    setRepoInitOverride(wt, { initScript: "make setup", initPrompt: "ignored" })
    const r = resolveRepoInit(wt, wt)
    // script runs the committed file by relative path (cwd is the worktree)
    expect(r.initScript).toBe("sh .kobe/init.sh")
    expect(r.initPrompt).toBe("start by reading the docs")
  })

  test("canonical .rove files win over legacy .kobe files per field", () => {
    const wt = makeWorktree({
      ".rove/init.sh": "echo rove",
      ".rove/init-prompt.md": "canonical prompt",
      ".kobe/init.sh": "echo kobe",
      ".kobe/init-prompt.md": "legacy prompt",
    })
    expect(resolveRepoInit(wt, wt)).toEqual({
      initScript: "sh .rove/init.sh",
      initPrompt: "canonical prompt",
    })
  })

  test("canonical and legacy convention files compose per field", () => {
    const wt = makeWorktree({
      ".rove/init.sh": "echo rove",
      ".kobe/init-prompt.md": "legacy prompt",
    })
    expect(resolveRepoInit(wt, wt)).toEqual({
      initScript: "sh .rove/init.sh",
      initPrompt: "legacy prompt",
    })
  })

  test("per field: file script wins, override prompt fills the gap", () => {
    const wt = makeWorktree({ ".kobe/init.sh": "echo hi" })
    setRepoInitOverride(wt, { initScript: "ignored", initPrompt: "from override" })
    expect(resolveRepoInit(wt, wt)).toEqual({ initScript: "sh .kobe/init.sh", initPrompt: "from override" })
  })

  test("a blank init-prompt.md is treated as absent (falls back)", () => {
    const wt = makeWorktree({ ".kobe/init-prompt.md": "   \n  " })
    setRepoInitOverride(wt, { initPrompt: "fallback" })
    expect(resolveRepoInit(wt, wt).initPrompt).toBe("fallback")
  })
})

describe("resolveEngineLaunchInit", () => {
  test("repo-init intent turns the resolved init prompt into the first engine message", () => {
    const wt = makeWorktree({ ".kobe/init-prompt.md": "  read the repo docs\n" })
    expect(resolveEngineLaunchInit(wt, wt, { kind: "repo-init" })).toEqual({
      firstMessage: { source: "repo-init", text: "read the repo docs" },
    })
  })

  test("explicit intent carries the explicit prompt and still includes the init script", () => {
    const wt = makeWorktree({ ".kobe/init.sh": "echo hi", ".kobe/init-prompt.md": "repo prompt" })
    expect(resolveEngineLaunchInit(wt, wt, { kind: "explicit", prompt: "user prompt\n\nkeep spacing" })).toEqual({
      initScript: "sh .kobe/init.sh",
      firstMessage: { source: "explicit", text: "user prompt\n\nkeep spacing" },
    })
  })

  test("none intent suppresses any first message but keeps the init script", () => {
    const wt = makeWorktree({ ".kobe/init.sh": "echo hi", ".kobe/init-prompt.md": "repo prompt" })
    expect(resolveEngineLaunchInit(wt, wt, { kind: "none" })).toEqual({ initScript: "sh .kobe/init.sh" })
  })

  // Why: standing instructions for a worker — name your branch, report your
  // outcome home — moved to the Rove agent skill, which the agent reads once.
  // They used to be appended to EVERY new task's first prompt, which meant a
  // user writing Chinese had their own words trailed by two English
  // paragraphs, and the send-back half duplicated what SKILL.md already said.
  //
  // What must survive: the user's prompt reaches the engine unchanged, and
  // the per-worktree FACTS (the missing-dependency warning below) still ride
  // along, because no skill can know them.
  test("new-task delivers the user's prompt verbatim — no appended instructions", () => {
    const wt = makeWorktree()
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix the bug" }, "task-9").firstMessage
    expect(msg?.source).toBe("explicit")
    expect(msg?.text).toBe("fix the bug")
  })

  test("no branch-rename or send-back instruction is injected any more", () => {
    // Pins the deletion: these strings coming back means the coda returned,
    // and the user's prompt is once again trailed by English boilerplate.
    const wt = makeWorktree()
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "修一下这个 bug" }, "task-9").firstMessage
    expect(msg?.text).not.toContain("set-branch")
    expect(msg?.text).not.toContain("spawned by Rove task")
    expect(msg?.text).toBe("修一下这个 bug")
  })
})

// Why: issue #35 — a fresh worktree with a committed lockfile but no install
// output makes every build/test fail for reasons unrelated to the task, and
// agents have reported that breakage as a product regression. Advice only:
// installing belongs to `.rove/init.sh`, so a repo that configures one is
// silent, as is a worktree whose dependency dir is already there.
describe("missing-dependency coda (new-task only)", () => {
  test("lockfile present, dependency dir missing, no init script → warns", () => {
    const wt = makeWorktree({ "bun.lock": "{}" })
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix it" }, "task-1").firstMessage
    expect(msg?.text).toContain("no installed dependencies")
    expect(msg?.text).toContain("node_modules")
  })

  test("dependency dir already installed → silent", () => {
    const wt = makeWorktree({ "bun.lock": "{}", "node_modules/.keep": "" })
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix it" }, "task-1").firstMessage
    expect(msg?.text).not.toContain("no installed dependencies")
  })

  test("no lockfile → silent", () => {
    const wt = makeWorktree()
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix it" }, "task-1").firstMessage
    expect(msg?.text).not.toContain("no installed dependencies")
  })

  test("repo init script configured → silent (install is init.sh's job)", () => {
    const wt = makeWorktree({ "bun.lock": "{}", ".rove/init.sh": "bun install" })
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix it" }, "task-1").firstMessage
    expect(msg?.text).not.toContain("no installed dependencies")
  })

  test("per-user init-script override also silences it", () => {
    const wt = makeWorktree({ "Cargo.lock": "" })
    setRepoInitOverride(wt, { initScript: "cargo fetch" })
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix it" }, "task-1").firstMessage
    expect(msg?.text).not.toContain("no installed dependencies")
  })

  test("non-node ecosystems map to their own dependency dir", () => {
    const wt = makeWorktree({ "Cargo.lock": "" })
    const msg = resolveEngineLaunchInit(wt, wt, { kind: "new-task", prompt: "fix it" }, "task-1").firstMessage
    expect(msg?.text).toContain("target")
  })

  test("explicit / repo-init / none intents never carry it", () => {
    const wt = makeWorktree({ "bun.lock": "{}", ".kobe/init-prompt.md": "repo prompt" })
    for (const intent of [{ kind: "explicit", prompt: "p" }, { kind: "repo-init" }, { kind: "none" }] as const) {
      const msg = resolveEngineLaunchInit(wt, wt, intent).firstMessage
      expect(msg?.text ?? "").not.toContain("no installed dependencies")
    }
  })
})
