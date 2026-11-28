/**
 * Companion to `interactive-command.test.ts` for the halves that read the
 * shared state.json: the per-vendor launch-command / display-name overrides
 * (KOB-244) and the effort + session-id argv weaving.
 *
 * Why these matter: every launch site (Handover, Tasks-pane switch,
 * `new-chattab`) goes through `interactiveEngineCommand` — a bad override
 * fallback silently launches the wrong binary, and a mis-woven effort flag
 * makes codex refuse to start. State is isolated via `ROVE_HOME_DIR`.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  argvHasFlag,
  engineCommandKey,
  engineDisplayName,
  engineNameKey,
  interactiveEngineCommand,
  withEngineEffort,
} from "@sma1lboy/rove-core/engine/interactive-command.ts"
import { PERMISSION_BYPASS_KEY } from "@sma1lboy/rove-core/state/permission-bypass.ts"
import { setPersistedString } from "@sma1lboy/rove-core/state/repos.ts"
import { setPersistedBool } from "@sma1lboy/rove-core/state/store.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rove-icmd-"))
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = tmpHome
  setPersistedBool(PERMISSION_BYPASS_KEY, false)
})

afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe("engineDisplayName", () => {
  it("prefers the persisted engineName override (trimmed)", () => {
    setPersistedString(engineNameKey("claude"), "  My Claude  ")
    expect(engineDisplayName("claude")).toBe("My Claude")
  })
})

describe("interactiveEngineCommand", () => {
  it("returns the registry default when no override is persisted", () => {
    expect(interactiveEngineCommand("claude")).toEqual(["claude"])
    expect(interactiveEngineCommand(undefined)).toEqual(["claude"])
  })

  it("parses a persisted override string into argv (quotes preserved)", () => {
    setPersistedString(engineCommandKey("claude"), 'cl --append-system-prompt "be terse"')
    expect(interactiveEngineCommand("claude")).toEqual(["cl", "--append-system-prompt", "be terse"])
  })

  it("a whitespace-only override falls back to the built-in default", () => {
    // The update-check flag keeps Codex's startup update menu (drops pending
    // input; Enter installs and exits) from taking a hosted launch's first prompt.
    setPersistedString(engineCommandKey("codex"), "   ")
    expect(interactiveEngineCommand("codex")).toEqual([
      "codex",
      "-c",
      'tui.terminal_title=["activity","thread-title"]',
      "-c",
      "check_for_update_on_startup=false",
    ])
  })

  it.each([
    "-c check_for_update_on_startup=true",
    "--config check_for_update_on_startup=false",
    "-ccheck_for_update_on_startup=true",
    "-c=check_for_update_on_startup=false",
    "--config=check_for_update_on_startup=true",
    '-c " check_for_update_on_startup = false"',
  ])("preserves the explicit update-check override %s", (config) => {
    setPersistedString(engineCommandKey("codex"), `codex ${config}`)
    const argv = interactiveEngineCommand("codex")
    expect(argv.filter((arg) => arg.includes("check_for_update_on_startup"))).toHaveLength(1)
  })

  it.each([
    `-c 'developer_instructions="Explain check_for_update_on_startup"'`,
    "--config=other_check_for_update_on_startup=true",
    "-c check_for_update_on_startup_extra=true",
    "-c nested.check_for_update_on_startup=true",
    '"Explain check_for_update_on_startup=true"',
  ])("disables startup updates despite an unrelated mention in %s", (override) => {
    setPersistedString(engineCommandKey("codex"), `codex ${override}`)
    expect(interactiveEngineCommand("codex")).toContain("check_for_update_on_startup=false")
  })

  it("lets Codex own the tab status and name from its live thread title", () => {
    expect(interactiveEngineCommand("codex", "high")).toEqual([
      "codex",
      "-c",
      "model_reasoning_effort=high",
      "-c",
      'tui.terminal_title=["activity","thread-title"]',
      "-c",
      "check_for_update_on_startup=false",
    ])
  })
})

describe("withEngineEffort", () => {
  it("appends -c model_reasoning_effort=<level> for codex", () => {
    expect(withEngineEffort(["codex"], "codex", "xhigh")).toEqual(["codex", "-c", "model_reasoning_effort=xhigh"])
  })

  it("drops an unknown level instead of passing it through (codex would refuse to launch)", () => {
    expect(withEngineEffort(["codex"], "codex", "turbo")).toEqual(["codex"])
  })
})

describe("argvHasFlag", () => {
  it("matches the separated and attached forms, nothing else", () => {
    expect(argvHasFlag(["claude", "--resume", "x"], "--resume")).toBe(true)
    expect(argvHasFlag(["claude", "--resume=x"], "--resume")).toBe(true)
    expect(argvHasFlag(["claude", "--resume-later"], "--resume")).toBe(false)
    // A flag NAME appearing as another flag's value is a value, not a flag —
    // known ceiling shared with every guard here; positional matching would
    // need a full claude arg spec.
    expect(argvHasFlag(["claude"], "--resume")).toBe(false)
  })
})

describe("permission bypass", () => {
  beforeEach(() => setPersistedBool(PERMISSION_BYPASS_KEY, true))

  it("is on by default and skips Claude's one-time consent screen", () => {
    fs.rmSync(path.join(tmpHome, ".config"), { recursive: true, force: true })
    const argv = interactiveEngineCommand("claude")
    expect(argv).toContain("--dangerously-skip-permissions")
    expect(argv[argv.indexOf("--settings") + 1]).toBe('{"skipDangerousModePermissionPrompt":true}')
  })

  it.each([
    ["claude", "claude --dangerously-skip-permissions"],
    ["claude", "claude --permission-mode plan"],
    ["codex", "codex --yolo"],
    ["codex", "codex -s workspace-write"],
  ])("adds nothing when the %s command already picks a mode: %s", (vendor, command) => {
    setPersistedString(engineCommandKey(vendor), command)
    const bypass = (argv: readonly string[]) =>
      argv.filter((a) => a.startsWith("--dangerously-") || a === "--settings").length
    expect(bypass(interactiveEngineCommand(vendor))).toBe(bypass(command.split(" ")))
  })

  it("leaves a user's own --settings alone", () => {
    setPersistedString(engineCommandKey("claude"), "claude --settings ./mine.json")
    const argv = interactiveEngineCommand("claude")
    expect(argv).toContain("--dangerously-skip-permissions")
    expect(argv.filter((a) => a === "--settings")).toHaveLength(1)
  })

  it("adds nothing once switched off in Settings", () => {
    setPersistedBool(PERMISSION_BYPASS_KEY, false)
    expect(interactiveEngineCommand("codex")).not.toContain("--dangerously-bypass-approvals-and-sandbox")
  })
})
