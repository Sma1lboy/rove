/**
 * Vendor-preference layering: per-repo last-active → global default →
 * legacy `lastSelectedVendor` → claude, with each layer validated
 * independently (a corrupt repo entry must fall through to the global
 * default, not straight to the built-in fallback). Isolated state.json
 * via `ROVE_HOME_DIR`.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { setPersistedString } from "@sma1lboy/rove-core/state/repos.ts"
import { patchStateFile } from "@sma1lboy/rove-core/state/store.ts"
import {
  getGlobalDefaultVendor,
  getLastActiveVendor,
  resolvePreferredVendor,
  setGlobalDefaultVendor,
  setLastActiveVendor,
} from "@sma1lboy/rove-core/state/vendor-prefs.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rove-vendor-prefs-"))
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe("vendor preference layers", () => {
  test("the last pick wins over the global default, in every project", () => {
    setGlobalDefaultVendor("claude")
    setLastActiveVendor("codex")
    expect(resolvePreferredVendor()).toBe("codex")
  })

  test("setting the default in Settings is the newest pick", () => {
    setLastActiveVendor("codex")
    setGlobalDefaultVendor("copilot")
    expect(resolvePreferredVendor()).toBe("copilot")
  })

  test("legacy lastSelectedVendor backs the global default until defaultVendor is set", () => {
    setPersistedString("lastSelectedVendor", "codex")
    expect(getGlobalDefaultVendor()).toBe("codex")
    expect(resolvePreferredVendor()).toBe("codex")
    setGlobalDefaultVendor("copilot")
    expect(getGlobalDefaultVendor()).toBe("copilot")
  })

  test("a corrupt last pick falls through to the global default", () => {
    setGlobalDefaultVendor("codex")
    setPersistedString("lastActiveVendor", "gpt9-typo")
    expect(getLastActiveVendor()).toBeUndefined()
    expect(resolvePreferredVendor()).toBe("codex")
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

  test("the last-active entry falls through when that engine is off", () => {
    setGlobalDefaultVendor("copilot")
    setLastActiveVendor("codex")
    setDisabled(["codex"])

    expect(getLastActiveVendor()).toBeUndefined()
    expect(resolvePreferredVendor()).toBe("copilot")
  })

  test("the global default falls through too, down to the first engine left on", () => {
    setGlobalDefaultVendor("codex")
    setDisabled(["codex", "claude"])

    expect(getGlobalDefaultVendor()).toBeUndefined()
    // claude is the built-in fallback and is itself off, so the resolution
    // continues to the next enabled built-in rather than handing back a
    // default nobody is allowed to pick.
    expect(resolvePreferredVendor()).toBe("copilot")
  })

  test("switching it back on restores the stored preference untouched", () => {
    setLastActiveVendor("codex")
    setDisabled(["codex"])
    expect(resolvePreferredVendor()).not.toBe("codex")
    setDisabled([])
    expect(resolvePreferredVendor()).toBe("codex")
  })
})
