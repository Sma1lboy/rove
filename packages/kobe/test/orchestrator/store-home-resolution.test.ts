/**
 * Which HOME a `new TaskIndexStore()` with no options resolves to.
 *
 * The seam against `store-legacy-layout.test.ts` is one level up: that file
 * fixes which FILE inside a home answers, this one fixes which HOME. It exists
 * because the failure is silent and lands on the wrong machine's data — the
 * CLI's daemon-down write fallback (`openLocalOrchestrator`) and `rove export`
 * both construct this store with no options, so a constructor that skipped the
 * env wrote an isolated environment's tasks into the operator's real
 * `~/.rove/tasks.json` and reported success.
 */

import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"

const saved = { rove: process.env.ROVE_HOME_DIR, kobe: process.env.KOBE_HOME_DIR }

afterEach(() => {
  for (const [key, value] of [
    ["ROVE_HOME_DIR", saved.rove],
    ["KOBE_HOME_DIR", saved.kobe],
  ] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
})

describe("home resolution with no explicit homeDir", () => {
  it("uses ROVE_HOME_DIR", () => {
    process.env.ROVE_HOME_DIR = "/tmp/rove-home-resolution/rove"
    expect(new TaskIndexStore().filePath).toBe(join("/tmp/rove-home-resolution/rove", ".rove", "tasks.json"))
  })

  it("falls back to the legacy KOBE_HOME_DIR", () => {
    Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
    process.env.KOBE_HOME_DIR = "/tmp/rove-home-resolution/kobe"
    expect(new TaskIndexStore().filePath).toBe(join("/tmp/rove-home-resolution/kobe", ".rove", "tasks.json"))
  })

  it("still lets an explicit homeDir win over both", () => {
    process.env.ROVE_HOME_DIR = "/tmp/rove-home-resolution/rove"
    process.env.KOBE_HOME_DIR = "/tmp/rove-home-resolution/kobe"
    const store = new TaskIndexStore({ homeDir: "/tmp/rove-home-resolution/explicit" })
    expect(store.filePath).toBe(join("/tmp/rove-home-resolution/explicit", ".rove", "tasks.json"))
  })
})
