/**
 * Vendor-preference layering: per-repo last-active → global default →
 * legacy `lastSelectedVendor` → claude, with each layer validated
 * independently (a corrupt repo entry must fall through to the global
 * default, not straight to the built-in fallback). Isolated state.json
 * via `KOBE_HOME_DIR`.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { setPersistedString } from "../../src/state/repos.ts"
import { patchStateFile } from "../../src/state/store.ts"
import {
  getGlobalDefaultVendor,
  getRepoLastActiveVendor,
  resolvePreferredVendor,
  setGlobalDefaultVendor,
  setRepoLastActiveVendor,
} from "../../src/state/vendor-prefs.ts"

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-vendor-prefs-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe("vendor preference layers", () => {
  test("unset everywhere → claude", () => {
    expect(resolvePreferredVendor("/repo")).toBe("claude")
    expect(resolvePreferredVendor()).toBe("claude")
    expect(getGlobalDefaultVendor()).toBeUndefined()
  })

  test("repo last-active wins over the global default", () => {
    setGlobalDefaultVendor("claude")
    setRepoLastActiveVendor("/repo", "codex")
    expect(resolvePreferredVendor("/repo")).toBe("codex")
    expect(resolvePreferredVendor("/other")).toBe("claude")
    expect(resolvePreferredVendor()).toBe("claude")
  })

  test("legacy lastSelectedVendor backs the global default until defaultVendor is set", () => {
    setPersistedString("lastSelectedVendor", "codex")
    expect(getGlobalDefaultVendor()).toBe("codex")
    expect(resolvePreferredVendor("/repo")).toBe("codex")
    setGlobalDefaultVendor("copilot")
    expect(getGlobalDefaultVendor()).toBe("copilot")
  })

  test("a corrupt repo entry falls through to the global default", () => {
    setPersistedString("lastActiveVendor./repo", "gpt9-typo")
    setGlobalDefaultVendor("codex")
    expect(getRepoLastActiveVendor("/repo")).toBeUndefined()
    expect(resolvePreferredVendor("/repo")).toBe("codex")
  })
})

/**
 * Switching an engine off in Settings -> Engines is documented as "it stops
 * being offered when you pick an engine for a task". The disabled set was read
 * in one place — `availableEngineIds()`, which only feeds the TUI picker — so
 * every headless resolution (`rove api add`, quick-fork, main-task) went
 * through these layers instead and launched the engine anyway. A user who ran
 * codex once in a repo and then switched it off got codex back from
 * `rove api add --repo <that repo>`.
 */
describe("a disabled engine is not offered by any layer", () => {
  /** Settings -> Engines writes this key as a `string[]` through its own kv. */
  function setDisabled(ids: readonly string[]): void {
    patchStateFile({ disabledEngineIds: [...ids] })
  }

  test("the repo's last-active entry falls through when that engine is off", () => {
    setRepoLastActiveVendor("/repo", "codex")
    setGlobalDefaultVendor("copilot")
    setDisabled(["codex"])

    expect(getRepoLastActiveVendor("/repo")).toBeUndefined()
    expect(resolvePreferredVendor("/repo")).toBe("copilot")
  })

  test("the global default falls through too, down to the first engine left on", () => {
    setGlobalDefaultVendor("codex")
    setDisabled(["codex", "claude"])

    expect(getGlobalDefaultVendor()).toBeUndefined()
    // claude is the built-in fallback and is itself off, so the resolution
    // continues to the next enabled built-in rather than handing back a
    // default nobody is allowed to pick.
    expect(resolvePreferredVendor("/repo")).toBe("copilot")
  })

  test("switching it back on restores the stored preference untouched", () => {
    setRepoLastActiveVendor("/repo", "codex")
    setDisabled(["codex"])
    expect(resolvePreferredVendor("/repo")).not.toBe("codex")
    setDisabled([])
    expect(resolvePreferredVendor("/repo")).toBe("codex")
  })
})
