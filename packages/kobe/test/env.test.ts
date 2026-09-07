import { homedir } from "node:os"
import { afterEach, describe, expect, test } from "vitest"
import {
  homeDir,
  isDev,
  kvStatePath,
  legacyKobeKvStatePath,
  legacyKobeStateDir,
  roveSettingsDir,
  roveStateDir,
} from "../src/env.ts"

const ORIGINAL = {
  ROVE_DEV: process.env.ROVE_DEV,
  KOBE_DEV: process.env.KOBE_DEV,
  ROVE_HOME_DIR: process.env.ROVE_HOME_DIR,
  KOBE_HOME_DIR: process.env.KOBE_HOME_DIR,
}

function restore(key: keyof typeof ORIGINAL): void {
  const value = ORIGINAL[key]
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = value
}

afterEach(() => {
  for (const key of Object.keys(ORIGINAL) as (keyof typeof ORIGINAL)[]) restore(key)
})

describe("rename-compatible environment access", () => {
  test("ROVE_HOME_DIR wins and product data uses the canonical Rove layout", () => {
    process.env.KOBE_HOME_DIR = "/legacy-home"
    process.env.ROVE_HOME_DIR = "/rove-home"

    expect(homeDir()).toBe("/rove-home")
    expect(roveStateDir()).toBe("/rove-home/.rove")
    expect(roveSettingsDir()).toBe("/rove-home/.rove/settings")
    expect(kvStatePath()).toBe("/rove-home/.config/rove/state.json")
    expect(legacyKobeStateDir()).toBe("/rove-home/.kobe")
    expect(legacyKobeKvStatePath()).toBe("/rove-home/.config/kobe/state.json")
  })

  test("KOBE_HOME_DIR remains a supported fallback", () => {
    Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
    process.env.KOBE_HOME_DIR = "/legacy-home"
    expect(homeDir()).toBe("/legacy-home")
  })

  // `VAR=` is how a shell says "unset". Read raw, it made the home `""` and
  // every state path RELATIVE — `.rove`, `.config/rove/state.json` — resolved
  // against whatever cwd the process happened to have, which for the TUI is
  // the user's repository.
  test("an empty HOME_DIR means unset, never a relative state root", () => {
    process.env.ROVE_HOME_DIR = ""
    process.env.KOBE_HOME_DIR = ""
    expect(homeDir()).toBe(homedir())
    expect(roveStateDir()).toBe(`${homedir()}/.rove`)
    expect(kvStatePath()).toBe(`${homedir()}/.config/rove/state.json`)
  })

  test("a whitespace-only HOME_DIR is unset too", () => {
    process.env.ROVE_HOME_DIR = "   "
    Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
    expect(homeDir()).toBe(homedir())
  })

  test("an empty ROVE_HOME_DIR still yields to a real KOBE_HOME_DIR", () => {
    process.env.ROVE_HOME_DIR = ""
    process.env.KOBE_HOME_DIR = "/legacy-home"
    expect(homeDir()).toBe("/legacy-home")
  })

  test("ROVE_DEV takes precedence over KOBE_DEV", () => {
    process.env.KOBE_DEV = "1"
    process.env.ROVE_DEV = "0"
    expect(isDev()).toBe(false)
    process.env.ROVE_DEV = "1"
    expect(isDev()).toBe(true)
  })
})
